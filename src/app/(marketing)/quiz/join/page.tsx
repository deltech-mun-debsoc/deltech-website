"use client"

import { useState, useTransition } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { useRouter } from "next/navigation"
import { t } from "@/content/strings"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { ArrowRight, RadioTower, Sparkles, Users } from "lucide-react"

export default function QuizJoinPage() {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const reduce = useReducedMotion()

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = code.trim().replace(/\s/g, "")
    if (!/^\d{6}$/.test(trimmed)) {
      setError(t("quiz.invalidCode"))
      return
    }
    setError("")
    startTransition(async () => {
      const response = await fetch("/api/quiz/sessions?code=" + trimmed)
      if (!response.ok) {
        setError(t("quiz.invalidCode"))
        return
      }
      const data = (await response.json()) as { session: { status: string } }
      if (data.session.status === "ended") {
        setError(t("quiz.sessionEnded"))
        return
      }
      router.push("/quiz/" + trimmed)
    })
  }

  return (
    <main className="overscroll-adaptive relative min-h-[calc(100svh-5rem)] overflow-hidden bg-background text-foreground dark:bg-[#070b0a] dark:text-white">
      <div className="paper-grid absolute inset-0 opacity-[0.09]" aria-hidden />
      <motion.div
        aria-hidden
        className="absolute -right-32 -top-44 size-[38rem] rounded-full border border-teal-600/25 dark:border-teal-300/30"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 34, repeat: Infinity, ease: "linear" }}
      >
        <div className="absolute inset-20 rounded-full border border-dashed border-teal-600/20 dark:border-teal-300/25" />
        <div className="absolute inset-44 rounded-full bg-teal-500/12 blur-3xl dark:bg-teal-400/10" />
      </motion.div>
      <motion.div
        aria-hidden
        className="absolute bottom-16 left-[8%] size-3 bg-amber-500 shadow-[0_0_32px_10px_rgba(217,119,6,0.22)] dark:bg-amber-300 dark:shadow-[0_0_45px_16px_rgba(252,211,77,0.35)]"
        animate={reduce ? undefined : { x: [0, 220, 80, 0], y: [0, -90, 120, 0] }}
        transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="section-shell relative grid min-h-[calc(100svh-5rem)] gap-14 py-14 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <section>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 bg-teal-400 px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.18em] text-black">
              <RadioTower className="size-4" /> Live signal
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-foreground/50 dark:text-white/45">DTU · audience system</span>
          </div>
          <h1 className="mt-10 max-w-[8ch] font-heading text-[clamp(4rem,10vw,8.5rem)] leading-[0.78] tracking-[-0.06em]">
            Enter the room.
          </h1>
          <p className="mt-9 max-w-xl text-xl leading-relaxed text-foreground/70 dark:text-white/62">
            Polls, pressure rounds, rapid-fire diplomacy. Your phone is the buzzer and the room moves live.
          </p>
          <div className="mt-12 flex flex-wrap gap-8 border-t border-foreground/15 pt-6 text-sm text-foreground/62 dark:border-white/15 dark:text-white/52">
            <span className="flex items-center gap-2"><Users className="size-4 text-teal-600 dark:text-teal-300" /> No account needed</span>
            <span className="flex items-center gap-2"><Sparkles className="size-4 text-amber-600 dark:text-amber-300" /> Live results</span>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="theme-light relative border border-black/10 bg-[#f3eee2] p-6 text-[#111614] shadow-[18px_18px_0_#14b8a6] sm:p-9">
          <span className="absolute right-5 top-4 font-mono text-7xl font-black leading-none text-black/[0.06]" aria-hidden>06</span>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Room access</p>
          <h2 className="mt-5 font-heading text-4xl">Six digits. That&apos;s it.</h2>
          <label htmlFor="room-code" className="mt-9 block text-sm font-bold">Code on the main screen</label>
          <Input
            id="room-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="mt-3 h-28 rounded-none border-0 border-b border-black bg-transparent px-0 text-center font-mono text-5xl font-black tabular-nums tracking-[0.22em] shadow-none placeholder:text-black/12 focus-visible:ring-0 sm:text-6xl"
            maxLength={6}
            inputMode="numeric"
            autoFocus
          />
          <div className="min-h-9 pt-3">
            {error ? <p className="text-sm font-bold text-red-700">{error}</p> : <p className="text-sm text-black/50">Ask the host if you cannot see the code.</p>}
          </div>
          <Button type="submit" size="lg" className="mt-4 h-14 w-full rounded-none bg-black text-base text-white hover:bg-teal-700" disabled={isPending || code.length !== 6}>
            {isPending ? "Finding the room…" : "Join live"} <ArrowRight />
          </Button>
        </form>
      </div>

      <div className="absolute inset-x-0 bottom-0 overflow-hidden border-t border-foreground/15 bg-foreground/[0.04] py-2 font-mono text-xs uppercase tracking-[0.28em] text-foreground/45 dark:border-white/15 dark:bg-white/[0.04] dark:text-white/35">
        <div className="whitespace-nowrap">LIVE RESPONSE SYSTEM · ROOM CODE REQUIRED · LIVE RESPONSE SYSTEM · ROOM CODE REQUIRED · LIVE RESPONSE SYSTEM</div>
      </div>
    </main>
  )
}
