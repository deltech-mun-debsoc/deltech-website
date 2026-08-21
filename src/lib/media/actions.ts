"use server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { audit } from "@/lib/audit"
import {
  MEDIA_POLICY,
  buildObjectKey,
  publicUrlFor,
  validateUpload,
  type MediaKindName,
} from "./keys"
import { MediaNotConfigured, deleteObject, headObject, presignDownload, presignUpload, requireS3Config } from "./s3"

// Two-phase S3 upload.
//
//   createUploadIntent  → validate permission, type and size → PENDING row →
//                         presigned PUT (5 min, type and length pinned)
//   browser             → PUT straight to S3
//   finalizeUpload      → HeadObject re-checks the real object → READY + URL
//
// The credentials never leave the server; the client only ever holds a signature for
// one key. A PUT that is started and abandoned leaves a PENDING row, swept by
// /api/cron/media-sweep, which is the orphan strategy rather than hoping clients
// always finish.

export type UploadIntent =
  | {
      ok: true
      assetId: string
      uploadUrl: string
      objectKey: string
      // Echoed back so the client PUTs exactly what was signed.
      contentType: string
    }
  | { ok: false, error: string }

const REFUSAL_MESSAGE: Record<string, string> = {
  "unknown-kind": "Unsupported upload type.",
  "unsupported-type": "That file type is not allowed.",
  "too-large": "That file is too large.",
  "empty-file": "That file is empty.",
}

// Who may upload what. Authors upload post media; staff upload team photos;
// recruitment documents require a recruitment role on the candidate's cycle.
async function authorize(kind: MediaKindName, ownerId?: string) {
  const session = await auth()
  const user = session?.user as { id?: string; email?: string | null; role?: string } | undefined
  if (!user?.id || !user.email) return null

  const role = user.role ?? "AUTHOR"

  if (kind === "POST_IMAGE" || kind === "POST_COVER") {
    if (!["AUTHOR", "ADMIN", "MAINTAINER"].includes(role)) return null
    // Ownership, not just role: an author may only attach media to their own post.
    if (ownerId) {
      const post = await prisma.post.findUnique({
        where: { id: ownerId },
        select: { authorId: true },
      })
      if (!post) return null
      const isStaff = role === "ADMIN" || role === "MAINTAINER"
      if (post.authorId !== user.id && !isStaff) return null
    }
    return { userId: user.id, email: user.email, role }
  }

  if (kind === "MEMBER_IMAGE") {
    if (!["ADMIN", "MAINTAINER"].includes(role)) return null
    return { userId: user.id, email: user.email, role }
  }

  if (kind === "CANDIDATE_DOC") {
    if (!ownerId) return null
    const candidate = await prisma.recruitmentCandidate.findUnique({
      where: { id: ownerId },
      select: { cycleId: true },
    })
    if (!candidate) return null
    // Recruitment authority is per-cycle, resolved the same way as everywhere else.
    const { resolveCycleContext, visibleGroupIds } = await import("@/lib/recruitment/authz")
    const ctx = await resolveCycleContext(candidate.cycleId)
    if (!ctx) return null
    // A cycle role is not enough: candidate documents are personal data, so the
    // same scoping as every other candidate surface applies. `null` means no
    // restriction (maintainers and admins); a JC gets only the candidates seated
    // in a group they staff.
    const groupIds = await visibleGroupIds(ctx)
    if (groupIds) {
      const seated = await prisma.recruitmentGroupMember.count({
        where: { candidateId: ownerId, groupId: { in: groupIds } },
      })
      if (seated === 0) return null
    }
    return { userId: user.id, email: user.email, role }
  }

  return null
}

export async function createUploadIntent(input: {
  kind: MediaKindName
  mimeType: string
  sizeBytes: number
  ownerType?: string
  ownerId?: string
}): Promise<UploadIntent> {
  const actor = await authorize(input.kind, input.ownerId)
  if (!actor) return { ok: false, error: "You are not permitted to upload here." }

  // Server-side validation of type and size. The client's own checks are a courtesy;
  // this is the one that counts, and the values are pinned into the signature.
  const validation = validateUpload(input.kind, input.mimeType, input.sizeBytes)
  if (!validation.ok || !validation.extension || !validation.policy) {
    return { ok: false, error: REFUSAL_MESSAGE[validation.refusal ?? ""] ?? "That file was refused." }
  }

  try {
    const config = requireS3Config()
    const contentType = input.mimeType.split(";")[0].trim().toLowerCase()

    // The row is created first so the key is derived from a real id, and so an
    // abandoned upload is visible to the sweep rather than invisible.
    const asset = await prisma.mediaAsset.create({
      data: {
        uploaderId: actor.userId,
        kind: input.kind,
        bucket: config.bucket,
        // Placeholder: replaced immediately below, once we have the id.
        objectKey: `pending/${crypto.randomUUID()}`,
        mimeType: contentType,
        sizeBytes: input.sizeBytes,
        status: "PENDING",
        visibility: validation.policy.visibility,
        ownerType: input.ownerType ?? null,
        ownerId: input.ownerId ?? null,
      },
      select: { id: true },
    })

    const objectKey = buildObjectKey({
      kind: input.kind,
      uploaderId: actor.userId,
      assetId: asset.id,
      extension: validation.extension,
    })

    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { objectKey } })

    const uploadUrl = await presignUpload({
      key: objectKey,
      contentType,
      contentLength: input.sizeBytes,
    })

    return { ok: true, assetId: asset.id, uploadUrl, objectKey, contentType }
  } catch (err) {
    if (err instanceof MediaNotConfigured) {
      return { ok: false, error: "Uploads are not configured on this environment." }
    }
    console.error("[media/createUploadIntent]", err)
    return { ok: false, error: "Could not start the upload." }
  }
}

export type FinalizeResult =
  | { ok: true; url: string; assetId: string }
  | { ok: false; error: string }

// Confirms the object really arrived, with the size and type we signed for, before
// marking it usable. A mismatch fails the asset and deletes the object rather than
// publishing something unverified.
export async function finalizeUpload(assetId: string): Promise<FinalizeResult> {
  const session = await auth()
  const user = session?.user as { id?: string; email?: string | null; role?: string } | undefined
  if (!user?.id) return { ok: false, error: "Not signed in." }

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      uploaderId: true,
      objectKey: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      visibility: true,
      publicUrl: true,
      kind: true,
      bucket: true,
    },
  })
  if (!asset) return { ok: false, error: "Upload not found." }

  const isStaff = user.role === "ADMIN" || user.role === "MAINTAINER"
  if (asset.uploaderId !== user.id && !isStaff) {
    return { ok: false, error: "That upload belongs to someone else." }
  }

  // Idempotent: finalising twice returns the same URL.
  if (asset.status === "READY" && asset.publicUrl) {
    return { ok: true, url: asset.publicUrl, assetId: asset.id }
  }

  try {
    const config = requireS3Config()
    const head = await headObject(asset.objectKey)

    if (!head.exists) {
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: "FAILED", error: "Object was not found in the bucket." },
      })
      return { ok: false, error: "The upload did not complete. Try again." }
    }

    // Re-validate against the real object, not the client's claims.
    const realType = (head.contentType ?? "").split(";")[0].trim().toLowerCase()
    const check = validateUpload(asset.kind, realType || asset.mimeType, head.sizeBytes ?? 0)
    if (!check.ok) {
      await deleteObject(asset.objectKey)
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: "FAILED", error: `Rejected on verification: ${check.refusal}.` },
      })
      return { ok: false, error: REFUSAL_MESSAGE[check.refusal ?? ""] ?? "That file was refused." }
    }

    const url =
      asset.visibility === "PUBLIC"
        ? publicUrlFor(asset.objectKey, {
            bucket: config.bucket,
            region: config.region,
            baseUrl: config.publicBaseUrl,
          })
        : // Signed assets get a short-lived URL now and a fresh one on each read.
          await presignDownload(asset.objectKey)

    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: "READY",
        finalizedAt: new Date(),
        sizeBytes: head.sizeBytes ?? asset.sizeBytes,
        mimeType: realType || asset.mimeType,
        checksum: head.etag ?? null,
        // Only a public URL is stored; a signed one would expire in the database.
        publicUrl: asset.visibility === "PUBLIC" ? url : null,
        error: null,
      },
    })

    return { ok: true, url, assetId: asset.id }
  } catch (err) {
    if (err instanceof MediaNotConfigured) {
      return { ok: false, error: "Uploads are not configured on this environment." }
    }
    console.error("[media/finalizeUpload]", err)
    return { ok: false, error: "Could not verify the upload." }
  }
}

// Soft-delete plus object removal. Uploader or staff only.
export async function deleteMediaAsset(assetId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  const user = session?.user as { id?: string; email?: string | null; role?: string } | undefined
  if (!user?.id || !user.email) return { ok: false, error: "Not signed in." }

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: { id: true, uploaderId: true, objectKey: true, status: true },
  })
  if (!asset) return { ok: false, error: "Upload not found." }
  if (asset.status === "DELETED") return { ok: true } // idempotent

  const isStaff = user.role === "ADMIN" || user.role === "MAINTAINER"
  if (asset.uploaderId !== user.id && !isStaff) {
    return { ok: false, error: "That upload belongs to someone else." }
  }

  try {
    await deleteObject(asset.objectKey)
    // The row is kept as a tombstone so a URL still stored in post content can be
    // traced to a deliberate deletion rather than looking like data loss.
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "DELETED", deletedAt: new Date(), publicUrl: null },
    })
    await audit(user.email, "media.delete", "MediaAsset", asset.id, { objectKey: asset.objectKey })
    return { ok: true }
  } catch (err) {
    if (err instanceof MediaNotConfigured) {
      return { ok: false, error: "Uploads are not configured on this environment." }
    }
    console.error("[media/deleteMediaAsset]", err)
    return { ok: false, error: "Could not delete the file." }
  }
}

// A fresh signed URL for a SIGNED asset. Never returns a URL for a deleted asset.
export async function getSignedMediaUrl(assetId: string): Promise<{ url?: string; error?: string }> {
  const session = await auth()
  const user = session?.user as { id?: string; role?: string } | undefined
  if (!user?.id) return { error: "Not signed in." }

  const asset = await prisma.mediaAsset.findUnique({
    where: { id: assetId },
    select: { objectKey: true, status: true, visibility: true, uploaderId: true, ownerId: true, kind: true },
  })
  if (!asset || asset.status !== "READY") return { error: "Upload not available." }

  if (asset.visibility === "PUBLIC") return { error: "That asset is public; use its URL." }

  // Re-authorise on every read: a signed URL is a capability, so the permission
  // must be checked now rather than at upload time.
  const actor = await authorize(asset.kind as MediaKindName, asset.ownerId ?? undefined)
  if (!actor) return { error: "You are not permitted to view that file." }

  try {
    return { url: await presignDownload(asset.objectKey) }
  } catch (err) {
    if (err instanceof MediaNotConfigured) return { error: "Uploads are not configured." }
    console.error("[media/getSignedMediaUrl]", err)
    return { error: "Could not sign that URL." }
  }
}

export { MEDIA_POLICY }
