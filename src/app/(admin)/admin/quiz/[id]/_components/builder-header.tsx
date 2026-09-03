"use client"

import { useState } from "react"
import { Check, Loader2, ChevronDown, Play } from "lucide-react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { t } from "@/content/strings"
import { PRESET_THEMES, presetThemeKey, type PresentationTheme, type SlideMode } from "@/lib/quiz-types"

interface Props {
  presentationId: string
  title: string
  mode: SlideMode
  theme: PresentationTheme
  saveStatus: "saved" | "saving" | "dirty"
  onTitleChange: (v: string) => void
  onModeChange: (v: SlideMode) => void
  onThemeChange: (v: PresentationTheme) => void
}

// Custom colour inputs for the theme editor
function ColourRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono text-foreground">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-6 cursor-pointer rounded border border-border bg-transparent p-0"
        />
      </div>
    </div>
  )
}

export function BuilderHeader({
  presentationId, title, mode, theme, saveStatus, onTitleChange, onModeChange, onThemeChange,
}: Props) {
  const [themeOpen, setThemeOpen] = useState(false)
  const activeKey = presetThemeKey(theme)
  const themeLabel = activeKey
    ? t(`quiz.builder.themes.${activeKey}` as Parameters<typeof t>[0])
    : t("quiz.builder.themes.custom")

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 overflow-hidden border-b border-white/10 bg-ink px-3 text-paper sm:h-20 sm:gap-4 sm:px-5">
      {/* Title */}
      <Input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder={t("quiz.builder.titlePlaceholder")}
        className="h-11 min-w-0 flex-1 rounded-none border-0 border-b border-white/20 bg-transparent px-0 font-sans text-base font-semibold text-paper shadow-none focus-visible:border-primary focus-visible:ring-0 sm:max-w-64 sm:text-lg"
      />

      <div className="hidden h-8 w-px bg-white/15 sm:block" />

      {/* Mode toggle */}
      <div className="flex shrink-0 items-center gap-2">
        <Label htmlFor="mode-switch" className="hidden cursor-pointer select-none text-sm text-paper/55 md:block">
          {t("quiz.modes.POLL")}
        </Label>
        <Switch
          id="mode-switch"
          aria-label="Toggle quiz mode"
          size="sm"
          checked={mode === "QUIZ"}
          onCheckedChange={(v) => onModeChange(v ? "QUIZ" : "POLL")}
        />
        <Label htmlFor="mode-switch" className="hidden cursor-pointer select-none text-sm text-paper/55 md:block">
          {t("quiz.modes.QUIZ")}
        </Label>
      </div>

      <div className="hidden h-8 w-px bg-white/15 md:block" />

      {/* Theme picker */}
      <DropdownMenu open={themeOpen} onOpenChange={setThemeOpen}>
        <DropdownMenuTrigger aria-label="Choose presentation theme" className="flex h-11 shrink-0 items-center gap-2 border border-white/20 px-2.5 text-sm transition-colors hover:bg-white/10 sm:px-3">
          <span
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border/50"
            style={{ background: theme.background }}
          >
            <span className="size-2 rounded-[1px]" style={{ background: theme.accentColor }} />
          </span>
          <span className="hidden lg:inline">{themeLabel}</span>
          <ChevronDown className="size-4 text-paper/55" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {/* The label and the presets are one group. Base UI's GroupLabel reads
              its group from context and THROWS when there is none, so a bare
              label -- which is how the same component is written under Radix --
              took the whole builder down the moment this menu was opened. */}
          <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs">{t("quiz.builder.themes.presets")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {Object.entries(PRESET_THEMES).map(([key, preset]) => (
            <DropdownMenuItem
              key={key}
              onClick={() => { onThemeChange(preset); setThemeOpen(false) }}
              className="flex items-center gap-2 text-sm"
            >
              <span
                className="inline-flex size-5 shrink-0 items-center justify-center rounded border border-border/50"
                style={{ background: preset.background }}
              >
                <span className="size-2.5 rounded-sm" style={{ background: preset.accentColor }} />
              </span>
              <span className="flex-1">{t(`quiz.builder.themes.${key}` as Parameters<typeof t>[0])}</span>
              {key === activeKey && <Check className="size-3.5 shrink-0" />}
            </DropdownMenuItem>
          ))}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />
          <div className="px-2 py-2 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">{t("quiz.builder.themes.custom")}</p>
            <ColourRow label="Background" value={theme.background} onChange={(v) => onThemeChange({ ...theme, background: v })} />
            <ColourRow label="Text" value={theme.textColor} onChange={(v) => onThemeChange({ ...theme, textColor: v })} />
            <ColourRow label="Accent" value={theme.accentColor} onChange={(v) => onThemeChange({ ...theme, accentColor: v })} />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Spacer */}
      {/* Present button */}
      <Link
        href={`/admin/quiz/${presentationId}/present`}
        aria-label={t("quiz.presentButton")}
        className="flex h-11 shrink-0 items-center gap-2 bg-primary px-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 md:px-5"
      >
        <Play className="size-4" />
        <span className="hidden md:inline">{t("quiz.presentButton")}</span>
      </Link>

      {/* Save status */}
      <div className="hidden min-w-24 items-center gap-1.5 text-sm text-paper/55 xl:flex">
        {saveStatus === "saving" && <><Loader2 className="size-3 animate-spin" />{t("quiz.builder.saving")}</>}
        {saveStatus === "saved"  && <><Check className="size-3 text-teal-300" /><span className="text-teal-300">{t("quiz.builder.saved")}</span></>}
        {saveStatus === "dirty"  && <span className="text-muted-foreground/60">{t("quiz.builder.unsaved")}</span>}
      </div>
    </header>
  )
}
