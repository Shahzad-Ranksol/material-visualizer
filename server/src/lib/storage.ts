import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// S3-compatible object storage. Locally this points at MinIO; in production at AWS S3
// (or any S3-compatible provider) — only the env vars change, never the code.
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see server/.env.example)`);
  return value;
};

export const storageConfig = {
  bucket: required('S3_BUCKET'),
  region: process.env.S3_REGION || 'us-east-1',
  // Leave S3_ENDPOINT empty for real AWS S3; set it for MinIO / R2 / Spaces
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  // Base URL objects are publicly served from, e.g. http://localhost:9000/material-visualizer
  // locally, or https://cdn.example.com / https://<bucket>.s3.<region>.amazonaws.com in production
  publicUrl: required('S3_PUBLIC_URL').replace(/\/+$/, ''),
};

export const s3 = new S3Client({
  region: storageConfig.region,
  endpoint: storageConfig.endpoint,
  forcePathStyle: storageConfig.forcePathStyle,
  credentials: {
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
});

export const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type UploadFolder = 'materials' | 'showcase';

// Keys are always namespaced by tenant so one vendor's files can never collide with another's
export const uploadImage = async (
  tenantId: string,
  folder: UploadFolder,
  body: Buffer,
  contentType: string
): Promise<string> => {
  const key = `tenants/${tenantId}/${folder}/${randomUUID()}.${IMAGE_EXTENSIONS[contentType]}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: storageConfig.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
  return `${storageConfig.publicUrl}/${key}`;
};

// Best-effort cleanup of a file we previously uploaded for this tenant. URLs pointing
// anywhere else (pasted links, another tenant's prefix) are left alone.
export const deleteTenantImage = async (tenantId: string, url: string): Promise<void> => {
  const prefix = `${storageConfig.publicUrl}/tenants/${tenantId}/`;
  if (!url.startsWith(prefix)) return;
  const key = url.slice(storageConfig.publicUrl.length + 1);
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: key }));
  } catch (err) {
    console.error(`Could not delete stored image ${key}`, err);
  }
};
