"use client"

import { QRCodeSVG } from "qrcode.react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { readableOn } from "@/lib/quiz-theme"
import { t } from "@/content/strings"
import type { PresenceEntry, PresentationTheme } from "@/lib/quiz-types"

interface Props {
  roomCode: string
  joinUrl: string
  participants: PresenceEntry[]
  theme: PresentationTheme
  onStart: () => void
}

export function LobbyScreen({ roomCode, joinUrl, participants, theme, onStart }: Props) {
  const reduce = useReducedMotion()
  return (
    <div
      className="relative flex h-full flex-col overflow-hidden px-10 py-9"
      style={{ background: theme.background, color: theme.textColor }}
    >
      <div className="paper-grid absolute inset-0 opacity-[0.06]" aria-hidden />
      {/* Top: join instructions */}
      <div className="relative flex items-center justify-between border-b border-current/15 pb-5">
        <p className="flex items-center gap-3 font-mono text-sm font-bold uppercase tracking-[0.2em]">
          <span className="size-3 animate-pulse" style={{ background: theme.accentColor }} /> {t("quiz.audienceLobbyLive")}
        </p>
        <p className="text-base opacity-60">{t("quiz.joinInstructions", { url: new URL(joinUrl).host })}</p>
      </div>

      <div className="relative grid flex-1 items-center gap-12 lg:grid-cols-[0.72fr_1.28fr]">
        {/* QR code */}
        <div className="flex flex-col items-start gap-4">
          <div className="bg-white p-5 shadow-[14px_14px_0_rgba(20,184,166,0.6)]">
            <QRCodeSVG value={joinUrl} size={220} level="H" />
          </div>
          <p className="max-w-[280px] truncate font-mono text-sm opacity-55">{joinUrl}</p>
        </div>

        {/* Room code */}
        <div className="flex flex-col items-start gap-2">
          <p className="font-mono text-sm font-bold uppercase tracking-[0.25em] opacity-50">{t("quiz.roomCode")}</p>
          <motion.p
            initial={reduce ? false : { scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 18 }}
            className="font-mono text-[clamp(5rem,12vw,10rem)] font-black leading-none tracking-[0.08em] tabular-nums"
            style={{ color: theme.accentColor }}
          >
            {roomCode}
          </motion.p>
        </div>
      </div>

      {/* Participants count + avatar grid */}
      <div className="relative border-t border-current/15 py-5">
        <p className="mb-4 font-mono text-sm font-bold uppercase tracking-[0.16em] opacity-60">
          {t("quiz.connected", { count: participants.length })}
        </p>
        <div className="flex min-h-16 flex-wrap items-center gap-4">
          <AnimatePresence>
            {participants.map((p) => (
              <motion.div
                key={p.userId}
                layout
                initial={reduce ? false : { scale: 0.3, y: 16, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={reduce ? undefined : { scale: 0.3, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className="flex items-center gap-2 border border-current/15 px-3 py-2"
              >
                <motion.span
                  className="text-2xl"
                  initial={reduce ? false : { rotate: -12 }}
                  animate={{ rotate: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 10, delay: 0.1 }}
                >
                  {p.avatar || "👤"}
                </motion.span>
                <span className="max-w-28 truncate font-heading text-lg">{p.nickname}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Start button.
          It used to be disabled whenever the participant count was zero, and
          that is the whole intermittent "Start does nothing" fault: the count comes
          from the Supabase presence channel, so it is 0 until presence syncs,
          0 for a host who opens the projector before the room joins, and 0
          FOREVER wherever realtime is unconfigured -- `getSupabase()` returns
          null by design there, so the quiz could never be started at all. No
          error, no console entry, nothing written: just a click that did
          nothing, which is exactly how it was reported.
          The host decides when to start. An empty room is a warning, not a
          lock: nobody has to join before the first slide is on screen, and
          latecomers join mid-quiz anyway. */}
      <div className="absolute bottom-9 right-10 z-10 flex items-center gap-4">
        {participants.length === 0 && (
          <p className="text-sm opacity-55">{t("quiz.noOneJoinedYet")}</p>
        )}
        <button
          onClick={onStart}
          className="px-10 py-4 font-mono text-sm font-black uppercase tracking-[0.12em] transition-transform hover:-translate-y-1"
          style={{ background: theme.accentColor, color: readableOn(theme.accentColor) }}
        >
          {t("quiz.startBroadcast")}
        </button>
      </div>
    </div>
  )
}
