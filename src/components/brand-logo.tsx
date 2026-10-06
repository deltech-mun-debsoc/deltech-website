import Image from "next/image"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"

type Tone = "white" | "navy" | "black" | "auto"

const FULL = { width: 1103, height: 1247 }
const EMBLEM = { width: 1090, height: 724 }

type Props = { tone?: Tone; className?: string; priority?: boolean; sizes?: string }

function Variant({ kind, tone, className, priority, sizes }: Omit<Props, "tone"> & { kind: "full" | "emblem"; tone: Exclude<Tone, "auto"> }) {
  const size = kind === "full" ? FULL : EMBLEM
  const src = kind === "full" ? `/brand/deltech-mun-${tone}.png` : `/brand/deltech-mun-emblem-${tone}.png`
  return <Image src={src} alt={t("brand.logoAlt")} width={size.width} height={size.height} priority={priority} sizes={sizes ?? (kind === "full" ? "240px" : "96px")} className={cn("h-auto select-none", className)} />
}

// "auto" follows the theme: navy on light surfaces, white on dark ones.
function Themed({ kind, tone = "auto", className, ...rest }: Props & { kind: "full" | "emblem" }) {
  if (tone !== "auto") return <Variant kind={kind} tone={tone} className={className} {...rest} />
  return (
    <>
      <Variant kind={kind} tone="navy" className={cn(className, "dark:hidden")} {...rest} />
      <Variant kind={kind} tone="white" className={cn(className, "hidden dark:block")} {...rest} />
    </>
  )
}

export function BrandLogo(props: Props) {
  return <Themed kind="full" {...props} />
}

export function BrandEmblem(props: Props) {
  return <Themed kind="emblem" {...props} />
}
