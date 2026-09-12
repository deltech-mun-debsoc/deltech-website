import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { PRESIGN_TTL_SECONDS } from "./keys"

// Server-only S3 access. Credentials are read from the environment and never
// serialised into a response: the browser only ever receives a presigned URL, which
// is scoped to one key, one content type, one length and a five-minute window.

export interface S3Config {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  // Optional CDN / custom domain for public objects.
  publicBaseUrl?: string
  // Optional custom endpoint (MinIO, R2, LocalStack) for local development.
  endpoint?: string
}

export class MediaNotConfigured extends Error {
  constructor() {
    super("S3 is not configured: set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.")
    this.name = "MediaNotConfigured"
  }
}

// Read lazily rather than at import time, so a build without S3 credentials (CI)
// does not fail and unrelated pages keep working when media is unconfigured.
export function s3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET
  const region = process.env.S3_REGION
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null

  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || undefined,
    endpoint: process.env.S3_ENDPOINT || undefined,
  }
}

export function requireS3Config(): S3Config {
  const config = s3Config()
  if (!config) throw new MediaNotConfigured()
  return config
}

let cached: { client: S3Client; key: string } | null = null

function client(config: S3Config): S3Client {
  // Cache per credential set so a rotated key is picked up without a restart.
  const cacheKey = `${config.region}:${config.bucket}:${config.accessKeyId}:${config.endpoint ?? ""}`
  if (cached?.key === cacheKey) return cached.client

  const created = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  })
  cached = { client: created, key: cacheKey }
  return created
}

// A presigned PUT for exactly one object. ContentType and ContentLength are pinned
// into the signature, so the browser cannot upload a different type or a larger file
// than the server validated and recorded.
export async function presignUpload(args: {
  key: string
  contentType: string
  contentLength: number
}): Promise<string> {
  const config = requireS3Config()
  return getSignedUrl(
    client(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: args.key,
      ContentType: args.contentType,
      ContentLength: args.contentLength,
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  )
}

// Upload straight from the server. Team photos arrive at our own route already
// cropped and size-checked, so there is nothing for a presigned browser PUT to
// buy: one hop instead of two, and the bytes never touch the database.
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const config = requireS3Config()
  await client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // The URL carries no version, so the browser must revalidate; S3 answers
      // 304 when nothing changed.
      CacheControl: "public, max-age=300",
    }),
  )
}

// A short-lived read URL for SIGNED objects (candidate documents).
export async function presignDownload(key: string, ttlSeconds = PRESIGN_TTL_SECONDS): Promise<string> {
  const config = requireS3Config()
  return getSignedUrl(
    client(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: ttlSeconds },
  )
}

export interface HeadResult {
  exists: boolean
  sizeBytes?: number
  contentType?: string
  etag?: string
}

// Verifies what actually landed in the bucket. This is the step that makes the
// pipeline trustworthy: the declared size and type are re-checked against the real
// object before the asset is marked READY.
export async function headObject(key: string): Promise<HeadResult> {
  const config = requireS3Config()
  try {
    const result = await client(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
    )
    return {
      exists: true,
      sizeBytes: typeof result.ContentLength === "number" ? result.ContentLength : undefined,
      contentType: result.ContentType,
      etag: result.ETag?.replace(/"/g, ""),
    }
  } catch (err) {
    if (isNotFound(err)) return { exists: false }
    throw err
  }
}

// Used by the orphan sweep and by replace/delete. A missing object is a success,
// the goal is "not there", and reporting an error would block the row cleanup.
export async function deleteObject(key: string): Promise<void> {
  const config = requireS3Config()
  try {
    await client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
  } catch (err) {
    if (isNotFound(err)) return
    throw err
  }
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404
}
