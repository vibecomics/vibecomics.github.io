/**
 * HTTPStorage: a standalone local-filesystem storage server for VibeComics, playing the same role
 * Google Drive does for the app - one folder per comic project, media files inside it, a
 * project.json with optimistic-concurrency versioning - but served over a plain CORS-enabled REST
 * API so a static page can talk to it with `fetch` from `http://localhost:<port>`.
 *
 * Routes:
 *   GET    /health
 *   GET    /projects
 *   POST   /projects                                  { name }
 *   DELETE /projects/:name
 *   GET    /projects/:name/project.json                -> { json, version } (also as ETag header)
 *   PUT    /projects/:name/project.json                 body: the project JSON
 *                                                        header: If-Match: <expected version> (optional)
 *   GET    /projects/:name/files                        -> [{ id, name, mimeType, version }]
 *   POST   /projects/:name/files                        body: raw bytes
 *                                                        headers: X-File-Name (required)
 *                                                        409 if the project already has that name
 *   GET    /projects/:name/files/:file                  -> raw bytes, Content-Type from the extension
 *   HEAD   /projects/:name/files/:file                  200 with the same headers, or 404
 *   DELETE /projects/:name/files/:file                  moves the file to the project's trash
 *
 * A file is addressed by its project and its name; it has no other id.
 */
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BadRequestError,
  ConflictError,
  createStore,
  FileExistsError,
  NotFoundError,
} from './store.ts';

const DEFAULT_MAX_JSON_BYTES = 25 * 1024 * 1024; // project.json and small JSON bodies
const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // media uploads

/** Thrown when a request body exceeds the configured size limit. Maps to HTTP 413. */
class PayloadTooLargeError extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new PayloadTooLargeError(`Request body exceeds ${limit} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const buffer = await readBody(req, limit);
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new BadRequestError('Request body must be valid JSON.');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function errorStatus(e: unknown): number {
  if (e instanceof NotFoundError) return 404;
  if (e instanceof BadRequestError) return 400;
  if (e instanceof ConflictError) return 412;
  if (e instanceof FileExistsError) return 409;
  if (e instanceof PayloadTooLargeError) return 413;
  return 500;
}

export interface RequestListenerOptions {
  root: string;
  corsOrigin?: string;
  maxJsonBytes?: number;
  maxUploadBytes?: number;
  log?: (message: string) => void;
}

/**
 * Build the request listener. Exported separately from `startServer` so tests can exercise it
 * without binding a real port.
 */
export function createRequestListener({
  root,
  corsOrigin = '*',
  maxJsonBytes = DEFAULT_MAX_JSON_BYTES,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  log = () => undefined,
}: RequestListenerOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  if (!root) throw new Error('createRequestListener requires a `root` storage path.');
  const store = createStore(root);

  function setCors(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match, X-File-Name');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
  }

  return async function requestListener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCors(res);
    log(`${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    try {
      // GET /health
      if (req.method === 'GET' && segments.length === 1 && segments[0] === 'health') {
        sendJson(res, 200, { ok: true, root: store.root });
        return;
      }

      // /projects
      if (segments[0] === 'projects') {
        // GET /projects
        if (req.method === 'GET' && segments.length === 1) {
          sendJson(res, 200, await store.listProjects());
          return;
        }
        // POST /projects  { name }
        if (req.method === 'POST' && segments.length === 1) {
          const body = (await readJson(req, maxJsonBytes)) as { name?: unknown };
          const folder = await store.ensureProject(body.name);
          sendJson(res, folder.created ? 201 : 200, folder);
          return;
        }

        const name = segments[1];
        if (name === undefined) {
          sendJson(res, 404, { error: 'Not found.' });
          return;
        }

        // DELETE /projects/:name
        if (req.method === 'DELETE' && segments.length === 2) {
          await store.deleteProject(name);
          res.writeHead(204);
          res.end();
          return;
        }

        // /projects/:name/project.json
        if (segments[2] === 'project.json' && segments.length === 3) {
          if (req.method === 'GET') {
            const { json, version } = await store.getProjectJson(name);
            res.setHeader('ETag', version);
            sendJson(res, 200, { json, version });
            return;
          }
          if (req.method === 'PUT') {
            const json = await readJson(req, maxJsonBytes);
            const ifMatch = req.headers['if-match'];
            const version = await store.saveProjectJson(name, json, ifMatch);
            sendJson(res, 200, { version });
            return;
          }
        }

        // /projects/:name/files
        if (segments[2] === 'files') {
          // GET /projects/:name/files
          if (req.method === 'GET' && segments.length === 3) {
            sendJson(res, 200, await store.listFiles(name));
            return;
          }
          // POST /projects/:name/files
          if (req.method === 'POST' && segments.length === 3) {
            const buffer = await readBody(req, maxUploadBytes);
            const fileNameHeader = req.headers['x-file-name'];
            const fileName =
              typeof fileNameHeader === 'string' ? decodeURIComponent(fileNameHeader) : undefined;
            const saved = await store.saveFile(name, { fileName, buffer });
            sendJson(res, 201, saved);
            return;
          }
          // /projects/:name/files/:file
          if (segments.length === 4) {
            const file = segments[3];
            if (req.method === 'GET') {
              const { buffer, meta } = await store.readFile(name, file);
              res.writeHead(200, {
                'Content-Type': meta.mimeType,
                'Content-Length': buffer.length,
                ETag: meta.version,
              });
              res.end(buffer);
              return;
            }
            if (req.method === 'HEAD') {
              const meta = await store.statFile(name, file);
              res.writeHead(200, { 'Content-Type': meta.mimeType, ETag: meta.version });
              res.end();
              return;
            }
            if (req.method === 'DELETE') {
              await store.trashFile(name, file);
              res.writeHead(204);
              res.end();
              return;
            }
          }
        }
      }

      sendJson(res, 404, { error: 'Not found.' });
    } catch (e) {
      if (e instanceof ConflictError) {
        sendJson(res, 412, { error: e.message, currentVersion: e.currentVersion });
        return;
      }
      const status = errorStatus(e);
      if (status === 500) log(`error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      sendJson(res, status, { error: e instanceof Error ? e.message : 'Internal error.' });
    }
  };
}

export interface StartServerOptions {
  port?: number;
  host?: string;
  root: string;
  corsOrigin?: string;
  log?: (message: string) => void;
}

/** Start the standalone server. Resolves once it is listening. */
export async function startServer({
  port = 8081,
  host = '0.0.0.0',
  root,
  corsOrigin,
  log,
}: StartServerOptions): Promise<http.Server> {
  if (!root) throw new Error('startServer requires a `root` storage path.');
  const store = createStore(root);
  await store.init();

  const logger = log ?? ((msg: string) => console.log(`[http-storage] ${msg}`));
  const listener = createRequestListener({ root, corsOrigin, log: logger });
  const server = http.createServer(listener);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  logger(`listening on http://${host}:${boundPort}, storing projects in ${root}`);
  return server;
}
