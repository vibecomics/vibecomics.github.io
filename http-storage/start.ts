#!/usr/bin/env node
/**
 * Starts the standalone server. Configured entirely through environment variables (no argv
 * parsing): HTTP_STORAGE_PATH, HTTP_STORAGE_PORT, HTTP_STORAGE_HOST, HTTP_STORAGE_CORS_ORIGIN.
 * Defaults to a `data` folder next to this file, so `npm run http-storage` works with nothing set.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

const server = await startServer({
  root: process.env.HTTP_STORAGE_PATH
    ? path.resolve(process.env.HTTP_STORAGE_PATH)
    : path.join(here, 'data'),
  port: process.env.HTTP_STORAGE_PORT ? Number(process.env.HTTP_STORAGE_PORT) : 8081,
  host: process.env.HTTP_STORAGE_HOST || '0.0.0.0',
  corsOrigin: process.env.HTTP_STORAGE_CORS_ORIGIN || '*',
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
