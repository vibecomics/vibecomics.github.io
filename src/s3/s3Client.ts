/**
 * The one place that constructs an S3Client: nothing provider-specific here, so the exact same
 * code works against any self-hosted S3-compatible server and real AWS S3 / Cloudflare R2 /
 * Backblaze B2, by changing only the connection string (storage/connections.ts, s3Config.ts).
 */
import { S3Client } from '@aws-sdk/client-s3';
import type { S3Credentials, S3TargetConfig } from './s3Config';

export function createS3Client(config: S3TargetConfig, credentials: S3Credentials): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials,
  });
}
