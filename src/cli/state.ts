/**
 * What the CLI remembers between runs, in one JSON file (mode 0600, in a 0700
 * folder): the Google login (a refresh token and the current access token),
 * any S3-compatible buckets connected (endpoint/bucket/region only — never
 * credentials, which the CLI instead reads fresh from VIBECOMICS_S3_ACCESS_KEY_ID /
 * VIBECOMICS_S3_SECRET_ACCESS_KEY on every run), the open project (and which
 * connection it came from), and the current page. Each CLI run is a separate
 * process, so this is the only thing that carries a login and an "open
 * project" from one command to the next. `VIBECOMICS_HOME` picks the folder
 * (default `~/.vibecomics`).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceCodeInfo } from '../drive/deviceOAuth';
import type { GeneratorConfig } from '../generators/types';
import type { S3TargetConfig } from '../s3/s3Config';

/** A device login the user has been asked to approve but has not yet. */
export interface PendingLogin {
  deviceCode: string;
  intervalSeconds: number;
  /** Epoch milliseconds. */
  expiresAt: number;
  info: DeviceCodeInfo;
}

export interface AuthState {
  refreshToken?: string;
  accessToken?: string;
  /** Epoch milliseconds. */
  accessTokenExpiresAt?: number;
  pending?: PendingLogin;
}

export interface CliState {
  auth?: AuthState;
  /** S3-compatible bucket targets connected this way: endpoint/bucket/region only, never credentials. */
  s3?: S3TargetConfig[];
  /**
   * The open project's folder, and which connection it came from: `"drive"` or
   * `` `s3:<endpoint>/<bucket>` `` (matching the browser's connection id scheme in
   * storage/connections.ts). Absent `connectionId` (a state file from before multi-backend
   * support) means `"drive"`.
   */
  project?: { id: string; name: string; connectionId?: string };
  /** The current page of the open project (0-based). */
  pageIndex?: number;
  /** The image generator config (see ComicBuilder.generate). ComfyUI has no login, so it's plain. */
  generator?: GeneratorConfig;
}

export function stateDir(env: Record<string, string | undefined>): string {
  return env.VIBECOMICS_HOME || path.join(os.homedir(), '.vibecomics');
}

export class StateStore {
  readonly file: string;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, 'state.json');
  }

  read(): CliState {
    let text: string;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
    try {
      return JSON.parse(text) as CliState;
    } catch {
      throw new Error(`${this.file} is not valid JSON. Delete it and run "vibecomics auth login".`);
    }
  }

  write(state: CliState): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  update(change: (state: CliState) => CliState): CliState {
    const next = change(this.read());
    this.write(next);
    return next;
  }
}
