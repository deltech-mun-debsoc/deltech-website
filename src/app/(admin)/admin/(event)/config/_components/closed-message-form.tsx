"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { saveContent } from "../actions"

export function ClosedMessageForm({ value }: { value: string }) {
  const router = useRouter()
  const [message, setMessage] = useState(value)
  const [isPending, startTransition] = useTransition()

  const save = () =>
    startTransition(async () => {
      const result = await saveContent({ registrationClosedMessage: message })
      if (result.success) {
        toast.success("Closed message saved.")
        router.refresh()
      } else {
        toast.error(result.error ?? "Failed to save.")
      }
    })

  return (
    <div className="space-y-3">
      <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}
