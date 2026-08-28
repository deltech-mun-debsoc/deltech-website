"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getSupabase } from "@/lib/supabase"
import { t } from "@/content/strings"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AVATARS, type SlideData, type QuizBroadcast, type LBEntry } from "@/lib/quiz-types"
import { asMCQ, asScale, asWordCloud, asOpenText } from "@/lib/quiz-types"

type AppState =
  | "nickname"
  | "avatar"
  | "lobby"
  | "question"
  | "submitted"
  | "result"
  | "leaderboard"
  | "ended"

interface ResultData { correct: boolean | null; points: number; rank: number | null }

interface Props {
  sessionId: string
  roomCode: string
  initialStatus: string
  presentationMode: "POLL" | "QUIZ"
  presentationTitle: string
}

function randomUserId() {
  return Math.random().toString(36).slice(2)
}

export function ParticipantApp({ sessionId, roomCode, initialStatus, presentationMode, presentationTitle }: Props) {
  const [appState, setAppState] = useState<AppState>(
    initialStatus === "ended" ? "ended" : "nickname"
  )
  const [nickname, setNickname] = useState("")
  const [nicknameInput, setNicknameInput] = useState("")
  const [nicknameError, setNicknameError] = useState("")
  const [avatar, setAvatar] = useState<string>("")
  const [currentSlide, setCurrentSlide] = useState<SlideData | null>(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const [slideCount, setSlideCount] = useState(0)
  const [locked, setLocked] = useState(false)
  const [lbEntries, setLbEntries] = useState<LBEntry[]>([])
  const [lbFinal, setLbFinal] = useState(false)
  const [result, setResult] = useState<ResultData | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [slideStartMs, setSlideStartMs] = useState(0)

  // MCQ state
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  // Word cloud state
  const [words, setWords] = useState<string[]>([""])
  // Scale state
  const [scaleValues, setScaleValues] = useState<number[]>([])
  // Open text state
  const [openText, setOpenText] = useState("")

  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null>(null)
  const userIdRef = useRef(randomUserId())
  const submittedRef = useRef(false)

  const joinChannel = useCallback((nick: string, ava: string) => {
    const supabase = getSupabase()
    if (!supabase) return

    const channel = supabase.channel(`quiz:${roomCode}`)

    channel
      .on("broadcast", { event: "quiz" }, ({ payload }: { payload: QuizBroadcast }) => {
        if (payload.event === "START") {
          // Host has started, remain in lobby until GOTO
        } else if (payload.event === "GOTO") {
          submittedRef.current = false
          setCurrentSlide(payload.slide)
          setSlideIndex(payload.slideIndex)
          setSlideCount(payload.slideCount)
          setLocked(false)
          setResult(null)
          setSelectedIndices([])
          setWords([""])
          setOpenText("")
          setSlideStartMs(Date.now())

          // Initialise scale values
          if (payload.slide.type === "SCALE") {
            const sc = asScale(payload.slide.config)
            setScaleValues(sc.statements.map(() => Math.round((sc.min + sc.max) / 2)))
          }

          setAppState("question")
        } else if (payload.event === "LOCK") {
          setLocked(true)
          if (!submittedRef.current) setAppState("submitted") // didn't answer in time
        } else if (payload.event === "UNLOCK") {
          setLocked(false)
          if (!submittedRef.current) setAppState("question")
        } else if (payload.event === "REVEAL") {
          // If they submitted, we already have result, nothing extra needed
        } else if (payload.event === "LEADERBOARD") {
          setLbEntries(payload.entries)
          setLbFinal(payload.final)
          setAppState("leaderboard")
        } else if (payload.event === "END") {
          setAppState("ended")
        }
      })
      // Two people typing the same name used to merge into one leaderboard
      // row, and the second one's genuine answer came back 409 "already
      // submitted" while the UI told them it was received. Presence already
      // knows who is in the room, so catch it at the door instead.
      .on("presence", { event: "sync" }, () => {
        const taken = Object.values(channel.presenceState())
          .flat()
          .some(
            (p) =>
              (p as { nickname?: string; userId?: string }).nickname === nick &&
              (p as { userId?: string }).userId !== userIdRef.current,
          )
        if (taken) {
          supabase.removeChannel(channel)
          channelRef.current = null
          setNicknameError(t("quiz.nicknameTaken"))
          setAppState("nickname")
        }
      })
      .subscribe(() => {
        channel.track({ nickname: nick, avatar: ava, userId: userIdRef.current })
      })

    channelRef.current = channel
  }, [roomCode])

  useEffect(() => {
    return () => {
      const supabase = getSupabase()
      if (supabase && channelRef.current) supabase.removeChannel(channelRef.current)
    }
  }, [])

  // ── Nickname submit ────────────────────────────────────────────────────────
  function handleNicknameSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = nicknameInput.trim()
    if (!trimmed) { setNicknameError(t("quiz.nicknameRequired")); return }
    setNicknameError("")
    setNickname(trimmed)
    if (presentationMode === "QUIZ") {
      setAppState("avatar")
    } else {
      const ava = AVATARS[0]
      setAvatar(ava)
      joinChannel(trimmed, ava)
      setAppState("lobby")
    }
  }

  function handleAvatarSelect(ava: string) {
    setAvatar(ava)
    joinChannel(nickname, ava)
    setAppState("lobby")
  }

  // ── Answer submit ──────────────────────────────────────────────────────────
  async function submitAnswer(answer: unknown) {
    if (submittedRef.current || !currentSlide) return
    submittedRef.current = true
    setSubmitting(true)

    const res = await fetch("/api/quiz/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        slideId: currentSlide.id,
        nickname,
        avatar,
        answer,
      }),
    })

    setSubmitting(false)
    if (res.ok) {
      const data = (await res.json()) as ResultData
      setResult(data)
      setAppState("result")
    } else if (res.status === 409) {
      // Someone else already answered under this nickname. Saying "answer
      // received" here is what let a collided participant score zero for a
      // whole quiz without ever seeing an error.
      submittedRef.current = false
      setNicknameError(t("quiz.nicknameTaken"))
      setAppState("nickname")
    } else {
      setAppState("submitted")
    }
  }

  // ── MCQ submit ─────────────────────────────────────────────────────────────
  function handleMCQToggle(idx: number) {
    if (locked || submittedRef.current) return
    const config = asMCQ(currentSlide!.config)
    if (config.allowMultiple) {
      setSelectedIndices((prev) =>
        prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
      )
    } else {
      setSelectedIndices([idx])
      // auto-submit on single select
      void submitAnswer({ selectedIndices: [idx] })
    }
  }

  function handleMCQSubmit() {
    if (selectedIndices.length === 0) return
    void submitAnswer({ selectedIndices })
  }

  // ── My rank from leaderboard entries ──────────────────────────────────────
  const myEntry = lbEntries.find((e) => e.nickname === nickname)

  // ─────────────────────────────────────────────────────────────────────────
  // SCREENS
  // ─────────────────────────────────────────────────────────────────────────

  if (appState === "ended") {
    return (
      <Screen k={appState}>
        <div className="flex flex-col items-center gap-5 py-6 text-center">
          <span className="text-7xl">🎉</span>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Transmission complete</p>
          <h1 className="font-heading text-5xl">{t("quiz.sessionEnded")}</h1>
          {myEntry && (
            <p className="text-lg text-muted-foreground">
              {t("quiz.yourRankLabel", { rank: myEntry.rank })}
            </p>
          )}
        </div>
      </Screen>
    )
  }

  if (appState === "nickname") {
    return (
      <Screen k={appState}>
        <form onSubmit={handleNicknameSubmit} className="flex w-full max-w-lg flex-col gap-5 py-4">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Identify yourself</p>
          <h1 className="font-heading text-4xl leading-tight sm:text-5xl">{presentationTitle || t("quiz.joinTitle")}</h1>
          <p className="text-lg text-muted-foreground">{t("quiz.enterNickname")}</p>
          <Input
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            placeholder={t("quiz.nicknamePlaceholder")}
            maxLength={24}
            autoFocus
            className="h-14 rounded-none border-0 border-b border-foreground bg-transparent px-0 text-xl shadow-none focus-visible:ring-0"
          />
          {nicknameError && <p className="text-sm text-destructive">{nicknameError}</p>}
          <Button type="submit" size="lg" className="h-14 rounded-none text-base">{t("common.next")} →</Button>
        </form>
      </Screen>
    )
  }

  if (appState === "avatar") {
    return (
      <Screen k={appState}>
        <div className="flex w-full max-w-lg flex-col gap-6 py-4">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Choose your signal</p>
          <h1 className="font-heading text-5xl">{t("quiz.pickAvatar")}</h1>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {AVATARS.map((ava) => (
              <button
                key={ava}
                onClick={() => handleAvatarSelect(ava)}
                className={`flex aspect-square items-center justify-center border border-black/15 bg-white/40 p-2 text-4xl transition-all hover:-translate-y-1 hover:bg-white ${avatar === ava ? "border-teal-700 bg-teal-50 shadow-[5px_5px_0_#0f766e]" : ""}`}
              >
                {ava}
              </button>
            ))}
          </div>
        </div>
      </Screen>
    )
  }

  if (appState === "lobby") {
    return (
      <Screen k={appState}>
        <div className="flex flex-col items-center gap-5 py-8 text-center">
          <span className="text-7xl">{avatar || "👤"}</span>
          <p className="font-heading text-4xl">{nickname}</p>
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-teal-700">{t("quiz.waitingToStart")}</p>
          <div className="mt-4 flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-3 animate-pulse bg-teal-600"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      </Screen>
    )
  }

  if ((appState === "submitted") && !currentSlide) {
    return (
      <Screen k={appState}>
        <p className="text-muted-foreground text-center">{t("quiz.votingLocked")}</p>
      </Screen>
    )
  }

  if (appState === "leaderboard") {
    return (
      <Screen k={appState}>
        <div className="w-full max-w-lg space-y-5">
          <p className="text-center font-mono text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Live standings</p>
          <h2 className="text-center font-heading text-5xl">
            {lbFinal ? t("quiz.finalResults") : t("quiz.leaderboard")}
          </h2>
          <div className="space-y-2">
            {lbEntries.slice(0, 10).map((entry) => (
              <div
                key={entry.nickname}
                className={`flex items-center gap-3 border px-4 py-4 ${entry.nickname === nickname ? "border-teal-700 bg-teal-50" : "border-black/10 bg-black/5"}`}
              >
                <span className="w-6 text-center text-sm font-bold text-teal-600">
                  {t("quiz.rankN", { n: entry.rank })}
                </span>
                <span className="text-xl">{entry.avatar || "👤"}</span>
                <span className="flex-1 text-sm font-medium">{entry.nickname}</span>
                <span className="tabular-nums text-sm font-bold">{entry.totalPoints.toLocaleString()}</span>
              </div>
            ))}
          </div>
          {myEntry && !lbEntries.slice(0, 10).find((e) => e.nickname === nickname) && (
            <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-teal-50 ring-1 ring-teal-200">
              <span className="w-6 text-center text-sm font-bold text-teal-600">
                {t("quiz.rankN", { n: myEntry.rank })}
              </span>
              <span className="text-xl">{myEntry.avatar || "👤"}</span>
              <span className="flex-1 text-sm font-medium">{myEntry.nickname}</span>
              <span className="tabular-nums text-sm font-bold">{myEntry.totalPoints.toLocaleString()}</span>
            </div>
          )}
        </div>
      </Screen>
    )
  }

  if (!currentSlide) return <Screen k="loading"><p className="text-muted-foreground">{t("common.loading")}</p></Screen>

  // ── Question screen ──────────────────────────────────────────────────────
  if (appState === "result" && result) {
    return (
      <Screen k={appState}>
        <div className="flex flex-col items-center gap-5 py-8 text-center">
          {result.correct === true && (
            <>
              <span className="text-7xl">✅</span>
              <p className="font-heading text-5xl text-green-700">{t("quiz.correct")}</p>
              <p className="text-teal-600 text-xl font-semibold">{t("quiz.pointsEarned", { points: result.points })}</p>
            </>
          )}
          {result.correct === false && (
            <>
              <span className="text-7xl">❌</span>
              <p className="font-heading text-5xl text-destructive">{t("quiz.incorrect")}</p>
            </>
          )}
          {result.correct === null && (
            <>
              <span className="text-5xl">✓</span>
              <p className="text-xl font-semibold">{t("quiz.answerReceived")}</p>
            </>
          )}
          {result.rank !== null && (
            <p className="text-muted-foreground">
              {t("quiz.yourRankLabel", { rank: result.rank })}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-2">{t("quiz.waitingToStart")}</p>
        </div>
      </Screen>
    )
  }

  if (appState === "submitted") {
    return (
      <Screen k={appState}>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <span className="flex size-20 items-center justify-center bg-teal-700 text-4xl text-white">✓</span>
          <p className="font-heading text-4xl">{t("quiz.answerReceived")}</p>
          <p className="text-sm text-muted-foreground">{t("quiz.waitingToStart")}</p>
        </div>
      </Screen>
    )
  }

  // Active question
  const isLocked = locked || submittedRef.current

  return (
    <Screen padding k={`${appState}-${currentSlide?.id ?? ""}`}>
      <div className="w-full max-w-2xl space-y-7">
        <div className="space-y-1">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
            {t("quiz.slideProgress", { n: slideIndex + 1, total: slideCount })}
          </p>
          <h2 className="font-heading text-3xl leading-tight sm:text-4xl">{currentSlide.prompt}</h2>
        </div>

        {currentSlide.type === "MCQ" && (() => {
          const config = asMCQ(currentSlide.config)
          return (
            <div className="space-y-2">
              {config.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => handleMCQToggle(i)}
                  disabled={isLocked}
                  className={`min-h-16 w-full border px-5 py-4 text-left text-base font-semibold transition-colors ${selectedIndices.includes(i) ? "border-teal-700 bg-teal-50 text-teal-900" : "border-black/20 bg-white/55 hover:border-teal-700 hover:bg-white"} disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {opt}
                </button>
              ))}
              {config.allowMultiple && !isLocked && selectedIndices.length > 0 && (
                <Button
                  onClick={handleMCQSubmit}
                  disabled={submitting}
                  className="w-full mt-2"
                >
                  {submitting ? t("common.loading") : t("quiz.submitAnswer")}
                </Button>
              )}
            </div>
          )
        })()}

        {currentSlide.type === "WORDCLOUD" && (() => {
          const config = asWordCloud(currentSlide.config)
          return (
            <div className="space-y-3">
              {words.map((w, i) => (
                <Input
                  key={i}
                  value={w}
                  onChange={(e) => {
                    const next = [...words]
                    next[i] = e.target.value
                    setWords(next)
                  }}
                  placeholder={`Word ${i + 1}`}
                  maxLength={30}
                  disabled={isLocked}
                />
              ))}
              {config.allowMultiple && words.length < 5 && !isLocked && (
                <button
                  onClick={() => setWords([...words, ""])}
                  className="text-sm text-teal-600 underline"
                >
                  {t("quiz.addWord")}
                </button>
              )}
              {!isLocked && (
                <Button
                  onClick={() => void submitAnswer({ words: words.filter(Boolean) })}
                  disabled={submitting || words.filter(Boolean).length === 0}
                  className="w-full"
                >
                  {submitting ? t("common.loading") : t("quiz.submitAnswer")}
                </Button>
              )}
            </div>
          )
        })()}

        {currentSlide.type === "SCALE" && (() => {
          const config = asScale(currentSlide.config)
          return (
            <div className="space-y-5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{config.minLabel}</span>
                <span>{config.maxLabel}</span>
              </div>
              {config.statements.map((stmt, i) => (
                <div key={i} className="space-y-2">
                  <p className="text-sm">{stmt}</p>
                  <input
                    type="range"
                    min={config.min}
                    max={config.max}
                    value={scaleValues[i] ?? Math.round((config.min + config.max) / 2)}
                    onChange={(e) => {
                      const next = [...scaleValues]
                      next[i] = Number(e.target.value)
                      setScaleValues(next)
                    }}
                    disabled={isLocked}
                    className="w-full accent-teal-600"
                  />
                  <p className="text-right text-xs text-teal-600 font-semibold">{scaleValues[i]}</p>
                </div>
              ))}
              {!isLocked && (
                <Button
                  onClick={() => void submitAnswer({ values: scaleValues })}
                  disabled={submitting}
                  className="w-full"
                >
                  {submitting ? t("common.loading") : t("quiz.submitAnswer")}
                </Button>
              )}
            </div>
          )
        })()}

        {currentSlide.type === "OPEN_TEXT" && (() => {
          const config = asOpenText(currentSlide.config)
          return (
            <div className="space-y-3">
              <textarea
                value={openText}
                onChange={(e) => setOpenText(e.target.value.slice(0, config.maxLength))}
                disabled={isLocked}
                rows={4}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-50"
                placeholder={t("quiz.builder.promptPlaceholder")}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{openText.length}/{config.maxLength}</span>
              </div>
              {!isLocked && (
                <Button
                  onClick={() => void submitAnswer({ text: openText })}
                  disabled={submitting || openText.trim().length === 0}
                  className="w-full"
                >
                  {submitting ? t("common.loading") : t("quiz.submitAnswer")}
                </Button>
              )}
            </div>
          )
        })()}

        {currentSlide.type === "CONTENT" && (
          <div className="text-muted-foreground text-sm leading-relaxed">
            {(currentSlide.config as { body?: string }).body}
          </div>
        )}

        {isLocked && appState === "question" && (
          <p className="text-center text-sm text-muted-foreground">{t("quiz.votingLocked")}</p>
        )}
      </div>
    </Screen>
  )
}

// k remounts the inner motion wrapper on phase change so the entrance replays.
// hard cuts between phases become a quick fade/rise.
// Both animations here are decorative, and this is the one route that has to
// load fast on a few hundred phones on venue wifi. Doing them in CSS keeps
// framer-motion out of the bundle entirely rather than merely deferring it.
// motion-reduce: preserves what useReducedMotion() was doing.
function Screen({ children, padding, k }: { children: React.ReactNode; padding?: boolean; k?: string }) {
  return (
    <div className={`overscroll-dark relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#07100d] ${padding ? "px-4 py-10" : "px-4 py-8"}`}>
      <div className="paper-grid absolute inset-0 opacity-[0.1]" aria-hidden />
      <div
        aria-hidden
        className="absolute -right-36 -top-36 size-[28rem] animate-[spin_28s_linear_infinite] rounded-full border border-teal-300/25 motion-reduce:animate-none"
      >
        <div className="absolute inset-16 rounded-full border border-dashed border-teal-300/20" />
      </div>
      <div className="absolute left-5 top-5 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-white/45">
        <span className="size-2 animate-pulse bg-teal-300" /> Audience live
      </div>
      {/* key remounts this on phase change so the entrance replays. */}
      <div
        key={k}
        className={`relative z-10 flex w-full max-w-3xl flex-col items-center bg-[#f3eee2] p-6 text-[#111614] shadow-[14px_14px_0_#14b8a6] sm:p-10 motion-reduce:animate-none ${
          k === undefined ? "" : "animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        }`}
      >
        {children}
      </div>
    </div>
  )
}
