import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In production mode (launched by run scripts), disable file watching
    // to prevent Vite from restarting when files change during shutdown.
    watch: process.env.MYAI_NO_WATCH
      ? { ignored: ['**/*'] }
      : undefined,
  },
});
