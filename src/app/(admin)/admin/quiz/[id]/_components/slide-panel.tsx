"use client"

import { ChevronUp, ChevronDown, Copy, Trash2, Plus } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import type { SlideData, SlideType } from "@/lib/quiz-types"

// Scored formats first, then the opinion formats, then content. The order is the
// order they appear in the "add slide" menu.
const SLIDE_TYPES: SlideType[] = [
  "MCQ",
  "TRUE_FALSE",
  "TYPE_ANSWER",
  "NUMERIC",
  "WORDCLOUD",
  "SCALE",
  "OPEN_TEXT",
  "CONTENT",
]

const TYPE_COLOUR: Record<SlideType, string> = {
  MCQ:         "bg-teal-500",
  TRUE_FALSE:  "bg-emerald-500",
  TYPE_ANSWER: "bg-rose-500",
  NUMERIC:     "bg-indigo-500",
  WORDCLOUD:   "bg-purple-500",
  SCALE:       "bg-amber-500",
  OPEN_TEXT:   "bg-blue-500",
  CONTENT:     "bg-gray-400",
}

interface Props {
  slides: SlideData[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: (type: SlideType) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  className?: string
}

export function SlidePanel({
  slides, selectedId, onSelect, onAdd, onDelete, onDuplicate, onMoveUp, onMoveDown, className,
}: Props) {
  return (
    <aside className={cn("admin-rail flex shrink-0 flex-col overflow-hidden border-r border-black/15 bg-[#f5f1e8]", className)}>
      <div className="border-b border-black/10 px-4 py-4">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-black/45">Run of show · {slides.length}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {slides.length === 0 ? (
          <p className="p-8 text-center text-base text-muted-foreground">
            {t("quiz.builder.noSlides")}
          </p>
        ) : (
          <ul className="space-y-2 p-3">
            {slides.map((slide, idx) => (
              <li key={slide.id}>
                <button
                  onClick={() => onSelect(slide.id)}
                  className={cn(
                    "group w-full border px-3 py-3 text-left transition-colors",
                    selectedId === slide.id
                      ? "border-primary bg-white"
                      : "border-transparent hover:border-black/20 hover:bg-white/60",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2.5 shrink-0", TYPE_COLOUR[slide.type])} />
                    <span className="flex-1 truncate text-sm font-semibold text-foreground">
                      {slide.prompt || t(`quiz.slideType.${slide.type}` as Parameters<typeof t>[0])}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground/60">{String(idx + 1).padStart(2, "0")}</span>
                  </div>
                  <p className="mt-1 truncate pl-[18px] text-xs uppercase tracking-wider text-muted-foreground">
                    {t(`quiz.slideType.${slide.type}` as Parameters<typeof t>[0])}
                  </p>
                </button>

                {/* Actions shown only for the selected slide */}
                {selectedId === slide.id && (
                  <div className="flex items-center justify-end gap-1 px-2 pb-1 pt-2">
                    <button
                      onClick={() => onMoveUp(slide.id)}
                      disabled={idx === 0}
                      title={t("quiz.builder.moveUp")}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors"
                    >
                      <ChevronUp className="size-3" />
                    </button>
                    <button
                      onClick={() => onMoveDown(slide.id)}
                      disabled={idx === slides.length - 1}
                      title={t("quiz.builder.moveDown")}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition-colors"
                    >
                      <ChevronDown className="size-3" />
                    </button>
                    <button
                      onClick={() => onDuplicate(slide.id)}
                      title={t("quiz.builder.duplicate")}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <Copy className="size-3" />
                    </button>
                    <button
                      onClick={() => onDelete(slide.id)}
                      title={t("common.delete")}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add slide button */}
      <div className="shrink-0 border-t border-black/10 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-12 w-full items-center justify-center gap-2 bg-ink px-3 text-sm font-bold text-paper transition-opacity hover:opacity-90">
            <Plus className="size-4" />
            {t("quiz.addSlide")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {SLIDE_TYPES.map((type) => (
              <DropdownMenuItem
                key={type}
                onClick={() => onAdd(type)}
                className="gap-2 text-sm"
              >
                <span className={cn("size-2 rounded-full", TYPE_COLOUR[type])} />
                {t(`quiz.slideType.${type}` as Parameters<typeof t>[0])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}
