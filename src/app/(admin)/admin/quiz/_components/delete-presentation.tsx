"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Archive, ArchiveRestore, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { deletePresentation, deleteQuizRun, setPresentationArchived } from "../actions"

const ICON_BUTTON =
  "rounded-sm p-1.5 text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"

// Sits on the card, outside the link that opens the show, so clicking it never
// navigates.
export function DeletePresentation({ id, title, runs }: { id: string; title: string; runs: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <button
        type="button"
        aria-label={`Delete ${title}`}
        title="Delete"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        className={`${ICON_BUTTON} hover:bg-destructive/10 hover:text-destructive`}
      >
        <Trash2 className="size-4" />
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title="Delete this presentation?"
        description={
          runs > 0
            ? `"${title}" has been played ${runs} time${runs === 1 ? "" : "s"}. Deleting it removes its slides and the results of every run, leaderboards included. Download them from Results first if you need them. This cannot be undone; archive it instead to just hide it.`
            : `"${title}" and all of its slides are removed. This cannot be undone.`
        }
        confirmLabel="Delete presentation"
        destructive
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deletePresentation(id)
            if (result.error) {
              toast.error(result.error)
              return
            }
            setOpen(false)
            toast.success(`Deleted "${title}"`)
            router.refresh()
          })
        }
      />
    </>
  )
}

export function ArchivePresentation({ id, title, archived }: { id: string; title: string; archived: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const Icon = archived ? ArchiveRestore : Archive

  return (
    <button
      type="button"
      aria-label={`${archived ? "Restore" : "Archive"} ${title}`}
      title={archived ? "Restore" : "Archive"}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        startTransition(async () => {
          const result = await setPresentationArchived(id, !archived)
          if (result.error) {
            toast.error(result.error)
            return
          }
          toast.success(archived ? `Restored "${title}"` : `Archived "${title}"`)
          router.refresh()
        })
      }}
      className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
    >
      <Icon className="size-4" />
    </button>
  )
}

export function DeleteRun({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
      >
        <Trash2 className="size-4" /> Delete run
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title="Delete this run?"
        description={`Every answer and the leaderboard for ${label} are removed. The presentation itself stays. This cannot be undone.`}
        confirmLabel="Delete run"
        destructive
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteQuizRun(id)
            if (result.error) {
              toast.error(result.error)
              return
            }
            setOpen(false)
            toast.success("Run deleted")
            router.refresh()
          })
        }
      />
    </>
  )
}
