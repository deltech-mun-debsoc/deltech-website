"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { getSupabase } from "@/lib/supabase"
import { LobbyScreen } from "./lobby-screen"
import { QuestionScreen } from "./question-screen"
import { LeaderboardScreen } from "./leaderboard-screen"
import { endSession, computeLeaderboard, startSlide } from "../actions"
import type {
  SlideData,
  Tally,
  LBEntry,
  PresenceEntry,
  QuizBroadcast,
  PresentationData,
  MCQConfig,
} from "@/lib/quiz-types"
import { asMCQ } from "@/lib/quiz-types"
import { APP_URL } from "@/lib/app-url"

type Screen = "lobby" | "question" | "leaderboard"

interface Props {
  session: { id: string; roomCode: string }
  presentation: PresentationData
  slides: SlideData[]
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
  const [lbEntries, setLbEntries] = useState<LBEntry[]>([])
  const [lbFinal, setLbFinal] = useState(false)

  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null>(null)
  const tallyIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const prevRanksRef = useRef<Map<string, number>>(new Map())

  const currentSlide = slides[slideIndex]

  // ── Broadcast helper ──────────────────────────────────────────────────────
  function broadcast(payload: QuizBroadcast) {
    channelRef.current?.send({ type: "broadcast", event: "quiz", payload })
  }

  // ── Tally polling ─────────────────────────────────────────────────────────
  const startTallyPoll = useCallback((slideId: string) => {
    clearInterval(tallyIntervalRef.current)
    tallyIntervalRef.current = setInterval(async () => {
      const res = await fetch(`/api/quiz/tally/${session.id}/${slideId}`)
      if (res.ok) setTally(await res.json())
    }, 1500)
  }, [session.id])

  const stopTallyPoll = useCallback(() => {
    clearInterval(tallyIntervalRef.current)
    tallyIntervalRef.current = undefined
  }, [])

  // ── Supabase presence ──────────────────────────────────────────────────────
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

  // ── Handlers ───────────────────────────────────────────────────────────────
  async function handleStart() {
    broadcast({ event: "START" })
    gotoSlide(0)
  }

  function gotoSlide(idx: number) {
    const slide = slides[idx]
    if (!slide) return

    stopTallyPoll()
    setSlideIndex(idx)
    setTally(null)
    setLocked(false)
    setRevealed(false)
    setRevealedIndices([])
    setTimerRunning(true)
    setScreen("question")

    // Strip correct indices from MCQ before broadcasting
    let broadcastSlide: SlideData = slide
    if (slide.type === "MCQ") {
      broadcastSlide = {
        ...slide,
        config: { ...asMCQ(slide.config), correct: [] } as MCQConfig,
      }
    }

    // Authoritative record of which slide is live and from when. The
    // broadcast below is for latency; this is what scoring trusts.
    void startSlide(session.id, slide.id).catch(() => {})

    broadcast({
      event: "GOTO",
      slideId: slide.id,
      slideIndex: idx,
      slideCount: slides.length,
      slide: broadcastSlide,
    })
    startTallyPoll(slide.id)
  }

  function handleLock() {
    setLocked(true)
    setTimerRunning(false)
    stopTallyPoll()
    // Final tally fetch
    if (currentSlide) {
      fetch(`/api/quiz/tally/${session.id}/${currentSlide.id}`)
        .then((r) => r.json())
        .then(setTally)
    }
    broadcast({ event: "LOCK" })
  }

  function handleUnlock() {
    setLocked(false)
    if (currentSlide) startTallyPoll(currentSlide.id)
    broadcast({ event: "UNLOCK" })
  }

  function handleReveal() {
    if (!currentSlide || currentSlide.type !== "MCQ") return
    const indices = asMCQ(currentSlide.config).correct
    setRevealed(true)
    setRevealedIndices(indices)
    broadcast({ event: "REVEAL", correctIndices: indices })
  }

  function handleTimerExpire() {
    handleLock()
  }

  function handleNext() {
    if (slideIndex < slides.length - 1) {
      gotoSlide(slideIndex + 1)
    } else {
      handleShowLeaderboard(true)
    }
  }

  function handlePrev() {
    if (slideIndex > 0) gotoSlide(slideIndex - 1)
  }

  async function handleShowLeaderboard(final = false) {
    stopTallyPoll()
    setLbFinal(final)

    // Compute scores
    const scores = await computeLeaderboard(session.id)

    // Merge avatars from presence
    const avatarMap = new Map(participants.map((p) => [p.nickname, p.avatar]))
    const entries: LBEntry[] = scores.map((s) => {
      const prev = prevRanksRef.current.get(s.nickname)
      const delta = prev !== undefined ? prev - s.rank : undefined
      return { ...s, avatar: avatarMap.get(s.nickname) ?? "", delta }
    })

    // Save current ranks for delta next time
    prevRanksRef.current = new Map(entries.map((e) => [e.nickname, e.rank]))

    setLbEntries(entries)
    setScreen("leaderboard")
    broadcast({ event: "LEADERBOARD", entries, final })
  }

  async function handleEnd() {
    broadcast({ event: "END" })
    await endSession(session.id)
    // Redirect back to builder
    window.location.href = `/admin/quiz/${presentation.id}`
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const theme = presentation.theme ?? {
    background: "#ffffff",
    textColor: "#111827",
    accentColor: "#0f766e",
    font: "Inter",
  }
  const joinUrl = `${APP_URL}/quiz/${session.roomCode}`

  // Which screen is live, keyed so AnimatePresence can cross-fade slides too.
  const screenKey =
    screen === "lobby" ? "lobby" : screen === "leaderboard" ? "leaderboard" : `slide-${currentSlide?.id ?? slideIndex}`

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={screenKey}
        className="h-full"
        initial={{ opacity: 0, x: 32 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -32 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
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
            onNext={!lbFinal && slideIndex < slides.length - 1 ? () => gotoSlide(slideIndex + 1) : undefined}
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
            onLock={handleLock}
            onUnlock={handleUnlock}
            onReveal={handleReveal}
            onNext={handleNext}
            onPrev={handlePrev}
            onLeaderboard={() => handleShowLeaderboard(false)}
            onTimerExpire={handleTimerExpire}
          />
        ) : null}
      </motion.div>
    </AnimatePresence>
  )
}
