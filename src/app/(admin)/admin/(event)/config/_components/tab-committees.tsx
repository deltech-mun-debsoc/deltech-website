"use client"

import { useState, useTransition, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { createCommittee, updateCommittee, deleteCommittee } from "../actions"
import type { ClientCommittee } from "../_lib/types"

const schema = z.object({
  name: z.string().min(2, "Required"),
  slug: z
    .string()
    .min(2, "Required")
    .regex(/^[a-z0-9-]+$/, "Lowercase, numbers, hyphens only"),
  agenda: z.string(),
  type: z.enum(["STANDARD", "CRISIS", "PRESS"]),
  doubleDelegation: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0),
  aliasesText: z.string(),
  portfolioTagLabel: z.string(),
  matrixBrief: z.string(),
})

type FormValues = z.infer<typeof schema>

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
}

interface Props {
  committees: ClientCommittee[]
}

export function TabCommittees({ committees }: Props) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ClientCommittee | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const form = useForm<FormValues, unknown, FormValues>({
    defaultValues: {
      name: "",
      slug: "",
      agenda: "",
      type: "STANDARD",
      doubleDelegation: false,
      isActive: true,
      sortOrder: 0,
      aliasesText: "",
      portfolioTagLabel: "",
      matrixBrief: "",
    },
    resolver: zodResolver(schema) as never,
  })

  const watchedName = form.watch("name")

  // Auto-generate slug from name when adding new
  useEffect(() => {
    if (!editTarget) {
      form.setValue("slug", slugify(watchedName))
    }
  }, [watchedName, editTarget, form])

  const openAdd = () => {
    setEditTarget(null)
    form.reset({
      name: "",
      slug: "",
      agenda: "",
      type: "STANDARD",
      doubleDelegation: false,
      isActive: true,
      sortOrder: committees.length,
      aliasesText: "",
      portfolioTagLabel: "",
      matrixBrief: "",
    })
    setDialogOpen(true)
  }

  const openEdit = (c: ClientCommittee) => {
    setEditTarget(c)
    form.reset({
      name: c.name,
      slug: c.slug,
      agenda: c.agenda ?? "",
      type: c.type,
      doubleDelegation: c.doubleDelegation,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      aliasesText: c.aliases.join(", "),
      portfolioTagLabel: c.portfolioTagLabel ?? "",
      matrixBrief: c.matrixBrief ?? "",
    })
    setDialogOpen(true)
  }

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      const payload = {
        name: data.name,
        slug: data.slug,
        agenda: data.agenda || undefined,
        type: data.type,
        doubleDelegation: data.doubleDelegation,
        isActive: data.isActive,
        sortOrder: data.sortOrder,
        aliases: data.aliasesText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        portfolioTagLabel: data.portfolioTagLabel || undefined,
        matrixBrief: data.matrixBrief || undefined,
      }

      const result = editTarget
        ? await updateCommittee(editTarget.id, payload)
        : await createCommittee(payload)

      if (result.success) {
        toast.success(editTarget ? "Committee updated." : "Committee created.")
        setDialogOpen(false)
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed.")
      }
    })
  })

  const handleDelete = (id: string) => {
    setDeletingId(id)
    startTransition(async () => {
      const result = await deleteCommittee(id)
      setDeletingId(null)
      if (result.success) {
        toast.success("Committee deleted.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed to delete.")
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{committees.length} committees</p>
        <Button size="sm" className="gap-1.5" onClick={openAdd}>
          <Plus className="size-3.5" /> Add committee
        </Button>
      </div>

      <div className="overflow-x-auto border-y border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60">
              {["Name", "Seat label", "Type", "Double delegation", "Active", "Order", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {committees.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No committees yet. Add one above.
                </td>
              </tr>
            ) : (
              committees.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{c.portfolioTagLabel || "Not set"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-xs">
                      {c.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center text-xs">
                    {c.doubleDelegation ? "✓" : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={c.isActive ? "default" : "outline"} className="text-xs">
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-xs text-muted-foreground">
                    {c.sortOrder}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => openEdit(c)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:bg-destructive/10"
                        onClick={() => handleDelete(c.id)}
                        disabled={deletingId === c.id}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false) }}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit committee" : "Add committee"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input {...form.register("name")} />
                {form.formState.errors.name && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Slug</Label>
                <Input {...form.register("slug")} />
                {form.formState.errors.slug && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.slug.message}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Agenda (optional)</Label>
              <Input
                {...form.register("agenda")}
                placeholder="e.g. Digital Healthcare"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Aliases (comma-separated, for imports)</Label>
              <Input
                {...form.register("aliasesText")}
                placeholder="e.g. DISEC, GA1, General Assembly 1"
              />
              <p className="text-xs text-muted-foreground">
                Alternative names partners use in their sheets, matched automatically on import.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Classification label</Label>
                <Input
                  {...form.register("portfolioTagLabel")}
                  placeholder="Participation, Party, Region, Faction…"
                />
                <p className="text-xs text-muted-foreground">
                  For example: Participation, Party, or Membership
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Matrix type</Label>
                <Controller
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="STANDARD">Country matrix</SelectItem>
                        <SelectItem value="CRISIS">People / specialized</SelectItem>
                        <SelectItem value="PRESS">Press corps</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Default scenario brief</Label>
              <Textarea
                {...form.register("matrixBrief")}
                rows={3}
                placeholder="What is happening now? Which actors, blocs, parties, or offices matter to this agenda?"
              />
              <p className="text-xs text-muted-foreground">
                This grounds every generated draft. Update it whenever the real-world scenario changes.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Sort order</Label>
                <Input {...form.register("sortOrder")} type="number" min={0} />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <Controller
                control={form.control}
                name="doubleDelegation"
                render={({ field }) => (
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(checked) => field.onChange(checked)}
                    />
                    Double delegation (two delegates per seat)
                  </label>
                )}
              />
              {editTarget && (
                <Controller
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked)}
                      />
                      Active
                    </label>
                  )}
                />
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : editTarget ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
