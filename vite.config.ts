import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/.agents/**'] },
    allowedHosts: process.env.R2_DEV_ORIGIN ? [new URL(process.env.R2_DEV_ORIGIN).hostname] : [],
    proxy: {
      '/api': 'http://127.0.0.1:4310',
      '/socket.io': { target: 'http://127.0.0.1:4310', ws: true },
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
