/**
 * One-off setup for a bucket on any S3-compatible server (self-hosted or real AWS S3/R2/B2):
 * creates it if missing, then applies the full CORS rule the browser needs (see
 * src/s3/s3Rest.ts's doc comment — the app's S3 client runs in the browser too, and needs the
 * ETag response header exposed for its optimistic-concurrency version checks).
 *
 *   node scripts/configure-s3-bucket.mjs <connectionString> [--origin <origin>]...
 *
 * <connectionString> is the same s3://accessKeyId[:secretAccessKey]@host/bucket the app takes
 * (see src/s3/s3Config.ts; the parsing here is a plain-JS copy of that logic, kept dependency-free
 * so this script runs on any Node build, independent of TypeScript-stripping support). Repeat
 * --origin for more than one allowed origin; with none given, allows "*" (any origin — fine on a
 * home network where the real access control is the credentials, not CORS).
 */
import {
  CreateBucketCommand,
  PutBucketCorsCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

function parseS3ConnectionString(input) {
  const trimmed = input.trim();
  let url;
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

const [connectionString, ...flags] = process.argv.slice(2);
if (!connectionString) {
  console.error(
    'usage: node scripts/configure-s3-bucket.mjs <connectionString> [--origin <origin>]...'
  );
  process.exit(1);
}

const origins = [];
for (let i = 0; i < flags.length; i++) {
  if (flags[i] === '--origin' && flags[i + 1]) {
    origins.push(flags[++i]);
  }
}

const { config, credentials } = parseS3ConnectionString(connectionString);
const client = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: config.forcePathStyle,
  credentials,
});

async function main() {
  try {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
    console.log(`Created bucket "${config.bucket}".`);
  } catch (e) {
    if (
      e instanceof S3ServiceException &&
      ['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(e.name)
    ) {
      console.log(`Bucket "${config.bucket}" already exists.`);
    } else {
      throw e;
    }
  }

  await client.send(
    new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins.length > 0 ? origins : ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );
  console.log(
    `Applied CORS to "${config.bucket}": origins [${(origins.length > 0 ? origins : ['*']).join(', ')}], ` +
      'methods GET/PUT/POST/HEAD/DELETE, ETag exposed.'
  );
}

await main();
