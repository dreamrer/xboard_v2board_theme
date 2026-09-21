import {readFile,writeFile,mkdir,cp,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {toConfigs,exposedNames} from './theme-fields.mjs';
import {writeStandalone} from './standalone.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=project;
const config=JSON.parse(await readFile(path.join(project,'config.json'),'utf8')),output=path.join(root,'theme',config.name),standaloneOutput=path.join(root,'theme',config.name+'-standalone'),dist=path.join(root,'dist');
if(config.name!=='HeroRui')throw Error('Unexpected theme target');
// config.json 必须与 theme-fields.mjs 一致。漂移了不会报错、只是站长在后台
// 填的字段静默不生效 —— 所以在这里拦下，并提示怎么修。
{
 const expected=JSON.stringify(toConfigs()),actual=JSON.stringify(config.configs||[]);
 if(expected!==actual)throw Error('config.json 的 configs 与 scripts/theme-fields.mjs 不一致，请运行 `npm run gen:config` 重新生成');
}
// 每次从空目录开始：旧构建留下的 hash 资源、以及旧版本打进面板包的 index.html，
// 都不能因为「目录里还在」就混进新包
for(const dir of [output,standaloneOutput]){await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true})}
await mkdir(dist,{recursive:true});
const html=await readFile(path.join(project,'build/index.html'),'utf8');
const assets=[...html.matchAll(/(?:src|href)="\.\/([^" ]+)"/g)].map(m=>m[1]);
const scripts=assets.filter(f=>f.endsWith('.js')).map(f=>`<script type="module" crossorigin src="/theme/{{$theme}}/${f}"></script>`).join('\n');
const styles=assets.filter(f=>f.endsWith('.css')).map(f=>`<link rel="stylesheet" crossorigin href="/theme/{{$theme}}/${f}">`).join('\n');
if(!scripts||!styles)throw Error('Missing Vite entry assets');
const blade=`<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#ce303b"><title>{{$title}}</title>
${styles}
</head><body>
@php
 $heroruiSettings = ['title' => $title, 'description' => $description, 'logo' => $logo, 'version' => $version, 'assets_path' => '/theme/' . $theme . '/assets'];
 // Xboard 从 admin_setting 取、V2board 从 config('theme.X') 取，两边都是以
 // field_name 为键的数组；没初始化过时可能是 null，所以先兜一层。
 $heroruiConfig = is_array($theme_config ?? null) ? $theme_config : [];
 $heroruiTheme = [
${exposedNames().map(n=>`  '${n}' => $heroruiConfig['${n}'] ?? ''`).join(',\n')}
 ];
@endphp
<script>window.routerBase = "/"; window.settings = @json($heroruiSettings); window.themeConfig = @json($heroruiTheme);</script>
<div id="root"></div>
${scripts}
{!! $heroruiConfig['custom_html'] ?? '' !!}
</body></html>\n`;
for(const dir of [output,standaloneOutput]){
 await cp(path.join(project,'build/assets'),path.join(dir,'assets'),{recursive:true});
 for(const name of ['README.md','LICENSE'])await cp(path.join(project,name),path.join(dir,name));
}
await writeFile(path.join(output,'dashboard.blade.php'),blade);
await cp(path.join(project,'config.json'),path.join(output,'config.json'));
/**
 * 分离部署的 index.html + config.js 单独成包，**绝不能**混进面板包。
 *
 * 面板会把主题包整个解压到 public/theme/HeroRui/，那是一个公开的静态目录。
 * index.html 在里面就等于任何人访问 /theme/HeroRui/index.html 都能打开第二个前端：
 * 它读的是 config.js 里的默认值而不是后台配置 —— 加密中间件是关的（真实接口
 * 路径直接暴露）、后台关掉的功能也会重新出现。
 */
const standalone=await writeStandalone(project,standaloneOutput);
// Only current build assets enter the archive; obsolete hashed files are excluded.
async function list(dir,prefix=''){const result=[];for(const f of await readdir(dir,{withFileTypes:true})){if(f.isDirectory())result.push(...await list(path.join(dir,f.name),prefix+f.name+'/'));else result.push(prefix+f.name)}return result.sort()}
const assets_=await list(path.join(project,'build/assets'),'assets/');
const crcTable=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=(i&1)?0xedb88320^(i>>>1):i>>>1;return i>>>0});
const crc32=data=>{let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0};
const sha=data=>createHash('sha256').update(data).digest('hex');
async function pack(dir,base,files){
let offset=0;const records=[],central=[],manifest={theme:config.name,version:config.version,frameworks:['React','Ant Design','HeroUI'],files:{}};
for(const file of files){const data=await readFile(path.join(dir,file)),packed=deflateRawSync(data),name=Buffer.from(file),crc=crc32(data);manifest.files[file]={bytes:data.length,sha256:sha(data)};
const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
const index=Buffer.alloc(46);index.writeUInt32LE(0x02014b50);index.writeUInt16LE(20,4);index.writeUInt16LE(20,6);index.writeUInt16LE(0x800,8);index.writeUInt16LE(8,10);index.writeUInt16LE(33,14);index.writeUInt32LE(crc,16);index.writeUInt32LE(packed.length,20);index.writeUInt32LE(data.length,24);index.writeUInt16LE(name.length,28);index.writeUInt32LE(offset,42);records.push(local,name,packed);central.push(index,name);offset+=30+name.length+packed.length;}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...records,directory,end]);if(zip.length>10*1024*1024)throw Error('Theme exceeds upload limit');
await writeFile(path.join(dist,base+'.zip'),zip);await writeFile(path.join(dist,base+'.sha256'),sha(zip)+'  '+base+'.zip\n');await writeFile(path.join(dist,base+'.manifest.json'),JSON.stringify(manifest,null,2));
console.log('Packaged '+path.join(dist,base+'.zip')+' ('+zip.length+' bytes, '+files.length+' files)');
}
await pack(output,'HeroRui',['config.json','dashboard.blade.php','README.md','LICENSE',...assets_]);
await pack(standaloneOutput,'HeroRui-standalone',[...standalone,'README.md','LICENSE',...assets_]);
