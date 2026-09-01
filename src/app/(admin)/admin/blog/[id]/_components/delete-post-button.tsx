"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { deletePost } from "../actions"

// Deliberately its own component rather than another button inside
// ModerationPanel: that panel returns a plain status badge for anything not
// PENDING or CHANGES_REQUESTED, so a delete living inside it would be invisible
// on exactly the posts most likely to need pulling -- the published ones.
export function DeletePostButton({ postId, title }: { postId: string; title: string }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deletePost(postId)
      // On success the action redirects and this never runs.
      if (result?.error) toast.error(result.error)
    })
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-full gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive"
        disabled={isPending}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
        Delete post
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
          </DialogHeader>
          {/* Naming the post is the whole point of the step: the button lives in
              a sidebar that looks identical on every post. */}
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{title}</span> and its uploaded
            images will be removed permanently. This cannot be undone. To take a post
            off the site while keeping it, reject it instead.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
