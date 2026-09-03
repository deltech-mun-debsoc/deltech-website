"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { CheckCircle, AlertCircle, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { approvePost, requestChanges, rejectPost } from "../actions"

type PostStatus = "PENDING" | "PUBLISHED" | "CHANGES_REQUESTED" | "REJECTED" | "DRAFT"

interface Props {
  postId: string
  status: PostStatus
}

const STATUS_DISPLAY: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  PUBLISHED: {
    label: "Published",
    icon: <CheckCircle className="size-4" />,
    className: "text-teal-700 bg-teal-50 border-teal-200 dark:text-teal-300 dark:bg-teal-950/30 dark:border-teal-800",
  },
  REJECTED: {
    label: "Rejected",
    icon: <XCircle className="size-4" />,
    className: "text-destructive bg-destructive/5 border-destructive/20",
  },
  DRAFT: {
    label: "Draft",
    icon: null,
    className: "text-muted-foreground bg-muted border-border",
  },
}

export function ModerationPanel({ postId, status }: Props) {
  const [dialog, setDialog] = useState<"changes" | "reject" | null>(null)
  const [note, setNote] = useState("")
  const [isPending, startTransition] = useTransition()

  if (status !== "PENDING" && status !== "CHANGES_REQUESTED") {
    const display = STATUS_DISPLAY[status]
    if (!display) return null
    return (
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${display.className}`}>
        {display.icon}
        {display.label}
      </div>
    )
  }

  const handleApprove = () => {
    startTransition(async () => {
      const result = await approvePost(postId)
      if (result?.error) toast.error(result.error)
    })
  }

  const handleChanges = () => {
    startTransition(async () => {
      const result = await requestChanges(postId, note)
      if (result?.error) toast.error(result.error)
      else setDialog(null)
    })
  }

  const handleReject = () => {
    startTransition(async () => {
      const result = await rejectPost(postId, note)
      if (result?.error) toast.error(result.error)
      else setDialog(null)
    })
  }

  return (
    <>
      <div className="space-y-2">
        {status === "CHANGES_REQUESTED" && (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertCircle className="size-3.5 shrink-0" />
            Author is addressing changes
          </div>
        )}

        {/* No className override: the default variant is already bg-primary
            text-primary-foreground, which moves with the theme. The old
            bg-teal-600 override was a fixed color that stayed put while every
            other primary button on the page correctly went pale-teal-on-dark
            in dark mode -- the "Approve" button just didn't match anything
            else on the page any more. */}
        <Button
          className="w-full"
          disabled={isPending}
          onClick={handleApprove}
        >
          Approve & Publish
        </Button>

        <Button
          variant="outline"
          className="w-full"
          disabled={isPending}
          onClick={() => { setNote(""); setDialog("changes") }}
        >
          Request Changes
        </Button>

        <Button
          variant="outline"
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/5"
          disabled={isPending}
          onClick={() => { setNote(""); setDialog("reject") }}
        >
          Reject
        </Button>
      </div>

      <Dialog open={dialog === "changes"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Describe what needs to be changed or improved…"
            rows={5}
            className="resize-none"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleChanges} disabled={isPending || !note.trim()}>
              Send Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "reject"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Post</DialogTitle>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for rejection (sent to author)…"
            rows={4}
            className="resize-none"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isPending || !note.trim()}
            >
              Reject Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
