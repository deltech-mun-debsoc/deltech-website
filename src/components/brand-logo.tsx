import Image from "next/image"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"

type Tone = "white" | "black"

// The official lockup (wreath, sword, D and wordmark). It belongs in one deliberate
// place, the footer, not on every surface.
export function BrandLogo({ tone, className }: { tone: Tone; className?: string }) {
  return <Image src={`/brand/deltech-mun-${tone}.png`} alt={t("brand.logoAlt")} width={1103} height={1247} sizes="160px" className={cn("h-auto select-none", className)} />
}

// The D monogram traced from the official mark, without the wreath and sword so it
// holds up at header and favicon sizes. It takes the text colour: black on light
// surfaces, white on dark ones. src/app/icon.svg uses the same outline.
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 630 665" fill="currentColor" aria-hidden="true" className={cn("h-7 w-auto shrink-0", className)}>
      <path d="M0 0H297A332.5 332.5 0 0 1 297 665H0V169H90V572H297A239.5 239.5 0 0 0 297 93H0Z" />
      <path fillRule="evenodd" d="M0 169H297A163.5 163.5 0 0 1 297 496H166V261H0ZM253 261H297A72 72 0 0 1 297 405H253Z" />
    </svg>
  )
}
