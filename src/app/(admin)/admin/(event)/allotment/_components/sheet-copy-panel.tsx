"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronDown, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t } from "@/content/strings"
import { resyncMatrix, savePaymentConfig } from "../../config/actions"

// The optional Google Sheet copy of the seat list, folded away beside the
// matrix it copies. It used to live in two places (the link under money, the
// resync under committees) and read like part of setting up the event.
export function SheetCopyPanel({ url, isAdmin }: { url: string; isAdmin: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState(url)

  const save = () =>
    startTransition(async () => {
      const next = value.trim()
      if (next && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(next)) {
        toast.error(t("admin.sheetCopy.badUrl"))
        return
      }
      const result = await savePaymentConfig({ sheetSyncUrl: next })
      if (!result.success) {
        toast.error(result.error ?? "")
        return
      }
      toast.success(t("admin.sheetCopy.saved"))
      router.refresh()
    })

  const resync = () =>
    startTransition(async () => {
      const result = await resyncMatrix()
      if (!result.success) {
        toast.error(result.error ?? "")
        return
      }
      if (result.failed) toast.error(t("admin.sheetCopy.resyncFailed", { synced: result.synced ?? 0, failed: result.failed }))
      else toast.success(t("admin.sheetCopy.resynced", { synced: result.synced ?? 0 }))
    })

  return (
    <details className="group editorial-card p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {t("admin.sheetCopy.title")}
        <span className="font-normal text-muted-foreground">{url ? t("admin.sheetCopy.on") : t("admin.sheetCopy.off")}</span>
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">{t("admin.sheetCopy.body")}</p>
        <div className="space-y-1.5">
          <Label htmlFor="sheet-copy-url">{t("admin.sheetCopy.urlLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="sheet-copy-url"
              className="max-w-lg"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("admin.sheetCopy.urlPlaceholder")}
              disabled={!isAdmin || pending}
            />
            {isAdmin && (
              <Button variant="outline" disabled={pending || value.trim() === url} onClick={save}>
                {t("admin.sheetCopy.save")}
              </Button>
            )}
          </div>
          {!isAdmin && <p className="text-xs text-muted-foreground">{t("admin.sheetCopy.adminOnly")}</p>}
        </div>
        {url && (
          <Button variant="ghost" className="gap-1.5" disabled={pending} onClick={resync}>
            <RefreshCw className="size-4" />
            {pending ? t("admin.sheetCopy.resyncing") : t("admin.sheetCopy.resync")}
          </Button>
        )}
      </div>
    </details>
  )
}
