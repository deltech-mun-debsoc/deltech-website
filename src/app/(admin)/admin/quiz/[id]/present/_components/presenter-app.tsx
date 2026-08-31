"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getSupabase } from "@/lib/supabase"
import { LobbyScreen } from "./lobby-screen"
import { QuestionScreen } from "./question-screen"
import { LeaderboardScreen } from "./leaderboard-screen"
import {
  computeLeaderboard,
  endSession,
  lockSlide,
  revealSlide,
  startSlide,
  unlockSlide,
} from "../actions"
import type {
  SlideData,
  Tally,
  LBEntry,
  PresenceEntry,
  QuizBroadcast,
  PresentationData,
} from "@/lib/quiz-types"
import { isScoredType, redactSlide } from "@/lib/quiz-types"
import { correctAnswersForSlide, correctIndicesForSlide } from "@/lib/quiz-live"
import { APP_URL } from "@/lib/app-url"
import { t } from "@/content/strings"

type Screen = "lobby" | "question" | "leaderboard"

interface Props {
  session: { id: string; roomCode: string }
  presentation: PresentationData
  slides: SlideData[]
}

interface LiveRecovery {
  session: { status: string }
  live: {
    slide: SlideData
    slideIndex: number
    slideCount: number
    secondsLeft: number | null
    locked: boolean
    revealed: boolean
    correctIndices: number[]
    correctAnswers: string[]
  } | null
}

export function PresenterApp({ session, presentation, slides }: Props) {
  const [screen, setScreen] = useState<Screen>("lobby")
  const [slideIndex, setSlideIndex] = useState(0)
  const [tally, setTally] = useState<Tally | null>(null)
  const [participants, setParticipants] = useState<PresenceEntry[]>([])
  const [locked, setLocked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [revealedIndices, setRevealedIndices] = useState<number[]>([])
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerRemaining, setTimerRemaining] = useState<number | null>(null)
  const [lbEntries, setLbEntries] = useState<LBEntry[]>([])
  const [lbFinal, setLbFinal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hostError, setHostError] = useState("")

  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null>(null)
  const tallyIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const prevRanksRef = useRef<Map<string, number>>(new Map())
  const actionRef = useRef(false)
  const recoveryDoneRef = useRef(false)

  const currentSlide = slides[slideIndex]

  function broadcast(payload: QuizBroadcast) {
    channelRef.current?.send({ type: "broadcast", event: "quiz", payload })
  }

  const fetchTally = useCallback(async (slideId: string) => {
    const res = await fetch(`/api/quiz/tally/${session.id}/${slideId}`)
    if (res.ok) setTally(await res.json())
  }, [session.id])

  const startTallyPoll = useCallback((slideId: string) => {
    clearInterval(tallyIntervalRef.current)
    void fetchTally(slideId)
    tallyIntervalRef.current = setInterval(() => void fetchTally(slideId), 1500)
  }, [fetchTally])

  const stopTallyPoll = useCallback(() => {
    clearInterval(tallyIntervalRef.current)
    tallyIntervalRef.current = undefined
  }, [])

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) return

    const channel = supabase.channel(`quiz:${session.roomCode}`, {
      config: { presence: { key: "host" } },
    })
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState()
        const all: PresenceEntry[] = []
        for (const key of Object.keys(state)) {
          for (const p of state[key] as unknown as PresenceEntry[]) {
            if ((p as { role?: string }).role !== "host") all.push(p)
          }
        }
        setParticipants(all)
      })
      .subscribe()

    channelRef.current = channel
    return () => {
      supabase.removeChannel(channel)
      stopTallyPoll()
    }
  }, [session.roomCode, stopTallyPoll])

  // Realtime has no history. Recover the exact live question, lock/reveal state
  // and remaining server time after a presenter refresh instead of falling back
  // to a lobby whose Start button silently restarts question one.
  useEffect(() => {
    if (recoveryDoneRef.current) return
    recoveryDoneRef.current = true
    void (async () => {
      try {
        const res = await fetch(`/api/quiz/sessions?sessionId=${session.id}`)
        if (!res.ok) return
        const data = (await res.json()) as LiveRecovery
        if (data.session.status === "ended" || !data.live) return

        const index = slides.findIndex((slide) => slide.id === data.live?.slide.id)
        if (index < 0) return

        let recoveredLocked = data.live.locked
        if (!recoveredLocked && data.live.secondsLeft !== null && data.live.secondsLeft <= 0) {
          await lockSlide(session.id, data.live.slide.id)
          recoveredLocked = true
        }

        setSlideIndex(index)
        setLocked(recoveredLocked)
        setRevealed(data.live.revealed)
        setRevealedIndices(data.live.revealed ? correctIndicesForSlide(slides[index]) : [])
        setTimerRemaining(data.live.secondsLeft)
        setTimerRunning(!recoveredLocked && !data.live.revealed)
        setScreen("question")
        if (recoveredLocked) void fetchTally(data.live.slide.id)
        else startTallyPoll(data.live.slide.id)
      } catch {
        setHostError(t("quiz.hostActionFailed"))
      }
    })()
  }, [fetchTally, session.id, slides, startTallyPoll])

  function beginAction(): boolean {
    if (actionRef.current) return false
    actionRef.current = true
    setBusy(true)
    setHostError("")
    return true
  }

  function finishAction() {
    actionRef.current = false
    setBusy(false)
  }

  async function gotoSlide(index: number) {
    const slide = slides[index]
    if (!slide) return

    stopTallyPoll()
    const timing = await startSlide(session.id, slide.id)
    setSlideIndex(index)
    setTally(null)
    setLocked(false)
    setRevealed(false)
    setRevealedIndices([])
    setTimerRemaining(timing.secondsLeft)
    setTimerRunning(true)
    setScreen("question")

    broadcast({
      event: "GOTO",
      slideId: slide.id,
      slideIndex: index,
      slideCount: slides.length,
      slide: redactSlide(slide),
    })
    startTallyPoll(slide.id)
  }

  async function runHostAction(action: () => Promise<void>) {
    if (!beginAction()) return
    try {
      await action()
    } catch {
      setHostError(t("quiz.hostActionFailed"))
    } finally {
      finishAction()
    }
  }

  function handleStart() {
    void runHostAction(async () => {
      await gotoSlide(0)
      broadcast({ event: "START" })
    })
  }

  function handleLock() {
    if (!currentSlide) return
    void runHostAction(async () => {
      await lockSlide(session.id, currentSlide.id)
      setLocked(true)
      setTimerRunning(false)
      stopTallyPoll()
      await fetchTally(currentSlide.id)
      broadcast({ event: "LOCK" })
    })
  }

  function handleUnlock() {
    if (!currentSlide) return
    void runHostAction(async () => {
      const timing = await unlockSlide(session.id, currentSlide.id)
      setLocked(false)
      setTimerRemaining(timing.secondsLeft)
      setTimerRunning(true)
      startTallyPoll(currentSlide.id)
      broadcast({ event: "UNLOCK", secondsLeft: timing.secondsLeft })
    })
  }

  function handleReveal() {
    if (!currentSlide || !isScoredType(currentSlide.type)) return
    void runHostAction(async () => {
      await revealSlide(session.id, currentSlide.id)
      const indices = correctIndicesForSlide(currentSlide)
      const correctAnswers = correctAnswersForSlide(currentSlide)
      setRevealed(true)
      setRevealedIndices(indices)
      broadcast({ event: "REVEAL", correctIndices: indices, correctAnswers })
    })
  }

  function handleTimerExpire() {
    if (!locked && !revealed) handleLock()
  }

  async function showLeaderboard(final = false) {
    stopTallyPoll()
    setLbFinal(final)
    const scores = await computeLeaderboard(session.id)
    const presenceAvatars = new Map(participants.map((p) => [p.nickname, p.avatar]))
    const entries: LBEntry[] = scores.map((score) => {
      const previous = prevRanksRef.current.get(score.nickname)
      return {
        ...score,
        avatar: score.avatar || presenceAvatars.get(score.nickname) || "",
        delta: previous === undefined ? undefined : previous - score.rank,
      }
    })
    prevRanksRef.current = new Map(entries.map((entry) => [entry.nickname, entry.rank]))
    setLbEntries(entries)
    setScreen("leaderboard")
    broadcast({ event: "LEADERBOARD", entries, final })
  }

  function handleShowLeaderboard(final = false) {
    void runHostAction(() => showLeaderboard(final))
  }

  function handleNext() {
    void runHostAction(async () => {
      const scored = currentSlide && isScoredType(currentSlide.type) && presentation.mode === "QUIZ"
      if (scored && screen !== "leaderboard") {
        await showLeaderboard(slideIndex >= slides.length - 1)
      } else if (slideIndex < slides.length - 1) {
        await gotoSlide(slideIndex + 1)
      } else {
        await showLeaderboard(true)
      }
    })
  }

  function handlePrev() {
    if (slideIndex <= 0) return
    void runHostAction(() => gotoSlide(slideIndex - 1))
  }

  function handleEnd() {
    void runHostAction(async () => {
      // Persist first. If realtime drops, every phone's five-second recovery
      // check still sees ended and closes; no client can keep submitting.
      await endSession(session.id)
      broadcast({ event: "END" })
      window.location.href = `/admin/quiz/${presentation.id}`
    })
  }

  const theme = presentation.theme ?? {
    background: "#ffffff",
    textColor: "#111827",
    accentColor: "#0f766e",
    font: "Inter",
  }
  const joinUrl = `${APP_URL}/quiz/${session.roomCode}`
  const screenKey = screen === "lobby"
    ? "lobby"
    : screen === "leaderboard"
      ? "leaderboard"
      : `slide-${currentSlide?.id ?? slideIndex}`

  return (
    <div key={screenKey} className="relative h-full animate-in fade-in slide-in-from-right-8 duration-300 motion-reduce:animate-none">
      {hostError && (
        <div className="absolute inset-x-0 top-0 z-[60] bg-destructive px-4 py-2 text-center text-sm font-bold text-destructive-foreground" role="alert">
          {hostError}
        </div>
      )}
      {screen === "lobby" ? (
        <LobbyScreen
          roomCode={session.roomCode}
          joinUrl={joinUrl}
          participants={participants}
          theme={theme}
          onStart={handleStart}
        />
      ) : screen === "leaderboard" ? (
        <LeaderboardScreen
          entries={lbEntries}
          final={lbFinal}
          theme={theme}
          onNext={!lbFinal && slideIndex < slides.length - 1 ? handleNext : undefined}
          onEnd={handleEnd}
        />
      ) : currentSlide ? (
        <QuestionScreen
          slide={currentSlide}
          slideIndex={slideIndex}
          slideCount={slides.length}
          tally={tally}
          theme={theme}
          mode={presentation.mode}
          locked={locked}
          revealed={revealed}
          revealedIndices={revealedIndices}
          timerRunning={timerRunning}
          timerRemainingSeconds={timerRemaining}
          busy={busy}
          participantCount={participants.length}
          onLock={handleLock}
          onUnlock={handleUnlock}
          onReveal={handleReveal}
          onNext={handleNext}
          onPrev={handlePrev}
          onLeaderboard={() => handleShowLeaderboard(false)}
          onTimerExpire={handleTimerExpire}
        />
      ) : null}
    </div>
  )
}
