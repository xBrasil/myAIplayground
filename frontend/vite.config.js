import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// In production mode (MYAI_NO_RELOAD=1, set by run.ps1/run.sh with
// -NoBrowser), disable file watching so that file deletions during
// shutdown / uninstall don't trigger a Vite server restart.
var noReload = process.env.MYAI_NO_RELOAD === '1';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        watch: noReload ? null : undefined,
    },
});
