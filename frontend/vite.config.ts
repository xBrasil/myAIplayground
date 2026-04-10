import { execSync } from 'child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

let gitHash = 'dev';
let gitDate = '';
try {
  gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  gitDate = execSync('git log -1 --format=%ci', { encoding: 'utf-8' }).trim();
} catch { /* fallback to 'dev' outside a git repo */ }

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_NUMBER__: JSON.stringify(gitHash),
    __BUILD_TIMESTAMP__: JSON.stringify(gitDate),
  },
  server: {
    port: 5173,
  },
});
