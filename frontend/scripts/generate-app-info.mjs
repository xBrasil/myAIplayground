import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let gitHash = 'dev';
let gitDate = '';
try {
  gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  gitDate = execSync('git log -1 --format=%ci', { encoding: 'utf-8' }).trim();
} catch { /* outside a git repo */ }

let appVersion = '0.0.0';
try {
  appVersion = readFileSync(resolve(root, '..', 'VERSION'), 'utf-8').trim();
} catch { /* fallback */ }

const content = [
  '// AUTO-GENERATED — do not edit',
  `export const APP_VERSION = ${JSON.stringify(appVersion)};`,
  `export const BUILD_NUMBER = ${JSON.stringify(gitHash)};`,
  `export const BUILD_TIMESTAMP = ${JSON.stringify(gitDate)};`,
  '',
].join('\n');

writeFileSync(resolve(root, 'src', 'app-info.ts'), content);
