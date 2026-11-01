import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development, `npm run dev` serves the UI on :5173 and proxies API
// calls to a locally running Go server (`go run ./cmd/battery-historian`).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Direct-from-device endpoints + analysis (multipart POST -> JSON).
      '/api': {
        target: 'http://127.0.0.1:9999',
        changeOrigin: true,
      },
      '/': {
        target: 'http://127.0.0.1:9999',
        changeOrigin: true,
        bypass: req => {
          // Let the dev server serve its own assets.
          if (req.method === 'GET' && !req.url?.startsWith('/?')) {
            return req.url ?? undefined;
          }
          return undefined;
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
