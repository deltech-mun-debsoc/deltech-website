"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { List, Monitor, SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type SlideData,
  type SlideType,
  type SlideMode,
  type PresentationTheme,
  DEFAULT_THEME,
} from "@/lib/quiz-types"
import {
  addSlide,
  updateSlide,
  deleteSlide,
  duplicateSlide,
  reorderSlides,
  updatePresentationMeta,
} from "../actions"
import { BuilderHeader } from "./builder-header"
import { SlidePanel } from "./slide-panel"
import { SlidePreview } from "./slide-preview"
import { ConfigPanel } from "./config-panel"

interface Props {
  presentation: {
    id: string
    title: string
    mode: SlideMode
    theme: PresentationTheme | null
  }
  initialSlides: SlideData[]
}

export function BuilderClient({ presentation, initialSlides }: Props) {
  const [slides, setSlides] = useState<SlideData[]>(initialSlides)
  const [selectedId, setSelectedId] = useState<string | null>(initialSlides[0]?.id ?? null)
  const [title, setTitle] = useState(presentation.title)
  const [mode, setMode] = useState<SlideMode>(presentation.mode)
  const [theme, setTheme] = useState<PresentationTheme>(presentation.theme ?? DEFAULT_THEME)
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">("saved")
  const [mobilePane, setMobilePane] = useState<"slides" | "canvas" | "config">(
    initialSlides.length ? "canvas" : "slides",
  )

  const slideTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const metaTimer   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // pending slide saves: slideId → latest SlideData
  const pendingSaves = useRef<Map<string, SlideData>>(new Map())

  const selectedSlide = slides.find((s) => s.id === selectedId) ?? null

  // ── Slide content auto-save ─────────────────────────────────────────────────

  const flushSaves = useCallback(async () => {
    const batch = [...pendingSaves.current.values()]
    if (!batch.length) return
    pendingSaves.current.clear()
    setSaveStatus("saving")
    const results = await Promise.all(
      batch.map((s) => updateSlide(s.id, { prompt: s.prompt, config: s.config })),
    )
    if (results.some((r) => r.error)) {
      setSaveStatus("dirty")
      toast.error("Auto-save failed.")
    } else {
      setSaveStatus("saved")
    }
  }, [])

  const scheduleSlide = (slide: SlideData) => {
    pendingSaves.current.set(slide.id, slide)
    setSaveStatus("dirty")
    clearTimeout(slideTimer.current)
    slideTimer.current = setTimeout(flushSaves, 1500)
  }

  // ── Meta auto-save ──────────────────────────────────────────────────────────

  const scheduleMeta = (t2: string, m: SlideMode, th: PresentationTheme) => {
    setSaveStatus("dirty")
    clearTimeout(metaTimer.current)
    metaTimer.current = setTimeout(async () => {
      setSaveStatus("saving")
      const result = await updatePresentationMeta(presentation.id, { title: t2, mode: m, theme: th })
      if (result.error) setSaveStatus("dirty")
      else setSaveStatus("saved")
    }, 800)
  }

  const handleTitleChange = (v: string) => { setTitle(v); scheduleMeta(v, mode, theme) }
  const handleModeChange  = (v: SlideMode) => { setMode(v); scheduleMeta(title, v, theme) }
  const handleThemeChange = (v: PresentationTheme) => { setTheme(v); scheduleMeta(title, mode, v) }

  // ── Slide edits ─────────────────────────────────────────────────────────────

  const handleSlideChange = (slideId: string, patch: Partial<Pick<SlideData, "prompt" | "config">>) => {
    setSlides((prev) =>
      prev.map((s) => (s.id === slideId ? { ...s, ...patch } : s)),
    )
    const updated = slides.find((s) => s.id === slideId)
    if (updated) scheduleSlide({ ...updated, ...patch })
  }

  // ── Structural mutations ────────────────────────────────────────────────────

  const handleAdd = async (type: SlideType) => {
    const result = await addSlide(presentation.id, type)
    if (result.error) { toast.error(result.error); return }
    if (!result.slide) return
    setSlides((prev) => [...prev, result.slide!])
    setSelectedId(result.slide.id)
    setMobilePane("config")
    setSaveStatus("saved")
  }

  const handleDelete = async (slideId: string) => {
    const result = await deleteSlide(slideId)
    if (result.error) { toast.error(result.error); return }
    setSlides((prev) => {
      const next = prev.filter((s) => s.id !== slideId).map((s, i) => ({ ...s, order: i }))
      return next
    })
    setSelectedId((prev) => {
      if (prev !== slideId) return prev
      const remaining = slides.filter((s) => s.id !== slideId)
      return remaining[0]?.id ?? null
    })
    setSaveStatus("saved")
  }

  const handleDuplicate = async (slideId: string) => {
    const result = await duplicateSlide(slideId)
    if (result.error) { toast.error(result.error); return }
    if (!result.slide) return
    setSlides((prev) => [...prev, result.slide!])
    setSelectedId(result.slide.id)
    setSaveStatus("saved")
  }

  const handleMoveUp = async (slideId: string) => {
    const idx = slides.findIndex((s) => s.id === slideId)
    if (idx <= 0) return
    const next = [...slides]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    const reordered = next.map((s, i) => ({ ...s, order: i }))
    setSlides(reordered)
    await reorderSlides(reordered.map((s) => s.id))
  }

  const handleMoveDown = async (slideId: string) => {
    const idx = slides.findIndex((s) => s.id === slideId)
    if (idx < 0 || idx >= slides.length - 1) return
    const next = [...slides]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    const reordered = next.map((s, i) => ({ ...s, order: i }))
    setSlides(reordered)
    await reorderSlides(reordered.map((s) => s.id))
  }

  // Flush on unmount
  useEffect(() => {
    return () => {
      clearTimeout(slideTimer.current)
      clearTimeout(metaTimer.current)
      void flushSaves()
    }
  }, [flushSaves])

  return (
    <div className="quiz-builder-shell -m-5 flex flex-col bg-[#d8d3c7] sm:-m-7 lg:-m-10">
      <BuilderHeader
        presentationId={presentation.id}
        title={title}
        mode={mode}
        theme={theme}
        saveStatus={saveStatus}
        onTitleChange={handleTitleChange}
        onModeChange={handleModeChange}
        onThemeChange={handleThemeChange}
      />

      <div className="hidden min-h-0 flex-1 lg:flex">
        {/* Left, slide list */}
        <SlidePanel
          slides={slides}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={handleAdd}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
        />

        {/* Center, live preview */}
        <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto bg-[#d8d3c7] p-8">
          <div className="pointer-events-none absolute left-6 top-5 flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.18em] text-black/35">
            <span className="size-2 bg-primary" /> Live canvas
          </div>
          {selectedSlide ? (
            <SlidePreview slide={selectedSlide} theme={theme} />
          ) : (
            <p className="text-lg font-semibold text-black/45">Choose a slide or add the first beat.</p>
          )}
        </div>

        {/* Right, config */}
        <ConfigPanel
          slide={selectedSlide}
          mode={mode}
          onChange={handleSlideChange}
        />
      </div>

      <div className="flex min-h-0 flex-1 lg:hidden">
        {mobilePane === "slides" && (
          <SlidePanel
            slides={slides}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              setMobilePane("canvas")
            }}
            onAdd={handleAdd}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            className="w-full border-0"
          />
        )}
        {mobilePane === "canvas" && (
          <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto overscroll-contain bg-[#d8d3c7] p-5 sm:p-8">
            <div className="pointer-events-none absolute left-5 top-4 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.12em] text-black/45">
              <span className="size-2 bg-primary" /> Live canvas
            </div>
            {selectedSlide ? (
              <SlidePreview slide={selectedSlide} theme={theme} />
            ) : (
              <button type="button" onClick={() => setMobilePane("slides")} className="min-h-11 px-4 text-base font-semibold text-black/55">
                Add the first slide
              </button>
            )}
          </div>
        )}
        {mobilePane === "config" && (
          <ConfigPanel
            slide={selectedSlide}
            mode={mode}
            onChange={handleSlideChange}
            className="w-full border-0"
          />
        )}
      </div>

      <nav className="grid h-16 shrink-0 grid-cols-3 border-t border-black/15 bg-background lg:hidden" aria-label="Quiz builder panes">
        {[
          { key: "slides" as const, label: "Slides", icon: List },
          { key: "canvas" as const, label: "Canvas", icon: Monitor },
          { key: "config" as const, label: "Edit", icon: SlidersHorizontal },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMobilePane(key)}
            disabled={key === "config" && !selectedSlide}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 text-sm font-semibold transition-colors",
              mobilePane === key ? "bg-ink text-paper" : "text-muted-foreground hover:bg-muted",
              "disabled:opacity-35",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
