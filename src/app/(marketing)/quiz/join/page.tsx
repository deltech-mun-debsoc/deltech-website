"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { t } from "@/content/strings"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function QuizJoinPage() {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

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
    <div className="relative flex min-h-[calc(100svh-4rem)] justify-center overflow-hidden bg-ink px-4 pb-16 pt-10 text-paper sm:items-center sm:pt-0">
      <div className="paper-grid absolute inset-0 opacity-[0.08]" aria-hidden />
      <form onSubmit={handleSubmit} noValidate className="theme-light relative w-full max-w-md border border-white/15 bg-[#f3eee2] p-6 text-[#111614] shadow-[8px_8px_0_#c8a25a] [&_input]:bg-white sm:p-10 sm:shadow-[14px_14px_0_#c8a25a]">
        <p className="text-sm font-medium text-teal-800">DelTech MUN quiz</p>
        <h1 className="mt-3 font-display text-4xl font-normal leading-tight">{t("quiz.joinTitle")}</h1>
        <p className="mt-3 text-sm text-black/65">Enter the six-digit code on the host’s screen.</p>
        <label htmlFor="room-code" className="mt-8 block text-sm font-semibold">{t("quiz.joinCodeLabel")}</label>
        <Input
          id="room-code"
          value={code}
          onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError("") }}
          className="mt-2 h-16 text-center font-mono text-3xl font-semibold tracking-[0.2em] tabular-nums"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "room-code-error" : undefined}
          autoFocus
        />
        {error && <p id="room-code-error" role="alert" className="mt-2 text-sm font-medium text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="mt-5 h-11 w-full text-base" disabled={isPending || code.length !== 6}>
          {isPending ? t("quiz.joinFinding") : t("quiz.joinButton")}
        </Button>
      </form>
    </div>
  )
}
