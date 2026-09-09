"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowLeft, Fingerprint, RadioTower, ShieldCheck } from "lucide-react"

export function AuthStage({
  kind,
  children,
}: {
  kind: "delegate" | "staff"
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  const staff = kind === "staff"
  const accent = staff ? "#f4c86a" : "#2dd4bf"

  return (
    <main className="overscroll-dark relative min-h-svh overflow-hidden bg-[#060a09] text-white">
      <div className="paper-grid absolute inset-0 opacity-[0.08]" aria-hidden />
      <motion.div
        aria-hidden
        className="absolute -left-64 -top-64 size-[52rem] rounded-full border border-white/10"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: staff ? 46 : 34, repeat: Infinity, ease: "linear" }}
      >
        <div className="absolute inset-20 rounded-full border border-dashed border-white/15" />
        <div className="absolute inset-40 rounded-full border border-white/10" />
        <div className="absolute left-1/2 top-0 h-1/2 w-px origin-bottom" style={{ background: accent, opacity: 0.5 }} />
      </motion.div>
      <motion.div
        aria-hidden
        className="absolute bottom-[18%] right-[9%] size-3"
        style={{ background: accent, boxShadow: "0 0 55px 18px " + accent + "55" }}
        animate={reduce ? undefined : { x: [0, -180, -60, 0], y: [0, -100, 80, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden
        className="absolute inset-y-0 w-px bg-white/10"
        animate={reduce ? undefined : { left: ["15%", "88%", "42%", "15%"] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative grid min-h-svh lg:grid-cols-[1.05fr_0.95fr]">
        <section className="flex min-h-[46svh] flex-col justify-between p-6 sm:p-10 lg:min-h-svh lg:p-14">
          <Link href="/" className="flex w-fit items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.22em] text-white/55 transition-colors hover:text-white">
            <ArrowLeft className="size-4" /> Return to society
          </Link>
          <div className="relative z-10 py-14 lg:py-0">
            <div className="flex items-center gap-3">
              {staff ? <ShieldCheck className="size-6" style={{ color: accent }} /> : <RadioTower className="size-6" style={{ color: accent }} />}
              <span className="font-mono text-xs font-bold uppercase tracking-[0.24em]" style={{ color: accent }}>
                {staff ? "Restricted Secretariat channel" : "Delegate access channel"}
              </span>
            </div>
            <h1 className="mt-9 font-heading text-[clamp(4.5rem,8vw,8rem)] leading-[0.78] tracking-[-0.06em]">
              <span className="block">{staff ? "Run the" : "Enter the"}</span>
              <span className="block">{staff ? "room." : "floor."}</span>
            </h1>
            <p className="mt-9 max-w-xl text-lg leading-relaxed text-white/55 sm:text-xl">
              {staff
                ? "Allotments, money, recruitment, live rooms, and public state. This door is for the people operating the society."
                : "Your registrations, allotments, writing, and live society experiences: one verified identity."}
            </p>
          </div>
          <div className="hidden items-center gap-8 border-t border-white/15 pt-6 font-mono text-xs uppercase tracking-[0.16em] text-white/55 lg:flex">
            <span>DTU · Delhi</span><span>Encrypted access</span><span>{staff ? "Staff only" : "Delegate portal"}</span>
          </div>
        </section>

        <section className="relative flex items-center justify-center border-t border-white/15 bg-white/[0.035] p-5 backdrop-blur-sm lg:border-l lg:border-t-0 sm:p-10">
          <motion.div
            initial={reduce ? false : { opacity: 0, x: 38 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="theme-light relative w-full max-w-xl bg-[#f3eee2] p-6 text-[#111614] shadow-[16px_16px_0_var(--auth-accent)] sm:p-10"
            style={{ "--auth-accent": accent } as React.CSSProperties}
          >
            <div className="absolute right-5 top-5 text-black/[0.07]">
              <Fingerprint className="size-20" strokeWidth={1} />
            </div>
            {children}
          </motion.div>
        </section>
      </div>

      <div className="absolute inset-x-0 bottom-0 hidden overflow-hidden border-t border-white/10 bg-black/30 py-2 font-mono text-xs uppercase tracking-[0.3em] text-white/25 lg:block">
        <motion.div
          className="whitespace-nowrap"
          animate={reduce ? undefined : { x: ["0%", "-35%"] }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        >
          DELTECH MODEL UNITED NATIONS · IDENTITY VERIFIED · DELTECH MODEL UNITED NATIONS · IDENTITY VERIFIED · DELTECH MODEL UNITED NATIONS
        </motion.div>
      </div>
    </main>
  )
}
