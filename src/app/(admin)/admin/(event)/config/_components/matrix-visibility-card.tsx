"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { saveContent } from "../actions"

// Controls whether /availability shows the full named matrix or counts only.
export function MatrixVisibilityCard({ matrixPublic }: { matrixPublic: boolean }) {
  const router = useRouter()
  const [isPublic, setIsPublic] = useState(matrixPublic)
  const [isPending, startTransition] = useTransition()

  const toggle = (checked: boolean) => {
    setIsPublic(checked)
    startTransition(async () => {
      const result = await saveContent({ matrixPublic: checked })
      if (result.success) {
        toast.success(checked ? "Full matrix is now public." : "Public page shows counts only.")
        router.refresh()
      } else {
        setIsPublic(!checked)
        toast.error(result.error ?? "Failed to save.")
      }
    })
  }

  return (
    <div className="editorial-card flex items-center justify-between gap-4 p-6">
      <div>
        <h2 className="font-heading text-lg">Public matrix visibility</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          On: /availability shows every portfolio with its live status. Off: open counts only.
        </p>
      </div>
      <Switch checked={isPublic} onCheckedChange={toggle} disabled={isPending} />
    </div>
  )
}
