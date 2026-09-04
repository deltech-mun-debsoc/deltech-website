"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import Cropper, { type Area } from "react-easy-crop"
import { Crop, Minus, Plus, Pencil, Trash2, Upload, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { t } from "@/content/strings"

export interface MemberRow {
  id: string
  name: string
  designation: string
  level: "AC" | "SC" | "JC"
  order: number
  imageUrl: string | null
  socials: { instagram?: string; linkedin?: string }
  isActive: boolean
}

type TeamLevel = "AC" | "SC" | "JC"

const TEAM_LEVELS: { value: TeamLevel; label: string }[] = [
  { value: "AC", label: "Administrative Council" },
  { value: "SC", label: "Senior Council" },
  { value: "JC", label: "Junior Council" },
]

async function prepareTeamPhoto(source: string, crop: Area): Promise<{ file?: File; error?: string }> {
  try {
    const image = new Image()
    const sourceUrl = new URL(source, window.location.href)
    if (sourceUrl.origin !== window.location.origin) image.crossOrigin = "anonymous"
    image.src = source
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = 960
    canvas.height = 1200
    const context = canvas.getContext("2d")
    if (!context) return { error: "This browser could not prepare the photo." }
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )

    for (const quality of [0.84, 0.72, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      )
      if (blob && blob.size <= 750 * 1024) {
        return { file: new File([blob], "team-photo.webp", { type: "image/webp" }) }
      }
    }
    return { error: "The photo is still too large after resizing. Choose a smaller image." }
  } catch {
    return { error: "That crop could not be prepared. Try the photo again." }
  }
}

export function TeamManager({ members, isAdmin }: { members: MemberRow[]; isAdmin: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MemberRow | null>(null)
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState("")
  const [designation, setDesignation] = useState("")
  const [level, setLevel] = useState<TeamLevel>("JC")
  const [order, setOrder] = useState(0)
  const [imageUrl, setImageUrl] = useState("")
  const [instagram, setInstagram] = useState("")
  const [linkedin, setLinkedin] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [photoError, setPhotoError] = useState("")
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState("")
  const [cropOpen, setCropOpen] = useState(false)
  const [cropSource, setCropSource] = useState("")
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 })
  const [cropPixels, setCropPixels] = useState<Area | null>(null)
  const [zoom, setZoom] = useState(1)
  const ownedCropSource = useRef("")

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    return () => {
      if (ownedCropSource.current) URL.revokeObjectURL(ownedCropSource.current)
    }
  }, [])

  const openCropper = (source: string, owned = false) => {
    if (ownedCropSource.current) URL.revokeObjectURL(ownedCropSource.current)
    ownedCropSource.current = owned ? source : ""
    setCropSource(source)
    setCropPosition({ x: 0, y: 0 })
    setCropPixels(null)
    setZoom(1)
    setPhotoError("")
    setCropOpen(true)
  }

  const closeCropper = () => {
    setCropOpen(false)
    setCropSource("")
    if (ownedCropSource.current) URL.revokeObjectURL(ownedCropSource.current)
    ownedCropSource.current = ""
  }

  const openAdd = () => {
    setEditing(null)
    setName("")
    setDesignation("")
    setLevel("JC")
    setOrder(members.filter((member) => member.level === "JC").length)
    setImageUrl("")
    setInstagram("")
    setLinkedin("")
    setIsActive(true)
    setPhotoError("")
    setPendingPhoto(null)
    setPreviewUrl("")
    setOpen(true)
  }

  const openEdit = (m: MemberRow) => {
    setEditing(m)
    setName(m.name)
    setDesignation(m.designation)
    setLevel(m.level)
    setOrder(m.order)
    setImageUrl(m.imageUrl ?? "")
    setInstagram(m.socials.instagram ?? "")
    setLinkedin(m.socials.linkedin ?? "")
    setIsActive(m.isActive)
    setPhotoError("")
    setPendingPhoto(null)
    setPreviewUrl("")
    setOpen(true)
  }

  // The editor keeps the original local until the crop is accepted. Only the
  // final 4:5 WebP is uploaded when the member itself is saved.
  const handleUpload = (file: File) => {
    setPhotoError("")
    if (!file.type.startsWith("image/")) {
      const error = "Choose an image file."
      setPhotoError(error)
      toast.error(error)
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      const error = "Choose a photo under 8 MB."
      setPhotoError(error)
      toast.error(error)
      return
    }
    openCropper(URL.createObjectURL(file), true)
  }

  const applyCrop = async () => {
    if (!cropSource || !cropPixels) return
    setUploading(true)
    setPhotoError("")
    const result = await prepareTeamPhoto(cropSource, cropPixels)
    if (result.file) {
      setPendingPhoto(result.file)
      setPreviewUrl(URL.createObjectURL(result.file))
      closeCropper()
      toast.success("Crop ready. Save the member to keep it.")
    } else {
      const error = result.error ?? t("admin.team.uploadFailed")
      setPhotoError(error)
      toast.error(error)
    }
    setUploading(false)
  }

  const save = () => {
    const data = {
      name,
      designation,
      level,
      order,
      imageUrl: imageUrl || undefined,
      socials: { instagram: instagram || undefined, linkedin: linkedin || undefined },
      isActive,
    }
    startTransition(async () => {
      let result: { success: boolean; error?: string; id?: string }
      try {
        const response = await fetch(
          editing ? `/api/admin/team/${encodeURIComponent(editing.id)}` : "/api/admin/team",
          {
            method: editing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
        )
        result = (await response.json()) as { success: boolean; error?: string; id?: string }
      } catch {
        result = { success: false, error: "Could not reach the server. Try again." }
      }
      if (result.success) {
        if (pendingPhoto && result.id) {
          try {
            const photoResponse = await fetch(
              `/api/admin/team/${encodeURIComponent(result.id)}/photo`,
              {
                method: "PUT",
                headers: { "Content-Type": pendingPhoto.type },
                body: pendingPhoto,
              },
            )
            const photoResult = (await photoResponse.json()) as {
              success: boolean
              error?: string
            }
            if (!photoResult.success) {
              toast.error(`Member saved, but the photo failed: ${photoResult.error ?? "Try editing the member again."}`)
              setOpen(false)
              router.refresh()
              return
            }
          } catch {
            toast.error("Member saved, but the photo upload lost connection. Edit the member to retry.")
            setOpen(false)
            router.refresh()
            return
          }
        }
        toast.success(editing ? "Member updated." : "Member added.")
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
      }
    })
  }

  const remove = (m: MemberRow) => {
    startTransition(async () => {
      let result: { success: boolean; error?: string }
      try {
        const response = await fetch(`/api/admin/team/${encodeURIComponent(m.id)}`, {
          method: "DELETE",
        })
        result = (await response.json()) as { success: boolean; error?: string }
      } catch {
        result = { success: false, error: "Could not reach the server. Try again." }
      }
      if (result.success) {
        toast.success("Member removed.")
        setRemoveTarget(null)
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="size-3.5" /> Add member
        </Button>
      </div>

      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          No members yet, add the board and core team here.
        </div>
      ) : (
        <div className="space-y-7">
          {TEAM_LEVELS.map((teamLevel) => {
            const sectionMembers = members.filter((member) => member.level === teamLevel.value)
            return (
              <section key={teamLevel.value} className="space-y-3">
                <div className="flex items-baseline gap-3 border-b border-border pb-2">
                  <h2 className="font-heading text-2xl">{teamLevel.label}</h2>
                  <Badge variant="outline">{teamLevel.value}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {sectionMembers.length} {sectionMembers.length === 1 ? "member" : "members"}
                  </span>
                </div>
                {sectionMembers.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No {teamLevel.label} members yet.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {sectionMembers.map((m) => (
                      <div
                        key={m.id}
                        className={`flex items-center gap-3 rounded-xl border border-border bg-card p-3 ${!m.isActive ? "opacity-50" : ""}`}
                      >
                        {m.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.imageUrl} alt={m.name} className="size-12 rounded-full object-cover" />
                        ) : (
                          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                            <User className="size-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{m.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{m.designation}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {!m.isActive && <Badge variant="outline" className="text-[10px]">hidden</Badge>}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Edit ${m.name}`}
                            onClick={() => openEdit(m)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-destructive"
                              aria-label={`Remove ${m.name}`}
                              disabled={isPending}
                              onClick={() => setRemoveTarget(m)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit member" : "Add member"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {previewUrl || imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl || imageUrl} alt="Preview" className="h-20 w-16 rounded-md object-cover" />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                  <User className="size-6 text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleUpload(f)
                    e.target.value = ""
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="size-3.5" />
                  {uploading ? "Preparing…" : previewUrl || imageUrl ? "Replace photo" : "Choose photo"}
                </Button>
                {editing && imageUrl && !previewUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    disabled={uploading}
                    onClick={() => openCropper(imageUrl)}
                  >
                    <Crop className="size-3.5" />
                    Adjust current crop
                  </Button>
                )}
              </div>
            </div>
            {photoError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {photoError} You can paste a hosted photo URL below instead.
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Photo URL (optional fallback)</Label>
              <Input
                type="url"
                value={imageUrl}
                onChange={(event) => {
                  setImageUrl(event.target.value)
                  setPhotoError("")
                }}
                placeholder="https://…/photo.jpg"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Designation</Label>
                <Input
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="President / USG Delegate Affairs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Council</Label>
                <select
                  value={level}
                  onChange={(event) => setLevel(event.target.value as TeamLevel)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {TEAM_LEVELS.map((teamLevel) => (
                    <option key={teamLevel.value} value={teamLevel.value}>
                      {teamLevel.label} ({teamLevel.value})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Instagram (optional)</Label>
                <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/…" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">LinkedIn (optional)</Label>
                <Input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Display order</Label>
                <Input
                  type="number"
                  min={0}
                  value={order}
                  onChange={(e) => setOrder(Number(e.target.value) || 0)}
                  className="w-24"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                Visible on /team
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={isPending || uploading || !name.trim() || !designation.trim()}>
              {isPending ? "Saving…" : editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cropOpen} onOpenChange={(next) => next ? setCropOpen(true) : closeCropper()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Position the photo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Drag to position the person. Keep enough of the original scene so the portrait still feels natural.
          </p>
          <div className="relative h-[min(62vh,36rem)] min-h-80 overflow-hidden rounded-lg bg-stone-950">
            {cropSource && (
              <Cropper
                image={cropSource}
                crop={cropPosition}
                zoom={zoom}
                aspect={4 / 5}
                objectFit="contain"
                showGrid
                zoomSpeed={0.12}
                minZoom={1}
                maxZoom={2.5}
                onCropChange={setCropPosition}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setCropPixels(pixels)}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <Minus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Label htmlFor="team-photo-zoom" className="sr-only">Zoom</Label>
            <input
              id="team-photo-zoom"
              type="range"
              min={1}
              max={2.5}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="h-2 w-full cursor-pointer accent-primary"
            />
            <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCropper}>Cancel</Button>
            <Button onClick={() => void applyCrop()} disabled={uploading || !cropPixels}>
              {uploading ? "Preparing…" : "Use this crop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        title="Remove team member?"
        description={removeTarget ? `Remove ${removeTarget.name} from the public team?` : ""}
        confirmLabel="Remove member"
        destructive
        pending={isPending}
        onConfirm={() => removeTarget && remove(removeTarget)}
      />
    </div>
  )
}
