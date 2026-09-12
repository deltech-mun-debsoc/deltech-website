"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { deletePresentation } from "../actions"

// Sits on the card, outside the link that opens the show, so clicking it never
// navigates. A presentation that has been played refuses to delete: the server
// says why, and the message is shown as-is.
export function DeletePresentation({ id, title }: { id: string; title: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <button
        type="button"
        aria-label={`Delete ${title}`}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Trash2 className="size-4" />
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !pending && setOpen(next)}
        title="Delete this presentation?"
        description={`"${title}" and all of its slides are removed. This cannot be undone.`}
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
