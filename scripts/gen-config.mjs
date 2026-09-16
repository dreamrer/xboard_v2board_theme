/** 依 theme-fields.mjs 重写 config.json 的 configs。加字段后跑 `npm run gen:config`。 */
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {toConfigs} from './theme-fields.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(project, 'config.json');
const config = JSON.parse(await readFile(file, 'utf8'));
config.configs = toConfigs();
await writeFile(file, JSON.stringify(config, null, 2) + '\n');
console.log(`Wrote ${config.configs.length} fields to config.json`);
