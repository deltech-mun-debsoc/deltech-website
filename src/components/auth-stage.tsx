"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowLeft } from "lucide-react"
import { t } from "@/content/strings"
import { BrandMark } from "@/components/brand-logo"

// Keep the editorial sign-in stage while letting the form start high on phones.
// Status and payment pages use only the quiet bar below.
export function BrandBar() {
  return (
    <header className="section-shell flex h-16 shrink-0 items-center">
      <Link href="/" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <BrandMark className="h-6" />
        <span className="font-semibold">{t("brand.name")}</span>
      </Link>
    </header>
  )
}

export function AuthStage({
  marker,
  children,
}: {
  marker?: string
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const accent = "#c8a25a"

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
        <section className="flex flex-col justify-between gap-5 px-5 pb-5 pt-5 sm:p-10 lg:min-h-svh lg:p-14">
          <Link
            href="/"
            className="flex w-fit items-center gap-3 rounded-md text-sm font-medium text-white/70 outline-none transition-colors hover:text-white focus-visible:ring-3 focus-visible:ring-white/60"
          >
            <ArrowLeft className="size-4" aria-hidden />
            <BrandMark className="h-6 text-white" />
            <span>Home</span>
          </Link>
          <div className="relative z-10 lg:py-0">
            <p className="text-sm font-medium" style={{ color: accent }}>{marker || t("brand.tagline")}</p>
            <p className="mt-6 hidden font-display text-[clamp(4rem,7vw,7rem)] font-normal leading-[0.98] tracking-[-0.015em] lg:block" aria-hidden="true">
              DelTech<br />MUN.
            </p>
          </div>
          <p className="hidden border-t border-white/15 pt-6 text-sm text-white/60 lg:block">{t("brand.tagline")}</p>
        </section>

        <section className="relative flex items-start justify-center border-t border-white/15 bg-white/[0.035] px-4 py-6 sm:p-10 lg:items-center lg:border-l lg:border-t-0">
          {/* A CSS entrance, not framer: the form must be visible before (and
              without) hydration. */}
          <div
            className="theme-light relative w-full max-w-lg bg-[#f3eee2] p-6 text-[#111614] shadow-[8px_8px_0_var(--auth-accent)] animate-in fade-in-0 slide-in-from-bottom-3 duration-500 motion-reduce:animate-none [&_input]:bg-white sm:p-10 sm:shadow-[14px_14px_0_var(--auth-accent)]"
            style={{ "--auth-accent": accent } as React.CSSProperties}
          >
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
