/**
 * An in-memory stand-in for the Google endpoints the CLI talks to (the OAuth
 * device flow and the Drive v3 REST calls in driveRest.ts), as a `fetch`
 * replacement, so the CLI can be tested end to end without a network.
 */

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  content: Buffer;
  /** Drive's counter for the file: up by one on every change. */
  version: number;
}

const FOLDER = 'application/vnd.google-apps.folder';

export function createFakeGoogle(now: () => number = Date.now) {
  const files = new Map<string, FakeFile>();
  const accessTokens = new Map<string, number>(); // token -> expiry (ms)
  const refreshTokens = new Set<string>();
  let counter = 0;
  /** Runs once, right after the next time project.json's content is read. */
  let afterProjectRead: (() => void) | null = null;
  let approved = false;
  let denied = false;
  const calls: string[] = [];

  const nextId = (prefix: string) => `${prefix}${++counter}`;
  const issueAccessToken = () => {
    const token = nextId('access-');
    accessTokens.set(token, now() + 3600 * 1000);
    return token;
  };

  const reply = (body: unknown, status = 200, type = 'application/json') =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': type },
    });

  function oauth(url: URL, form: URLSearchParams): Response {
    if (url.pathname === '/device/code') {
      return reply({
        device_code: 'device-1',
        user_code: 'ABCD-EFGH',
        verification_url: 'https://www.google.com/device',
        expires_in: 1800,
        interval: 1,
      });
    }
    if (url.pathname === '/revoke') {
      refreshTokens.delete(form.get('token') ?? '');
      return reply({});
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (!refreshTokens.has(form.get('refresh_token') ?? '')) {
        return reply({ error: 'invalid_grant', error_description: 'Token revoked.' }, 400);
      }
      return reply({ access_token: issueAccessToken(), expires_in: 3600 });
    }
    if (denied) return reply({ error: 'access_denied' }, 403);
    if (!approved) return reply({ error: 'authorization_pending' }, 428);
    refreshTokens.add('refresh-1');
    return reply({
      access_token: issueAccessToken(),
      expires_in: 3600,
      refresh_token: 'refresh-1',
    });
  }

  /** The two files of a multipart/related upload: JSON metadata, then the content. */
  function parseMultipart(body: Buffer, boundary: string) {
    const parts = body
      .toString('latin1')
      .split(`--${boundary}`)
      .filter((part) => part.trim() && part.trim() !== '--');
    const [meta, content] = parts.map((part) => {
      const at = part.indexOf('\r\n\r\n');
      return Buffer.from(part.slice(at + 4).replace(/\r\n$/, ''), 'latin1');
    });
    return { metadata: JSON.parse(meta.toString('utf8')), content };
  }

  function listFiles(q: string): FakeFile[] {
    const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const folderOnly = q.includes(`mimeType='${FOLDER}'`);
    return [...files.values()]
      .filter((f) => !f.trashed)
      .filter((f) => !folderOnly || f.mimeType === FOLDER)
      .filter((f) => name === undefined || f.name === name)
      .filter((f) => parent === undefined || f.parents.includes(parent))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function drive(url: URL, init: RequestInit): Promise<Response> {
    const method = init.method ?? 'GET';
    const auth = new Headers(init.headers).get('Authorization') ?? '';
    const expiry = accessTokens.get(auth.replace('Bearer ', ''));
    if (!expiry || expiry <= now())
      return reply({ error: { message: 'Invalid credentials' } }, 401);

    const idMatch = /\/files\/([^/?]+)/.exec(url.pathname);
    const meta = (f: FakeFile) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      version: String(f.version),
    });

    if (method === 'GET' && !idMatch) {
      return reply({ files: listFiles(url.searchParams.get('q') ?? '').map(meta) });
    }
    if (method === 'GET' && idMatch) {
      const file = files.get(idMatch[1]);
      if (!file) return reply({ error: 'not found' }, 404);
      const response = new Response(new Uint8Array(file.content), {
        headers: { 'Content-Type': file.mimeType },
      });
      if (file.name === 'project.json' && afterProjectRead) {
        const run = afterProjectRead;
        afterProjectRead = null;
        run();
      }
      return response;
    }
    if (method === 'POST' && url.pathname.startsWith('/upload/')) {
      const type = new Headers(init.headers).get('Content-Type') ?? (init.body as Blob).type;
      const boundary = /boundary=(.+)$/.exec(type)![1];
      const raw = Buffer.from(await (init.body as Blob).arrayBuffer());
      const { metadata, content } = parseMultipart(raw, boundary);
      const contentType = /Content-Type: ([^\r]+)\r\n\r\n/g;
      const types = [...raw.toString('latin1').matchAll(contentType)].map((m) => m[1]);
      const file: FakeFile = {
        id: nextId('file-'),
        name: metadata.name,
        mimeType: types[1] ?? 'application/octet-stream',
        parents: metadata.parents ?? [],
        trashed: false,
        content,
        version: 1,
      };
      files.set(file.id, file);
      return reply(meta(file));
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body as string);
      const file: FakeFile = {
        id: nextId('folder-'),
        name: body.name,
        mimeType: body.mimeType,
        parents: [],
        trashed: false,
        content: Buffer.alloc(0),
        version: 1,
      };
      files.set(file.id, file);
      return reply(meta(file));
    }
    if (method === 'PATCH' && idMatch) {
      const file = files.get(idMatch[1]);
      if (!file) return reply({ error: 'not found' }, 404);
      if (url.pathname.startsWith('/upload/')) file.content = Buffer.from(init.body as string);
      else if (JSON.parse(init.body as string).trashed) file.trashed = true;
      file.version++;
      return reply(meta(file));
    }
    return reply({ error: `unhandled ${method} ${url.pathname}` }, 500);
  }

  const fakeFetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    calls.push(`${init.method ?? 'GET'} ${url.host}${url.pathname}`);
    if (url.host === 'oauth2.googleapis.com') {
      return oauth(url, new URLSearchParams(init.body as URLSearchParams));
    }
    if (url.host === 'www.googleapis.com') return drive(url, init);
    return reply({ error: `unexpected host ${url.host}` }, 500);
  }) as typeof fetch;

  return {
    fetch: fakeFetch,
    /** The user approves the pending device login. */
    approve: () => void (approved = true),
    deny: () => void (denied = true),
    /** Google forgets every refresh token (the user revoked access). */
    revokeAll: () => refreshTokens.clear(),
    calls,
    /**
     * Another system saves the project in `folderId`: `change` edits the stored project.json, and
     * Drive's version goes up, exactly as if a browser or another CLI had written it.
     */
    externalEdit: (folderId: string, change: (project: any) => void) => {
      const file = [...files.values()].find(
        (f) => f.name === 'project.json' && f.parents.includes(folderId) && !f.trashed
      )!;
      const project = JSON.parse(file.content.toString('utf8'));
      change(project);
      file.content = Buffer.from(JSON.stringify(project, null, 2));
      file.version++;
    },
    /** Run `run` once, right after the next read of a project.json (so a change lands between a load and a save). */
    afterNextProjectRead: (run: () => void) => {
      afterProjectRead = run;
    },
    /** The Drive version of the project.json in a folder. */
    versionOf: (folderId: string) =>
      [...files.values()].find(
        (f) => f.name === 'project.json' && f.parents.includes(folderId) && !f.trashed
      )?.version,
    /** The project.json stored in a folder, parsed. */
    projectIn: (folderId: string) => {
      const file = [...files.values()].find(
        (f) => f.name === 'project.json' && f.parents.includes(folderId) && !f.trashed
      );
      return file ? JSON.parse(file.content.toString('utf8')) : null;
    },
    file: (id: string) => files.get(id),
    /** A file by its Drive name, trashed or not (unlike liveFiles). */
    fileNamed: (name: string) => [...files.values()].find((f) => f.name === name),
    liveFiles: () => [...files.values()].filter((f) => !f.trashed && f.mimeType !== FOLDER),
  };
}

export type FakeGoogle = ReturnType<typeof createFakeGoogle>;
