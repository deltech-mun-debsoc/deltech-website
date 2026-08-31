"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getSupabase } from "@/lib/supabase"
import { t, type StringKey } from "@/content/strings"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AVATARS, AVATAR_GROUPS, FALLBACK_AVATAR, type SlideData, type QuizBroadcast, type LBEntry } from "@/lib/quiz-types"
import { asMCQ, asScale, asWordCloud, asOpenText, asNumeric } from "@/lib/quiz-types"
import { cn } from "@/lib/utils"
import { CountUp } from "./count-up"

type AppState =
  | "nickname"
  | "avatar"
  | "lobby"
  | "question"
  | "submitted"
  | "result"
  | "leaderboard"
  | "ended"

interface ResultData {
  correct: boolean | null
  points: number
  rank: number | null
  streakBonus?: number
  alreadySubmitted?: boolean
  resultToken?: string
}

type ReceiptPayload = {
  version: 1
  sessionId: string
  slideId: string
  nickname: string
  correct: boolean | null
  points: number
  streakBonus: number
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function openResultReceipt(
  token: string,
  resultKey: string,
  sessionId: string,
  slideId: string,
  nickname: string,
): Promise<ResultData | null> {
  try {
    const [version, encodedIv, encodedCiphertext, encodedTag] = token.split(".")
    if (version !== "v1" || !encodedIv || !encodedCiphertext || !encodedTag) return null
    const ciphertext = new Uint8Array(decodeBase64Url(encodedCiphertext))
    const tag = new Uint8Array(decodeBase64Url(encodedTag))
    const sealed = new Uint8Array(ciphertext.length + tag.length)
    sealed.set(ciphertext)
    sealed.set(tag, ciphertext.length)
    const key = await crypto.subtle.importKey("raw", decodeBase64Url(resultKey), "AES-GCM", false, ["decrypt"])
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64Url(encodedIv),
        additionalData: new TextEncoder().encode(`${sessionId}:${slideId}`),
        tagLength: 128,
      },
      key,
      sealed.buffer,
    )
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as ReceiptPayload
    if (
      payload.version !== 1 || payload.sessionId !== sessionId || payload.slideId !== slideId ||
      payload.nickname.toLocaleLowerCase() !== nickname.toLocaleLowerCase()
    ) return null
    return {
      correct: payload.correct,
      points: payload.points,
      rank: null,
      streakBonus: payload.streakBonus,
      alreadySubmitted: true,
    }
  } catch {
    return null
  }
}

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

const CORRECT_FEEDBACK: StringKey[] = [
  "quiz.correctFeedback1",
  "quiz.correctFeedback2",
  "quiz.correctFeedback3",
  "quiz.correctFeedback4",
]
const PARTIAL_FEEDBACK: StringKey[] = [
  "quiz.partialFeedback1",
  "quiz.partialFeedback2",
  "quiz.partialFeedback3",
]
const INCORRECT_FEEDBACK: StringKey[] = [
  "quiz.incorrectFeedback1",
  "quiz.incorrectFeedback2",
  "quiz.incorrectFeedback3",
  "quiz.incorrectFeedback4",
]

// The feedback should feel varied, but never flicker to a different sentence
// because React rendered again. A stable seed gives each player/question one
// line and keeps it there for the whole reveal.
function stableFeedback(seed: string, choices: StringKey[]): StringKey {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return choices[hash % choices.length]
}

function movementText(delta: number | undefined): string {
  if (delta === undefined) return t("quiz.joinedBoard")
  if (delta > 0) return t("quiz.movedUp", { count: delta })
  if (delta < 0) return t("quiz.movedDown", { count: Math.abs(delta) })
  return t("quiz.heldPosition")
}

export function ParticipantApp({ sessionId, roomCode, initialStatus, presentationMode, presentationTitle }: Props) {
  const identityStorageKey = `quiz:${sessionId}:identity`
  const receiptStorageKey = `quiz:${sessionId}:receipts`
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
  // The host controls when the answer is revealed. Showing it the instant
  // someone taps spoiled the projected reveal for everyone still answering, and
  // let the front row read the room's phones.
  const [revealed, setRevealed] = useState(false)
  const [revealedAnswers, setRevealedAnswers] = useState<string[]>([])
  // True when voting closed on this slide before this phone answered. The
  // "submitted" screen is reached both ways, and it used to say "Answer
  // received!" to someone who had answered nothing at all.
  const [missed, setMissed] = useState(false)
  // Seconds left on the current slide, mirrored from the slide's own timer so a
  // phone shows the same countdown as the projector.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  // The slide's full timer, so the bar has something to deplete against.
  const [timerDuration, setTimerDuration] = useState<number | null>(null)

  // MCQ state
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  // Word cloud state
  const [words, setWords] = useState<string[]>([""])
  // Scale state
  const [scaleValues, setScaleValues] = useState<number[]>([])
  // Open text state
  const [openText, setOpenText] = useState("")
  const [typedAnswer, setTypedAnswer] = useState("")
  const [numericAnswer, setNumericAnswer] = useState("")

  const channelRef = useRef<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]> | null>(null)
  const userIdRef = useRef(randomUserId())
  const submittedRef = useRef(false)
  const submissionAttemptRef = useRef(0)
  // Which slides this phone has already answered. The server is idempotent too,
  // but this keeps the local UI from reopening an already-used input while a
  // recovery request is in flight.
  const answeredRef = useRef<Set<string>>(new Set())
  const recoveryCheckedRef = useRef<Set<string>>(new Set())
  const revealedResultRef = useRef<Set<string>>(new Set())
  const receiptRef = useRef<Map<string, string>>(new Map())
  // When this question runs out, as a timestamp rather than a countdown. A
  // decrementing counter is wrong on a phone: setInterval is throttled the
  // moment the browser is backgrounded, so a participant who glanced at a
  // message came back to a clock that had lost seconds. Deriving the remaining
  // time from a deadline cannot drift, however badly the timer is throttled.
  const deadlineRef = useRef<number | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  // Which slide is on screen, readable from a callback that must not re-subscribe
  // every time it changes.
  const slideIdRef = useRef<string | null>(null)

  const rememberReceipt = useCallback((slideId: string, token: string) => {
    receiptRef.current.set(slideId, token)
    try {
      localStorage.setItem(receiptStorageKey, JSON.stringify(Object.fromEntries(receiptRef.current)))
    } catch {
      // The server recovery path remains available when storage is disabled.
    }
  }, [receiptStorageKey])

  const revealOwnReceipt = useCallback(async (slideId: string, nick: string, resultKey: string | null | undefined) => {
    const token = receiptRef.current.get(slideId)
    if (!token || !resultKey) return false
    const opened = await openResultReceipt(token, resultKey, sessionId, slideId, nick)
    if (!opened) return false
    revealedResultRef.current.add(slideId)
    setResult(opened)
    setMissed(false)
    setAppState("result")
    return true
  }, [sessionId])

  const recoverOwnResult = useCallback(async (slideId: string, nick: string, ava: string) => {
    try {
      const res = await fetch("/api/quiz/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, slideId, nickname: nick, avatar: ava, answer: null, recoverOnly: true }),
      })
      recoveryCheckedRef.current.add(slideId)
      if (res.status === 410) {
        setAppState("ended")
        return false
      }
      if (!res.ok) return false
      const data = (await res.json()) as ResultData
      if (data.resultToken) rememberReceipt(slideId, data.resultToken)
      submittedRef.current = true
      answeredRef.current.add(slideId)
      if (data.correct !== null) revealedResultRef.current.add(slideId)
      setResult(data)
      setMissed(false)
      setAppState("result")
      return true
    } catch {
      return false
    }
  }, [sessionId, rememberReceipt])

  // Put a question on screen. Reached two ways: the host's GOTO broadcast, and
  // the recovery fetch below. `remaining` is the server's own count of the time
  // left, used when picking a question up part-way through; null means the
  // question is starting now.
  const adoptSlide = useCallback(
    (slide: SlideData, index: number, count: number, remaining: number | null) => {
      submissionAttemptRef.current++
      submittedRef.current = false
      setSubmitting(false)
      slideIdRef.current = slide.id
      setCurrentSlide(slide)
      setSlideIndex(index)
      setSlideCount(count)
      setLocked(false)
      setResult(null)
      setSelectedIndices([])
      setWords([""])
      setOpenText("")
      setTypedAnswer("")
      setNumericAnswer("")
      setRevealed(false)
      setRevealedAnswers([])
      setMissed(false)

      // Mirror the slide's timer locally. The score is computed from the
      // SERVER's start time regardless; this is only the visible clock.
      const timer = (slide.config as { timerSeconds?: number | null }).timerSeconds
      const duration = typeof timer === "number" && timer > 0 ? timer : null
      const left = remaining === null ? duration : Math.min(remaining, duration ?? remaining)
      deadlineRef.current = left === null ? null : Date.now() + left * 1000
      setTimerDuration(duration)
      setSecondsLeft(left === null ? null : Math.ceil(left))

      if (slide.type === "SCALE") {
        const sc = asScale(slide.config)
        setScaleValues(sc.statements.map(() => Math.round((sc.min + sc.max) / 2)))
      }

      setAppState("question")
    },
    [],
  )

  const joinChannel = useCallback((nick: string, ava: string) => {
    if (channelRef.current) return
    const supabase = getSupabase()
    if (!supabase) return

    const channel = supabase.channel(`quiz:${roomCode}`)

    channel
      .on("broadcast", { event: "quiz" }, ({ payload }: { payload: QuizBroadcast }) => {
        if (payload.event === "START") {
          // Host has started, remain in lobby until GOTO
        } else if (payload.event === "LOBBY") {
          submissionAttemptRef.current++
          submittedRef.current = false
          slideIdRef.current = null
          setCurrentSlide(null)
          setSubmitting(false)
          setAppState("lobby")
        } else if (payload.event === "GOTO") {
          adoptSlide(payload.slide, payload.slideIndex, payload.slideCount, null)
        } else if (payload.event === "LOCK") {
          setLocked(true)
          if (!submittedRef.current) {
            setMissed(true)
            setAppState("submitted")
          }
        } else if (payload.event === "UNLOCK") {
          setLocked(false)
          deadlineRef.current = payload.secondsLeft === null
            ? null
            : Date.now() + payload.secondsLeft * 1000
          setSecondsLeft(payload.secondsLeft === null ? null : Math.ceil(payload.secondsLeft))
          if (!submittedRef.current) {
            setMissed(false)
            setAppState("question")
          }
        } else if (payload.event === "REVEAL") {
          // NOW the verdict is allowed on screen, in time with the projector.
          setRevealedAnswers(payload.correctAnswers)
          setRevealed(true)
          const slideId = slideIdRef.current
          if (slideId && submittedRef.current) {
            void revealOwnReceipt(slideId, nick, payload.resultKey).then((opened) => {
              if (!opened) void recoverOwnResult(slideId, nick, ava)
            })
          }
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
  }, [roomCode, adoptSlide, recoverOwnResult, revealOwnReceipt])

  function rememberIdentity(nick: string, ava: string) {
    try {
      localStorage.setItem(identityStorageKey, JSON.stringify({
        nickname: nick,
        avatar: ava,
        userId: userIdRef.current,
      }))
    } catch {
      // Private browsing can disable storage. The server's duplicate guard still
      // protects the score; this phone simply cannot auto-recover its identity.
    }
  }

  // Reloading must resume the same participant, not create a second path to the
  // nickname screen. The stable presence id also lets the new socket replace
  // the old one without falsely reporting that its own nickname is taken.
  useEffect(() => {
    if (initialStatus === "ended" || nickname || avatar) return
    try {
      const raw = localStorage.getItem(identityStorageKey)
      if (!raw) return
      const saved = JSON.parse(raw) as { nickname?: unknown; avatar?: unknown; userId?: unknown }
      if (
        typeof saved.nickname !== "string" || !saved.nickname.trim() ||
        typeof saved.avatar !== "string" || !saved.avatar ||
        typeof saved.userId !== "string" || !saved.userId
      ) return
      userIdRef.current = saved.userId
      setNickname(saved.nickname)
      setNicknameInput(saved.nickname)
      setAvatar(saved.avatar)
      joinChannel(saved.nickname, saved.avatar)
      setAppState("lobby")
    } catch {
      localStorage.removeItem(identityStorageKey)
    }
  }, [avatar, identityStorageKey, initialStatus, joinChannel, nickname])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(receiptStorageKey) ?? "{}") as Record<string, unknown>
      receiptRef.current = new Map(
        Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
    } catch {
      localStorage.removeItem(receiptStorageKey)
    }
  }, [receiptStorageKey])

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
      rememberIdentity(trimmed, ava)
      joinChannel(trimmed, ava)
      setAppState("lobby")
    }
  }

  function handleAvatarSelect(ava: string) {
    setAvatar(ava)
    rememberIdentity(nickname, ava)
    joinChannel(nickname, ava)
    setAppState("lobby")
  }

  // Local countdown, read off the deadline rather than decremented, so a
  // throttled interval loses accuracy but never loses time. Only ever cosmetic:
  // the points come from the server's record of when the slide went live, so a
  // phone with a wrong clock scores exactly the same as one without.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return
    const id = setInterval(() => {
      const deadline = deadlineRef.current
      if (deadline === null) return
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }, 250)
    return () => clearInterval(id)
  }, [secondsLeft])

  // Seat the bar against the deadline rather than against its own start.
  //
  // Two reasons it cannot be left to run on its own. The browser PAUSES a CSS
  // animation while the tab is hidden, so a participant who glanced at a message
  // came back to a bar frozen where they left it, which would then run seconds
  // past the real deadline. And a phone that picks a question up part-way
  // through -- a latecomer, or a recovered socket -- must start the bar part-way
  // through with it, not from full.
  useEffect(() => {
    if (timerDuration === null) return
    function resync() {
      const deadline = deadlineRef.current
      const animation = barRef.current?.getAnimations()[0]
      if (!animation || deadline === null || timerDuration === null) return
      const remaining = Math.max(0, (deadline - Date.now()) / 1000)
      animation.currentTime = (timerDuration - remaining) * 1000
    }
    resync()
    document.addEventListener("visibilitychange", resync)
    return () => document.removeEventListener("visibilitychange", resync)
  }, [timerDuration, currentSlide?.id])

  // Recovery. The room is driven by realtime broadcasts, which are
  // fire-and-forget: a phone that slept through a GOTO, or dropped its socket
  // walking out of range, never hears the question and sits on a stale screen
  // for the rest of the quiz. Ask the server what is actually live, on joining
  // and on every wake, and catch up. One request each time, and it is also what
  // lets someone who joins mid-question answer it instead of watching the room
  // from a lobby screen until the next slide.
  useEffect(() => {
    // Both, not just the nickname: the avatar is set at the same moment the
    // realtime channel is joined, so this is the test for "actually in the
    // room". Gating on the nickname alone pulled people out of the avatar
    // picker and into the live question without ever joining the channel.
    if (!nickname || !avatar) return
    async function catchUp(fromEvent: boolean) {
      // A visibilitychange fires on the way out as well as the way in.
      if (fromEvent && document.visibilityState !== "visible") return
      try {
        const res = await fetch(`/api/quiz/sessions?sessionId=${sessionId}`)
        if (!res.ok) return
        const data = (await res.json()) as {
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
            resultKey: string | null
          } | null
        }
        if (data.session.status === "ended") {
          setAppState("ended")
          return
        }
        const live = data.live
        if (!live) return
        // Only step in when this phone is genuinely behind. Adopting the slide
        // it is already on would wipe an answer it has already given.
        if (slideIdRef.current !== live.slide.id) {
          adoptSlide(live.slide, live.slideIndex, live.slideCount, live.secondsLeft)
        }
        if (!recoveryCheckedRef.current.has(live.slide.id)) {
          await recoverOwnResult(live.slide.id, nickname, avatar)
        }
        // Reconcile every state that realtime can drop. This also extends the
        // phone deadline after the host pauses and reopens voting.
        setLocked(live.locked)
        if (!live.locked && live.secondsLeft !== null) {
          deadlineRef.current = Date.now() + live.secondsLeft * 1000
          setSecondsLeft(Math.ceil(live.secondsLeft))
        }
        if (live.locked && !submittedRef.current) {
          setMissed(true)
          setAppState("submitted")
        } else if (!live.locked && !submittedRef.current) {
          setMissed(false)
          setAppState("question")
        }
        if (live.revealed) {
          setRevealedAnswers(live.correctAnswers)
          setRevealed(true)
          if (submittedRef.current && !revealedResultRef.current.has(live.slide.id)) {
            const opened = await revealOwnReceipt(live.slide.id, nickname, live.resultKey)
            // A phone that reloaded without local storage still has a safe,
            // idempotent server fallback. Normal reveal traffic never gets here.
            if (!opened) await recoverOwnResult(live.slide.id, nickname, avatar)
          }
        }
      } catch {
        // Offline, or the request was cut short. The next wake tries again.
      }
    }
    const onVisible = () => void catchUp(true)
    void catchUp(false)
    const interval = setInterval(() => void catchUp(false), 5_000)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [nickname, avatar, sessionId, adoptSlide, recoverOwnResult, revealOwnReceipt])

  // A buzz at ten, at five, and at nothing left. Half the room is looking at the
  // projector, not at their hand: the phone has to be able to interrupt them.
  // Android only -- iOS Safari has no Vibration API -- so it is an addition to
  // the bar, never the only warning.
  useEffect(() => {
    if (secondsLeft === null || submittedRef.current) return
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return
    if (secondsLeft === 10 || secondsLeft === 5) navigator.vibrate(70)
    else if (secondsLeft === 0) navigator.vibrate([90, 70, 90])
  }, [secondsLeft])

  // ── Answer submit ──────────────────────────────────────────────────────────
  async function submitAnswer(answer: unknown) {
    if (submittedRef.current || !currentSlide) return
    const slideId = currentSlide.id
    const submissionAttempt = ++submissionAttemptRef.current
    submittedRef.current = true
    setSubmitting(true)
    setMissed(false)
    // A tap should feel instant even when the free database tier is absorbing
    // an auditorium burst. Lock the phone locally now; the server remains the
    // authority and sends us back to the question if it rejects the answer.
    setAppState("submitted")

    const requestBody = JSON.stringify({ sessionId, slideId, nickname, avatar, answer })
    const retryStartedAt = Date.now()
    let res: Response
    let problem: { error?: string } | null = null
    let attempt = 0
    while (true) {
      try {
        res = await fetch("/api/quiz/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestBody,
          // Let the small answer request finish if the participant backgrounds
          // or reloads the tab immediately after tapping.
          keepalive: true,
        })
      } catch {
        if (submissionAttemptRef.current === submissionAttempt) {
          submittedRef.current = false
          setSubmitting(false)
          setAppState("question")
        }
        return
      }
      if (submissionAttemptRef.current !== submissionAttempt) return
      problem = res.ok
        ? null
        : await res.clone().json().catch(() => null) as { error?: string } | null
      // The projector and phones switch immediately, while the authenticated
      // session update runs behind them. A very fast answer can beat that one
      // database write on a cold free-tier function; retry only this transient
      // state, invisibly, while preserving the original question and answer.
      if (
        res.status !== 409 || problem?.error !== "slide_not_active" ||
        Date.now() - retryStartedAt >= 8_000
      ) break
      const delay = Math.min(1_500, 200 * 2 ** attempt)
      attempt++
      await new Promise((resolve) => setTimeout(resolve, delay))
      if (submissionAttemptRef.current !== submissionAttempt) return
    }

    if (submissionAttemptRef.current !== submissionAttempt) return
    setSubmitting(false)
    if (res.ok) {
      answeredRef.current.add(slideId)
      recoveryCheckedRef.current.add(slideId)
      const data = (await res.json()) as ResultData
      if (data.resultToken) rememberReceipt(slideId, data.resultToken)
      setResult(data)
      setAppState("result")
    } else if (res.status === 410) {
      setAppState("ended")
    } else if (res.status === 409 && problem?.error === "slide_not_active") {
      // The host transition ultimately failed or this phone is stale. Recovery
      // will reconcile the live slide; keep the answer retryable meanwhile.
      submittedRef.current = false
      setAppState("question")
    } else if (res.status === 408 || res.status === 409 || res.status === 423) {
      // The server, not the phone, is authoritative about deadline, lock,
      // reveal and the live slide. A direct request after any of those gates
      // lands in the same honest missed-answer state as the realtime event.
      setMissed(true)
      setAppState("submitted")
    } else {
      // A transport failure is retryable. Do not permanently consume the one
      // local submission attempt when the server never accepted it.
      submittedRef.current = false
      setAppState("question")
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
          {/* Grouped and scrollable: 72 emoji in one undifferentiated grid is
              harder to choose from than 20 was, not easier. */}
          <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
            {AVATAR_GROUPS.map((group) => (
              <div key={group.key} className="space-y-2">
                <p className="font-mono text-[0.7rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  {t(`quiz.avatarGroups.${group.key}` as StringKey)}
                </p>
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                  {group.emoji.map((ava) => (
                    <button
                      key={ava}
                      onClick={() => handleAvatarSelect(ava)}
                      aria-label={ava}
                      className={`flex aspect-square items-center justify-center border border-black/15 bg-white/40 p-2 text-3xl transition-all hover:-translate-y-1 hover:bg-white ${avatar === ava ? "border-teal-700 bg-teal-50 shadow-[5px_5px_0_#0f766e]" : ""}`}
                    >
                      {ava}
                    </button>
                  ))}
                </div>
              </div>
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
          <span className="text-7xl">{avatar || FALLBACK_AVATAR}</span>
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
    const visibleEntries = lbEntries.slice(0, 10)
    return (
      <Screen k={appState}>
        <div className="w-full max-w-xl space-y-6 py-2">
          <div className="space-y-2 text-center">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-teal-700">{t("quiz.liveStandings")}</p>
            <h2 className="font-heading text-5xl sm:text-6xl">
            {lbFinal ? t("quiz.finalResults") : t("quiz.leaderboard")}
            </h2>
          </div>
          <div className="space-y-2">
            {visibleEntries.map((entry, index) => {
              const isMe = entry.nickname === nickname
              const movement = entry.delta ?? 0
              return (
              <div
                key={entry.nickname}
                className={cn(
                  "quiz-rank-enter grid grid-cols-[2.5rem_2.75rem_minmax(0,1fr)_auto] items-center gap-2 border px-3 py-2.5",
                  isMe ? "border-teal-700 bg-teal-50 text-teal-950" : "border-black/10 bg-white/45",
                )}
                style={{
                  animationDelay: `${index * 55}ms`,
                  "--quiz-rank-from": `${entry.delta === undefined ? 10 : entry.delta * 50}px`,
                } as React.CSSProperties}
              >
                <span className="text-right font-heading text-2xl tabular-nums text-teal-800">
                  {t("quiz.rankN", { n: entry.rank })}
                </span>
                <span className="text-2xl" aria-hidden>{entry.avatar || FALLBACK_AVATAR}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{entry.nickname}</p>
                  <span
                    className={cn(
                      "inline-block font-mono text-[0.6rem] font-black uppercase tracking-wide",
                      movement > 0 && "text-emerald-700",
                      movement < 0 && "text-rose-700",
                      movement === 0 && "text-black/45",
                    )}
                  >
                    {movementText(entry.delta)}
                  </span>
                </div>
                <span className="text-right font-mono text-sm font-black tabular-nums">
                  {entry.totalPoints.toLocaleString()} <span className="text-[0.55rem] text-black/45">{t("quiz.pointsShort")}</span>
                </span>
              </div>
              )
            })}
          </div>
          {myEntry && !visibleEntries.find((e) => e.nickname === nickname) && (
            <div className="flex items-center gap-3 border border-teal-700 bg-teal-50 px-4 py-3">
              <span className="w-8 font-mono text-sm font-black text-teal-700">
                {t("quiz.rankN", { n: myEntry.rank })}
              </span>
              <span className="text-2xl">{myEntry.avatar || FALLBACK_AVATAR}</span>
              <span className="flex-1 truncate text-sm font-bold">{myEntry.nickname}</span>
              <span className="font-mono text-sm font-black tabular-nums">{myEntry.totalPoints.toLocaleString()} {t("quiz.pointsShort")}</span>
            </div>
          )}
        </div>
      </Screen>
    )
  }

  if (!currentSlide) return <Screen k="loading"><p className="text-muted-foreground">{t("common.loading")}</p></Screen>

  // ── Question screen ──────────────────────────────────────────────────────
  if (appState === "result" && result) {
    // The verdict waits for the host's REVEAL, so a phone cannot spoil the
    // projected answer for the people still deciding. A scored slide that has
    // not been revealed shows a neutral "answer received" instead.
    const showVerdict = revealed && result.correct !== null
    const partial = showVerdict && result.correct === false && result.points > 0
    const feedbackKey = stableFeedback(
      `${nickname}:${currentSlide.id}`,
      result.correct ? CORRECT_FEEDBACK : partial ? PARTIAL_FEEDBACK : INCORRECT_FEEDBACK,
    )
    return (
      <Screen
        k={`${appState}-${showVerdict ? "revealed" : "waiting"}`}
        tone={showVerdict ? (result.correct ? "correct" : partial ? "partial" : "incorrect") : "neutral"}
      >
        <div className="flex min-h-[28rem] w-full flex-col items-center justify-center gap-5 py-8 text-center">
          {showVerdict && result.correct === true && (
            <>
              <span className="quiz-result-pop text-7xl" aria-hidden>✓</span>
              <p className="font-mono text-xs font-black uppercase tracking-[0.24em] text-emerald-800">{t("quiz.correct")}</p>
              <p className="max-w-[11ch] font-heading text-5xl leading-[0.95] text-emerald-950 sm:text-6xl">{t(feedbackKey)}</p>
              <p className="font-mono text-3xl font-black text-emerald-800 tabular-nums">
                +<CountUp to={result.points} /> {t("quiz.pointsShort")}
              </p>
              {(result.streakBonus ?? 0) > 0 && (
                <p className="text-sm font-medium text-amber-600">
                  {t("quiz.streakEarned", { points: result.streakBonus ?? 0 })}
                </p>
              )}
            </>
          )}
          {showVerdict && result.correct === false && (
            <>
              <span className="quiz-result-pop text-7xl" aria-hidden>{partial ? "◎" : "↗"}</span>
              {/* Partial credit (a near-miss number, a partly-right multi-select)
                  is not simply "wrong": saying so would be a lie about the score
                  they can see on the leaderboard. */}
              <p className={cn("font-mono text-xs font-black uppercase tracking-[0.24em]", partial ? "text-amber-800" : "text-rose-800")}>
                {t(result.points > 0 ? "quiz.closeEnough" : "quiz.incorrect")}
              </p>
              <p className={cn("max-w-[12ch] font-heading text-5xl leading-[0.95] sm:text-6xl", partial ? "text-amber-950" : "text-rose-950")}>
                {t(feedbackKey)}
              </p>
              {result.points > 0 && (
                <p className="font-mono text-3xl font-black text-amber-800 tabular-nums">
                  +<CountUp to={result.points} /> {t("quiz.pointsShort")}
                </p>
              )}
            </>
          )}
          {!showVerdict && (
            <>
              <span className="flex size-24 items-center justify-center rounded-full bg-teal-700 text-5xl text-white">✓</span>
              <p className="font-mono text-xs font-black uppercase tracking-[0.24em] text-teal-800">{t("quiz.answerLocked")}</p>
              <p className="max-w-sm font-heading text-4xl leading-tight">{t("quiz.revealIncoming")}</p>
            </>
          )}
          {showVerdict && revealedAnswers.length > 0 && (
            <div className="mt-2 w-full max-w-md border-t border-current/15 pt-4">
              <p className="font-mono text-[0.65rem] font-black uppercase tracking-[0.2em] opacity-55">{t("quiz.correctAnswer")}</p>
              <p className="mt-1 text-lg font-bold">{revealedAnswers.join(" · ")}</p>
            </div>
          )}
          {showVerdict && result.rank !== null && (
            <p className="text-muted-foreground">
              {t("quiz.yourRankLabel", { rank: result.rank })}
            </p>
          )}
          {/* Not "waiting for the host to start": the quiz has started. There
              are three states here and they are genuinely different -- a verdict
              already shown, a verdict being withheld until the host reveals it,
              and a poll, where no verdict is ever coming and promising results
              would just leave the phone waiting for something that never
              arrives. */}
          <p className="mt-2 text-sm opacity-60">
            {t(showVerdict || result.correct === null ? "quiz.nextQuestionSoon" : "quiz.waitingForResults")}
          </p>
        </div>
      </Screen>
    )
  }

  if (appState === "submitted") {
    return (
      <Screen k={appState}>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <span
            className={cn(
              "flex size-20 items-center justify-center text-4xl text-white",
              missed ? "bg-muted-foreground" : "bg-teal-700",
            )}
          >
            {missed ? "⏱" : "✓"}
          </span>
          <p className="font-heading text-4xl">
            {t(missed ? "quiz.timeUp" : "quiz.answerReceived")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(missed ? "quiz.missedThisOne" : "quiz.waitingForResults")}
          </p>
        </div>
      </Screen>
    )
  }

  // Active question
  const isLocked = locked || submittedRef.current

  // The last quarter, or the last five seconds, whichever comes first: a 90
  // second question should not spend 22 of them screaming, and a 10 second one
  // must still warn before it is too late to answer.
  const timed = timerDuration !== null && secondsLeft !== null
  const urgent = timed && !isLocked && (secondsLeft <= 5 || secondsLeft / timerDuration <= 0.25)

  return (
    <Screen
      padding
      k={`${appState}-${currentSlide?.id ?? ""}`}
      urgent={urgent}
      /* The clock, across the top of the phone rather than tucked beside the
         question number. Pinned to the viewport, so it is still there once the
         options have pushed the header off screen, and drained in CSS against
         the question's own duration -- smooth at 60fps, and unable to drift from
         the digit beside it. Cosmetic either way: the points come from the
         server's record of when the slide went live.
         It is passed in rather than nested in the card because the card carries
         an entrance transform, and a transformed ancestor would make `fixed`
         resolve against the card instead of the viewport. */
      banner={
        timed ? (
          <div
            className="fixed inset-x-0 top-0 z-50 h-2 bg-black/30"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={timerDuration}
            aria-valuenow={secondsLeft}
            aria-label={t("quiz.timeRemaining")}
          >
            <div
              key={currentSlide.id}
              ref={barRef}
              className={cn("quiz-drain-bar h-full", isLocked && "[animation-play-state:paused]")}
              style={{ "--quiz-duration": `${timerDuration}s` } as React.CSSProperties}
            />
          </div>
        ) : null
      }
    >
      <div className="w-full max-w-2xl space-y-7">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
              {t("quiz.slideProgress", { n: slideIndex + 1, total: slideCount })}
            </p>
            {secondsLeft !== null && !isLocked && (
              <span
                className={cn(
                  "font-mono font-bold tabular-nums transition-all",
                  urgent ? "scale-110 text-3xl text-destructive" : "text-2xl text-teal-700",
                )}
                aria-live="off"
              >
                {secondsLeft}
              </span>
            )}
          </div>
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

        {/* True/false is a two-option MCQ underneath, but on a phone it deserves
            two big targets rather than a list. */}
        {currentSlide.type === "TRUE_FALSE" && (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1].map((index) => (
              <button
                key={index}
                disabled={isLocked || submitting}
                onClick={() => void submitAnswer({ selectedIndices: [index] })}
                className={cn(
                  "flex min-h-28 items-center justify-center rounded-xl border-2 text-2xl font-semibold transition-transform active:scale-95 disabled:opacity-50",
                  index === 0
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-rose-600 bg-rose-50 text-rose-900",
                )}
              >
                {t(index === 0 ? "quiz.trueLabel" : "quiz.falseLabel")}
              </button>
            ))}
          </div>
        )}

        {currentSlide.type === "TYPE_ANSWER" && (
          <div className="space-y-3">
            <input
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value.slice(0, 120))}
              disabled={isLocked}
              // Autocorrect turns a right answer into a wrong one on a phone.
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              onKeyDown={(e) => {
                if (e.key === "Enter" && typedAnswer.trim() && !isLocked) {
                  void submitAnswer({ text: typedAnswer })
                }
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-50"
              placeholder={t("quiz.typeAnswerPlaceholder")}
            />
            {!isLocked && (
              <Button
                onClick={() => void submitAnswer({ text: typedAnswer })}
                disabled={submitting || typedAnswer.trim().length === 0}
                className="w-full"
              >
                {submitting ? t("common.loading") : t("quiz.submitAnswer")}
              </Button>
            )}
          </div>
        )}

        {currentSlide.type === "NUMERIC" && (() => {
          const config = asNumeric(currentSlide.config)
          return (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  value={numericAnswer}
                  onChange={(e) => setNumericAnswer(e.target.value)}
                  disabled={isLocked}
                  // Numeric keypad, but text mode so a decimal point and a minus
                  // sign both survive on iOS.
                  inputMode="decimal"
                  enterKeyHint="send"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && numericAnswer.trim() && !isLocked) {
                      void submitAnswer({ value: Number(numericAnswer) })
                    }
                  }}
                  className="w-full rounded-md border border-border bg-background px-3 py-3 text-center text-2xl tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:opacity-50"
                  placeholder={t("quiz.numericPlaceholder")}
                />
                {config.unit && (
                  <span className="shrink-0 text-lg text-muted-foreground">{config.unit}</span>
                )}
              </div>
              {!isLocked && (
                <Button
                  onClick={() => void submitAnswer({ value: Number(numericAnswer) })}
                  disabled={submitting || !Number.isFinite(Number(numericAnswer)) || numericAnswer.trim() === ""}
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
function Screen({ children, padding, k, urgent, banner, tone = "neutral" }: {
  children: React.ReactNode
  padding?: boolean
  k?: string
  urgent?: boolean
  banner?: React.ReactNode
  tone?: "neutral" | "correct" | "partial" | "incorrect"
}) {
  const toneClass = {
    neutral: "bg-[#f3eee2] shadow-[14px_14px_0_#14b8a6]",
    correct: "bg-emerald-100 shadow-[14px_14px_0_#16a34a]",
    partial: "bg-amber-100 shadow-[14px_14px_0_#d97706]",
    incorrect: "bg-rose-100 shadow-[14px_14px_0_#e11d48]",
  }[tone]
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
      {banner}
      {/* key remounts this on phase change so the entrance replays. */}
      <div
        key={k}
        className={`relative z-10 flex w-full max-w-3xl flex-col items-center p-6 text-[#111614] sm:p-10 motion-reduce:animate-none ${toneClass} ${
          k === undefined ? "" : "animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        } ${urgent ? "quiz-urgent" : ""}`}
      >
        {children}
      </div>
    </div>
  )
}
