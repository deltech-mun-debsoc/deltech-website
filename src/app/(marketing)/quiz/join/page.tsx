"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { t } from "@/content/strings"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowRight, Sparkles, Users } from "lucide-react"

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
        transition={{ duration: 48, repeat: Infinity, ease: "linear" }}
      >
        <div className="absolute inset-20 rounded-full border border-dashed border-teal-600/20 dark:border-teal-300/25" />
        <div className="absolute inset-44 rounded-full bg-teal-500/12 blur-3xl dark:bg-teal-400/10" />
      </motion.div>

      <div className="section-shell relative grid min-h-[calc(100svh-5rem)] gap-10 py-12 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-14 lg:py-14">
        <section>
          <p className="eyebrow text-teal-700 dark:text-teal-300">{t("marketing.quizLive")}</p>
          <h1 className="mt-6 max-w-[8ch] font-display text-[clamp(3.5rem,9vw,8rem)] font-[560] leading-[0.92] tracking-[-0.03em] [font-variation-settings:'opsz'_96] lg:mt-10">
            {t("marketing.quizTitle")}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground/70 sm:text-xl lg:mt-9 dark:text-white/65">
            {t("marketing.quizBody")}
          </p>
          <div className="mt-8 hidden flex-wrap gap-8 border-t border-foreground/15 pt-6 text-sm text-foreground/65 sm:flex lg:mt-12 dark:border-white/15 dark:text-white/60">
            <span className="flex items-center gap-2"><Users className="size-4 text-teal-600 dark:text-teal-300" aria-hidden /> {t("quiz.joinNoAccount")}</span>
            <span className="flex items-center gap-2"><Sparkles className="size-4 text-amber-600 dark:text-amber-300" aria-hidden /> {t("quiz.joinLiveResults")}</span>
          </div>
        </section>

        <form onSubmit={handleSubmit} noValidate className="theme-light relative border border-black/10 bg-[#f3eee2] p-6 text-[#111614] shadow-[12px_12px_0_#14b8a6] sm:p-9 sm:shadow-[18px_18px_0_#14b8a6]">
          <h2 className="font-heading text-4xl leading-tight">{t("quiz.joinCardTitle")}</h2>
          <label htmlFor="room-code" className="mt-8 block text-sm font-semibold">{t("quiz.joinCodeLabel")}</label>
          <Input
            id="room-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="mt-3 h-24 rounded-none border-0 border-b-2 border-black/70 bg-transparent px-0 text-center font-mono text-5xl font-semibold tracking-[0.15em] tabular-nums shadow-none placeholder:text-black/15 focus-visible:border-teal-700 focus-visible:ring-0 sm:text-6xl"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-invalid={error ? true : undefined}
            aria-describedby="room-code-hint"
            autoFocus
          />
          <p id="room-code-hint" role={error ? "alert" : undefined} className={error ? "mt-3 min-h-6 text-sm font-semibold text-red-700" : "mt-3 min-h-6 text-sm text-black/60"}>
            {error || t("quiz.joinCodeHint")}
          </p>
          <Button type="submit" size="lg" className="mt-5 h-14 w-full rounded-none bg-black text-base text-white hover:bg-teal-700" disabled={isPending || code.length !== 6}>
            {isPending ? t("quiz.joinFinding") : t("quiz.joinButton")} <ArrowRight />
          </Button>
        </form>
      </div>
    </main>
  )
}
