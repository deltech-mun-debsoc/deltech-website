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
    <div className="flex min-h-[calc(100svh-4rem)] justify-center px-4 pb-16 pt-12 sm:items-center sm:pt-0">
      <form onSubmit={handleSubmit} noValidate className="w-full max-w-sm sm:-mt-16">
        <h1 className="text-2xl font-semibold">{t("quiz.joinTitle")}</h1>
        <label htmlFor="room-code" className="mt-6 block text-sm font-medium">{t("quiz.joinCodeLabel")}</label>
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
