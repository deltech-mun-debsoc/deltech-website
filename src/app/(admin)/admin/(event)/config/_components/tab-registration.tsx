"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { setRegistrationOpen } from "../actions"

interface Props {
  registrationOpen: boolean
}

export function TabRegistration({ registrationOpen }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(registrationOpen)
  const [isPending, startTransition] = useTransition()

  const handleToggle = (checked: boolean) => {
    setOpen(checked)
    startTransition(async () => {
      const result = await setRegistrationOpen(checked)
      if (result.success) {
        toast.success(checked ? "Registration is now open." : "Registration is now closed.")
        router.refresh()
      } else {
        setOpen(!checked)
        toast.error("Failed to update registration status.")
      }
    })
  }

  return (
    <div className="mx-auto max-w-md space-y-10 py-10">
      <div className="space-y-2 text-center">
        <div
          className={[
            "text-5xl font-extrabold tracking-tight transition-colors",
            open ? "text-primary" : "text-muted-foreground",
          ].join(" ")}
        >
          {open ? "OPEN" : "CLOSED"}
        </div>
        <p className="text-sm text-muted-foreground">
          {open
            ? "Delegates can currently submit their registration."
            : "Delegates will see the configured closed message."}
        </p>
      </div>

      <div className="flex items-center justify-center gap-4">
        <span className="text-sm font-medium text-muted-foreground">Closed</span>
        <Switch
          checked={open}
          onCheckedChange={handleToggle}
          disabled={isPending}
          size="default"
        />
        <span className="text-sm font-medium text-muted-foreground">Open</span>
      </div>

      {isPending && (
        <p className="text-center text-xs text-muted-foreground">Saving…</p>
      )}
    </div>
  )
}
