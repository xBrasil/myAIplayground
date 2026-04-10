import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

let gitHash = 'dev';
let gitDate = '';
try {
  gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  gitDate = execSync('git log -1 --format=%ci', { encoding: 'utf-8' }).trim();
} catch { /* fallback to 'dev' outside a git repo */ }

let appVersion = '0.0.0';
try {
  appVersion = readFileSync(resolve(__dirname, '..', 'VERSION'), 'utf-8').trim();
} catch { /* fallback */ }

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_NUMBER__: JSON.stringify(gitHash),
    __BUILD_TIMESTAMP__: JSON.stringify(gitDate),
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 5173,
  },
});
