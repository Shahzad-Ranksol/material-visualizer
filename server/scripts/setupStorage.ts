import 'dotenv/config';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { s3, storageConfig } from '../src/lib/storage.js';

// One-time (idempotent) bucket setup: create it, make uploaded images publicly readable,
// and allow browsers to fetch them cross-origin (the canvas compositor loads material
// thumbnails with crossOrigin="anonymous"). Run with `npm run storage:setup`.
const { bucket } = storageConfig;

const ensureBucket = async () => {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" already exists`);
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created bucket "${bucket}"`);
  }
};

const setPublicReadPolicy = async () => {
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/tenants/*`],
          },
        ],
      }),
    })
  );
  console.log('Applied public-read policy on tenants/*');
};

const setCors = async () => {
  const origins = (process.env.S3_CORS_ORIGINS || '*').split(',').map((o) => o.trim());
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [{ AllowedMethods: ['GET', 'HEAD'], AllowedOrigins: origins, AllowedHeaders: ['*'], MaxAgeSeconds: 3600 }],
        },
      })
    );
    console.log(`Applied CORS for origins: ${origins.join(', ')}`);
  } catch (err: any) {
    // MinIO doesn't implement bucket CORS — it already allows all origins by default
    if (err?.name === 'NotImplemented') {
      console.log('Bucket CORS not supported by this provider (MinIO allows all origins by default) — skipped');
      return;
    }
    throw err;
  }
};

await ensureBucket();
await setPublicReadPolicy();
await setCors();
console.log('Storage ready.');
