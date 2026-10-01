"use client"

import { useRouter } from "next/navigation"
import { useRealtime } from "@/lib/realtime/client"
import { useVisiblePoll } from "@/lib/use-visible-poll"

// The secretariat opens and closes sessions from /admin. Opening or closing
// nudges the committee channel, and this re-renders the chair's page so it moves
// between "waiting" and the live dais without a reload. The poll is the backstop
// for a nudge missed while the connection was down, and the only signal for a
// chair not yet assigned anywhere, who has no committee channel to hear from.
export function SessionWatch({ committeeId }: { committeeId: string | null }) {
  const router = useRouter()
  useRealtime<null>(committeeId && `committee:${committeeId}`, { event: "floor", onEvent: () => router.refresh() })
  useVisiblePoll(30_000, () => router.refresh())
  return null
}
