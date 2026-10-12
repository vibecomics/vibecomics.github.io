/**
 * Connections to an S3-compatible bucket (any self-hosted server, or real AWS S3 / R2 / B2,
 * by connection string alone — see s3Config.ts). No OAuth: an accessKeyId/secretAccessKey pair,
 * checked once with HeadBucket. Several can be connected at once (see storage/connections.ts).
 */
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { StorageBackendImpl } from '../storage/backend';
import { createS3Client } from './s3Client';
import { s3Label } from './s3Config';
import type { S3Credentials, S3TargetConfig } from './s3Config';
import { createS3Rest } from './s3Rest';

/** Check that the bucket is reachable with these credentials before adding the connection. */
export async function checkS3Health(
  config: S3TargetConfig,
  credentials: S3Credentials
): Promise<void> {
  const client = createS3Client(config, credentials);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (e) {
    throw new Error(
      `Could not reach bucket "${config.bucket}" at ${config.endpoint}: ` +
        `${e instanceof Error ? e.message : String(e)}. Check the endpoint, bucket and credentials.`
    );
  } finally {
    client.destroy();
  }
}

/** One connected bucket's `StorageBackendImpl`, bound to a fixed config and credentials. */
export function createS3Backend(
  config: S3TargetConfig,
  credentials: S3Credentials
): StorageBackendImpl {
  let client: S3Client | null = createS3Client(config, credentials);
  const rest = createS3Rest({ getClient: () => client, bucket: config.bucket });
  return {
    label: s3Label(config),
    listProjectFolders: rest.listProjectFolders,
    ensureProjectFolder: rest.ensureProjectFolder,
    uploadImage: rest.uploadImage,
    trashFile: rest.trashFile,
    downloadFile: rest.downloadFile,
    findFileByName: rest.findFileByName,
    listFolderFiles: rest.listFolderFiles,
    saveProjectJson: rest.saveProjectJson,
    loadProjectFile: rest.loadProjectFile,
    hasAccess: () => client !== null,
    disconnect: () => {
      client?.destroy();
      client = null;
    },
  };
}
