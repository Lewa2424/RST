import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { config, ensureAppDirs } from './server/config.js';
import { createApiApp } from './server/api.js';

async function startServer(): Promise<void> {
  ensureAppDirs();
  const app = await createApiApp();
  const PORT = config.port;

  if (!config.isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RST listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RST', err instanceof Error ? err.message : err);
  process.exit(1);
});
