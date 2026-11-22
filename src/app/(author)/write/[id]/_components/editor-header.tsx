"use client"

import Link from "next/link"
import { ChevronLeft, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"

interface Props {
  postId:    string
  saveStatus: "saved" | "saving" | "dirty"
  readMin:   number
  words:     number
  canSubmit: boolean
  onSave:    () => void
  onSubmit:  () => void
}

export function EditorHeader({
  saveStatus,
  readMin,
  words,
  canSubmit,
  onSave,
  onSubmit,
}: Props) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-gray-100 bg-white/90 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <Link
          href="/blog/write"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ChevronLeft className="size-4" />
          {t("blog.write.backToDesk")}
        </Link>

        <div className="h-4 w-px bg-gray-200" />

        {/* Save status */}
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="size-3 animate-spin" />
              Saving…
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <Check className="size-3 text-teal-600" />
              <span className="text-teal-600">Saved</span>
            </>
          )}
          {saveStatus === "dirty" && (
            <span className="text-gray-300">Unsaved</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Read-time */}
        {words > 0 && (
          <span className="text-xs text-gray-400">
            {words} words · {readMin} min read
          </span>
        )}

        <Button
          size="sm"
          variant="ghost"
          onClick={onSave}
          disabled={saveStatus === "saving"}
          className={cn("text-xs", saveStatus === "dirty" ? "text-foreground" : "text-muted-foreground")}
        >
          Save draft
        </Button>

        {canSubmit && (
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={saveStatus === "saving"}
          >
            Submit for review →
          </Button>
        )}

        {!canSubmit && (
          <span className="text-xs text-muted-foreground">In review</span>
        )}
      </div>
    </header>
  )
}
