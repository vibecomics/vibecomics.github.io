/**
 * S3 target configuration and credentials, carried in one connection string so
 * storage.connectWithS3() takes a single parameter, the same shape "connect to a server" had
 * before. In the browser, the whole thing (credentials included) is remembered in localStorage —
 * see storage/connections.ts — so a bucket reconnects automatically next load; the CLI instead
 * reads credentials fresh from the environment each run (src/cli/nodeSession.ts).
 *
 *   s3://<accessKeyId>[:<secretAccessKey>]@<host>[:<port>]/<bucket>[?region=...&tls=1&pathStyle=0]
 *
 * The secret may be blank (`s3://mykey@host/bucket` or `s3://mykey:@host/bucket`) for a key
 * configured with an empty secret on the server — this still signs every request normally (SigV4
 * signing with an empty-string secret is well-defined, so it still "looks like" an ordinary signed
 * S3 request); it just means the server was set up with nothing secret to check it against.
 *
 * Defaults: region "us-east-1", tls off (plain http, the common case for a self-hosted server on
 * a home network), pathStyle on (required by most self-hosted S3-compatible servers; also works
 * against real S3/R2/B2).
 */

export interface S3TargetConfig {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
}

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export function parseS3ConnectionString(input: string): {
  config: S3TargetConfig;
  credentials: S3Credentials;
} {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`"${trimmed}" is not a valid S3 connection string.`);
  }
  if (url.protocol !== 's3:') {
    throw new Error(
      'An S3 connection string must start with s3://accessKeyId[:secretAccessKey]@host/bucket.'
    );
  }
  if (!url.username) {
    throw new Error('An S3 connection string must include an accessKeyId before the host.');
  }
  const bucket = decodeURIComponent(url.pathname.replace(/^\/+/, '').replace(/\/+$/, ''));
  if (!bucket) {
    throw new Error(
      'An S3 connection string must name a bucket after the host, e.g. s3://key@host:9000/my-bucket.'
    );
  }
  const tls = url.searchParams.get('tls') === '1';
  const region = url.searchParams.get('region') || 'us-east-1';
  const forcePathStyle = url.searchParams.get('pathStyle') !== '0';
  return {
    config: { endpoint: `${tls ? 'https' : 'http'}://${url.host}`, region, bucket, forcePathStyle },
    credentials: {
      accessKeyId: decodeURIComponent(url.username),
      secretAccessKey: decodeURIComponent(url.password),
    },
  };
}

/** Build a connection string from parts, for the UI form that collects them separately. */
export function buildS3ConnectionString(
  config: Omit<S3TargetConfig, 'endpoint'> & { host: string; tls?: boolean },
  credentials: S3Credentials
): string {
  const params = new URLSearchParams();
  if (config.region && config.region !== 'us-east-1') params.set('region', config.region);
  if (config.tls) params.set('tls', '1');
  if (!config.forcePathStyle) params.set('pathStyle', '0');
  const query = params.toString();
  const userinfo = credentials.secretAccessKey
    ? `${encodeURIComponent(credentials.accessKeyId)}:${encodeURIComponent(credentials.secretAccessKey)}`
    : encodeURIComponent(credentials.accessKeyId);
  return `s3://${userinfo}@${config.host}/${encodeURIComponent(config.bucket)}${query ? `?${query}` : ''}`;
}

/** A connection id stable for a given endpoint+bucket, with no secret in it. */
export const s3ConnectionId = (config: S3TargetConfig): string =>
  `s3:${config.endpoint}/${config.bucket}`;

/** A display label with credentials stripped — safe to show in the UI and status messages. */
export const s3Label = (config: S3TargetConfig): string => `${config.endpoint}/${config.bucket}`;
