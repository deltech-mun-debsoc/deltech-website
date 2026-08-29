"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Upload, User } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { createMember, updateMember, deleteMember } from "../actions"
import { uploadToS3 } from "@/lib/media/upload-client"
import { t } from "@/content/strings"

export interface MemberRow {
  id: string
  name: string
  designation: string
  order: number
  imageUrl: string | null
  socials: { instagram?: string; linkedin?: string }
  isActive: boolean
}

export function TeamManager({ members, isAdmin }: { members: MemberRow[]; isAdmin: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [uploading, setUploading] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<MemberRow | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState("")
  const [designation, setDesignation] = useState("")
  const [order, setOrder] = useState(0)
  const [imageUrl, setImageUrl] = useState("")
  const [instagram, setInstagram] = useState("")
  const [linkedin, setLinkedin] = useState("")
  const [isActive, setIsActive] = useState(true)

  const openAdd = () => {
    setEditing(null)
    setName("")
    setDesignation("")
    setOrder(members.length)
    setImageUrl("")
    setInstagram("")
    setLinkedin("")
    setIsActive(true)
    setOpen(true)
  }

  const openEdit = (m: MemberRow) => {
    setEditing(m)
    setName(m.name)
    setDesignation(m.designation)
    setOrder(m.order)
    setImageUrl(m.imageUrl ?? "")
    setInstagram(m.socials.instagram ?? "")
    setLinkedin(m.socials.linkedin ?? "")
    setIsActive(m.isActive)
    setOpen(true)
  }

  // Goes through the S3 pipeline (presigned PUT + server-side verification). Photos
  // already stored on Supabase keep resolving from their existing URLs.
  const handleUpload = async (file: File) => {
    setUploading(true)
    const result = await uploadToS3(file, "MEMBER_IMAGE")
    setUploading(false)
    if (result.url) {
      setImageUrl(result.url)
      toast.success(t("admin.team.photoUploaded"))
    } else {
      toast.error(result.error ?? t("admin.team.uploadFailed"))
    }
  }

  const save = () => {
    const data = {
      name,
      designation,
      order,
      imageUrl: imageUrl || undefined,
      socials: { instagram: instagram || undefined, linkedin: linkedin || undefined },
      isActive,
    }
    startTransition(async () => {
      const result = editing ? await updateMember(editing.id, data) : await createMember(data)
      if (result.success) {
        toast.success(editing ? "Member updated." : "Member added.")
        setOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
      }
    })
  }

  const remove = (m: MemberRow) => {
    if (!window.confirm(`Remove ${m.name} from the team?`)) return
    startTransition(async () => {
      const result = await deleteMember(m.id)
      if (result.success) {
        toast.success("Member removed.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
        // A stale row is the common case: refresh so the list matches reality
        // instead of leaving a button that will fail the same way again.
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
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
                <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(m)}>
                  <Pencil className="size-3.5" />
                </Button>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    disabled={isPending}
                    onClick={() => remove(m)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit member" : "Add member"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Preview" className="size-16 rounded-full object-cover" />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                  <User className="size-6 text-muted-foreground" />
                </div>
              )}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void handleUpload(f)
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
                  {uploading ? "Uploading…" : imageUrl ? "Replace photo" : "Upload photo"}
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
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
    </div>
  )
}
