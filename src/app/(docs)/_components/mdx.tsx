import Image from "next/image"
import Link from "next/link"
import {
  AlertTriangle,
  Info,
  Lightbulb,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react"
import type { ComponentPropsWithoutRef, ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"

/* ------------------------------------------------------------------ Callout */

type CalloutTone = "note" | "tip" | "warning" | "danger"

const CALLOUT: Record<
  CalloutTone,
  { icon: LucideIcon; labelKey: `docs.callout.${CalloutTone}`; rule: string; icon_: string }
> = {
  note: {
    icon: Info,
    labelKey: "docs.callout.note",
    rule: "border-l-[color-mix(in_oklch,var(--primary)_55%,transparent)]",
    icon_: "text-primary",
  },
  tip: {
    icon: Lightbulb,
    labelKey: "docs.callout.tip",
    rule: "border-l-[color-mix(in_oklch,var(--gold-500)_65%,transparent)]",
    icon_: "text-accent-foreground",
  },
  warning: {
    icon: AlertTriangle,
    labelKey: "docs.callout.warning",
    rule: "border-l-[var(--signal)]",
    icon_: "text-[var(--signal)]",
  },
  danger: {
    icon: OctagonAlert,
    labelKey: "docs.callout.danger",
    rule: "border-l-destructive",
    icon_: "text-destructive",
  },
}

export function Callout({
  type = "note",
  title,
  children,
}: {
  type?: CalloutTone
  title?: string
  children: ReactNode
}) {
  const tone = CALLOUT[type]
  const Icon = tone.icon
  return (
    <div
      className={cn(
        "editorial-card my-6 border-l-[3px] px-4 py-3.5 sm:px-5",
        tone.rule,
      )}
    >
      <p className="mb-1.5 flex items-center gap-2">
        <Icon className={cn("size-4 shrink-0", tone.icon_)} aria-hidden="true" />
        <span className="data-label text-foreground">
          {title ?? t(tone.labelKey)}
        </span>
      </p>
      <div className="[&>*+*]:mt-2 [&>p]:text-[0.9375rem] [&>p]:leading-relaxed [&>p]:text-muted-foreground [&>ul]:text-[0.9375rem] [&>ul]:text-muted-foreground">
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- Steps */

/**
 * Wraps an ordered list into a numbered walkthrough with a connecting rule.
 * The registration wizard, the launch runbook and local setup all use it, which
 * is why the numbering is CSS rather than markup: MDX authors just write `1.`.
 */
export function Steps({ children }: { children: ReactNode }) {
  return <div className="docs-steps">{children}</div>
}

/* --------------------------------------------------------------- Screenshot */

/**
 * Captures are light-theme only and framed so they read as an embedded artifact
 * in either theme. Maintaining a dark twin of every image doubles the capture
 * cost and the staleness surface for very little gain.
 */
export function Screenshot({
  src,
  alt,
  caption,
  width = 1440,
  height = 900,
}: {
  src: string
  alt?: string
  caption?: string
  width?: number
  height?: number
}) {
  return (
    <figure className="my-7">
      <div className="overflow-hidden rounded-lg border border-border bg-[oklch(0.975_0.008_84)] shadow-xs">
        <Image
          src={src}
          alt={alt ?? t("docs.screenshotFallback")}
          width={width}
          height={height}
          // The article column is a fixed max-w-3xl, so without this hint the
          // optimizer is told the image might be viewport-wide and picks a much
          // larger candidate than the slot ever needs.
          sizes="(max-width: 1024px) 100vw, 768px"
          className="h-auto w-full"
        />
      </div>
      {caption ? (
        <figcaption className="mt-2.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}

/* ------------------------------------------------------------------- Figure */

/** Wrapper for the inline SVG diagrams. Keeps caption styling in one place. */
export function Figure({
  caption,
  children,
}: {
  caption?: string
  children: ReactNode
}) {
  return (
    <figure className="my-7">
      <div className="editorial-card overflow-x-auto p-4 sm:p-6">{children}</div>
      {caption ? (
        <figcaption className="mt-2.5 text-[0.8125rem] leading-relaxed text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}

/* ---------------------------------------------------------------- RoleBadge */

const ROLE_TONE: Record<string, "default" | "secondary" | "outline"> = {
  ADMIN: "default",
  MAINTAINER: "secondary",
  SUB_MAINTAINER: "outline",
  AUTHOR: "outline",
  MEMBER: "outline",
  REGISTERER: "outline",
  AC: "default",
  SC: "secondary",
  JC: "outline",
}

/** Inline "who can do this" marker. `label` carries the human wording. */
export function RoleBadge({ role, label }: { role: string; label: string }) {
  return (
    <Badge variant={ROLE_TONE[role] ?? "outline"} className="mx-0.5 align-middle">
      {label}
    </Badge>
  )
}

/* -------------------------------------------------------------- Link mapper */

/** Internal hrefs go through next/link; external ones open in a new tab. */
export function MdxLink({
  href = "",
  children,
  ...rest
}: ComponentPropsWithoutRef<"a">) {
  const external = /^https?:\/\//.test(href)
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
        {children}
      </a>
    )
  }
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  )
}

/** Every markdown table is wrapped so wide ones scroll inside their own box. */
export function MdxTable(props: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="table-scroll my-6">
      <table {...props} />
    </div>
  )
}
