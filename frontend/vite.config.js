import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Disable file watching — the dev server is restarted manually.
        // Prevents Vite from restarting when files change during shutdown.
        watch: null,
    },
});
