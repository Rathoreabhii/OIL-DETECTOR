import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const demoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/demo');

function localDemo() {
  return {
    name: 'local-demo',
    configureServer(server: { middlewares: { use: (fn: (...args: any[]) => void) => void } }) {
      server.middlewares.use((req: { url?: string }, res: any, next: () => void) => {
        if (!req.url?.startsWith('/local-demo/')) return next();
        const rel = decodeURIComponent(req.url.replace('/local-demo/', '').split('?')[0] || '');
        const file = path.normalize(path.join(demoDir, rel));
        if (!file.startsWith(demoDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.setHeader(
          'Content-Type',
          ext === '.json' ? 'application/json' : ext === '.png' ? 'image/png' : 'application/octet-stream'
        );
        fs.createReadStream(file).pipe(res);
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [localDemo()],
  server: {
    port: 5175,
    host: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/demo': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  preview: { port: 4173, host: true, allowedHosts: true },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: 'index.html' }
    }
  }
});
