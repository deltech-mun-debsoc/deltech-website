"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowLeft } from "lucide-react"
import { t } from "@/content/strings"
import { BrandMark } from "@/components/brand-logo"

// The sign-in family: sign-in, staff sign-in, sign-up, check-your-email and the
// account page. A dark stage with one headline, and a cream form panel.
// On a phone the stage collapses to a few lines so the form starts high.
export function AuthStage({
  kind = "delegate",
  marker,
  headline,
  intro,
  children,
}: {
  kind?: "delegate" | "staff"
  marker: string
  headline: [string, string]
  intro?: string
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const accent = kind === "staff" ? "#f4c86a" : "#2dd4bf"

  return (
    <main className="overscroll-dark relative min-h-svh overflow-hidden bg-[#060a09] text-white">
      <div className="paper-grid absolute inset-0 opacity-[0.08]" aria-hidden />
      <motion.div
        aria-hidden
        className="absolute -left-64 -top-64 size-[52rem] rounded-full border border-white/10"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      >
        <div className="absolute inset-20 rounded-full border border-dashed border-white/15" />
        <div className="absolute left-1/2 top-0 h-1/2 w-px origin-bottom" style={{ background: accent, opacity: 0.45 }} />
      </motion.div>

      <div className="relative grid min-h-svh grid-rows-[auto_1fr] lg:grid-cols-[1.05fr_0.95fr] lg:grid-rows-none">
        <section className="flex flex-col justify-between gap-6 px-5 pb-6 pt-5 sm:p-10 lg:min-h-svh lg:p-14">
          <Link
            href="/"
            className="flex w-fit items-center gap-3 rounded-md text-sm font-medium text-white/70 outline-none transition-colors hover:text-white focus-visible:ring-3 focus-visible:ring-white/60"
          >
            <ArrowLeft className="size-4" aria-hidden />
            <BrandMark className="h-6 text-white" />
            <span>{t("auth.backHome")}</span>
          </Link>
          <div className="relative z-10 lg:py-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
              {marker}
            </p>
            <h1 className="mt-4 font-display text-[clamp(3rem,7.5vw,7.5rem)] font-[560] leading-[0.92] tracking-[-0.03em] [font-variation-settings:'opsz'_96] lg:mt-8">
              <span className="block">{headline[0]}</span>
              <span className="block">{headline[1]}</span>
            </h1>
            {intro && <p className="mt-8 hidden max-w-xl text-lg leading-relaxed text-white/65 sm:block sm:text-xl">{intro}</p>}
          </div>
          <p className="hidden border-t border-white/15 pt-6 text-sm text-white/60 lg:block">{t("brand.tagline")}</p>
        </section>

        <section className="relative flex items-start justify-center border-t border-white/15 bg-white/[0.035] px-4 py-6 sm:p-10 lg:items-center lg:border-l lg:border-t-0">
          {/* A CSS entrance, not framer: the form must be visible before (and
              without) hydration. */}
          <div
            className="theme-light relative w-full max-w-xl bg-[#f3eee2] p-6 [&_input]:bg-white text-[#111614] shadow-[10px_10px_0_var(--auth-accent)] animate-in fade-in-0 slide-in-from-bottom-3 duration-500 motion-reduce:animate-none sm:p-10 sm:shadow-[16px_16px_0_var(--auth-accent)]"
            style={{ "--auth-accent": accent } as React.CSSProperties}
          >
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
