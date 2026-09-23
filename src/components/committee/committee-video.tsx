"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { t } from "@/content/strings"
import { useRealtime } from "@/lib/realtime/client"
import { useVisiblePoll } from "@/lib/use-visible-poll"

// The committee's rooms, Discord style: the floor, and a fixed list of voice-only
// lobbying channels shown with who is in each. Click a channel and you are in it.
//
// Switching is fast because nothing is fetched or re-negotiated that need not be:
// - every token (floor and all six lobbies) comes in one response on load;
// - the floor stays connected while you are in a lobby, only unsubscribed, so
//   coming back when the chair calls time is immediate;
// - the microphone is acquired once and moved between rooms, so the browser's
//   permission prompt appears once, never mid-switch.
// Measured against a local LiveKit: ~160 ms lobby to lobby. Real networks are slower.
//
// What anyone may publish is decided on the server and enforced by LiveKit (the
// floor follows the speakers list; lobbies accept a microphone and nothing else).
// This component only reflects it.

type Tokens =
  | { enabled: false }
  | {
      enabled: true
      url: string
      floor: { room: string; token: string }
      lobbies: { slot: number; name: string; room: string; token: string }[]
    }

interface Occupant {
  identity: string
  name: string
  dais: boolean
}

interface Tile {
  key: string
  name: string
  track: RemoteTrack
}

type Where = "floor" | number

const OCCUPANCY_POLL_MS = 20_000

function VideoTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    tile.track.attach(el)
    return () => {
      tile.track.detach(el)
    }
  }, [tile.track])
  return (
    <figure className="overflow-hidden rounded-md bg-black">
      <video ref={ref} className="aspect-video w-full object-contain" autoPlay playsInline muted />
      <figcaption className="px-2 py-1 text-xs text-white/80">{tile.name}</figcaption>
    </figure>
  )
}

export function CommitteeVideo({ committeeId, mode }: { committeeId: string; mode: "delegate" | "dais" }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [floorState, setFloorState] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [tiles, setTiles] = useState<Tile[]>([])
  const [canPublish, setCanPublish] = useState(false)
  const [live, setLive] = useState(false)
  const [needsAudio, setNeedsAudio] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [where, setWhere] = useState<Where>("floor")
  const [joining, setJoining] = useState<Where | null>(null)
  const [muted, setMuted] = useState(false)
  const [occupancy, setOccupancy] = useState<Record<number, Occupant[]>>({})
  const [lobbies, setLobbies] = useState<{ slot: number; name: string }[]>([])

  const tokens = useRef<Extract<Tokens, { enabled: true }> | null>(null)
  const floorRef = useRef<Room | null>(null)
  const lobbyRef = useRef<Room | null>(null)
  const micRef = useRef<LocalAudioTrack | null>(null)
  const away = useRef(false)
  const floorAudio = useRef<HTMLDivElement>(null)
  const lobbyAudio = useRef<HTMLDivElement>(null)

  const refreshTiles = useCallback((room: Room) => {
    const next: Tile[] = []
    room.remoteParticipants.forEach((p) => {
      p.videoTrackPublications.forEach((pub) => {
        if (pub.track && pub.isSubscribed) next.push({ key: `${p.identity}:${pub.trackSid}`, name: p.name || p.identity, track: pub.track })
      })
    })
    setTiles(next)
  }, [])

  // In a lobby, the floor keeps its connection but receives nothing: no video,
  // no audio, no bandwidth. Coming back resubscribes.
  const setFloorSubscribed = useCallback((on: boolean) => {
    floorRef.current?.remoteParticipants.forEach((p) => p.trackPublications.forEach((pub) => pub.setSubscribed(on)))
  }, [])

  const stopFloorPublishing = useCallback(async (room: Room) => {
    await room.localParticipant.setCameraEnabled(false).catch(() => {})
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
    setLive(false)
  }, [])

  const loadTokens = useCallback(async (): Promise<boolean> => {
    const r = await fetch(`/api/committee/${committeeId}/video-token`, { method: "POST", cache: "no-store" })
    if (!r.ok) return false
    const body = (await r.json()) as Tokens
    if (!body.enabled) return false
    tokens.current = body
    setLobbies(body.lobbies.map((l) => ({ slot: l.slot, name: l.name })))
    return true
  }, [committeeId])

  const refreshOccupancy = useCallback(async () => {
    try {
      const r = await fetch(`/api/committee/${committeeId}/voice`, { cache: "no-store" })
      if (!r.ok) return
      const body = (await r.json()) as { enabled: boolean; channels: Record<number, Occupant[]> }
      if (body.enabled) setOccupancy(body.channels)
    } catch {
      // The next nudge or poll retries.
    }
  }, [committeeId])

  const backToFloor = useCallback(async () => {
    const lobby = lobbyRef.current
    lobbyRef.current = null
    if (lobby) {
      if (micRef.current) await lobby.localParticipant.unpublishTrack(micRef.current, false).catch(() => {})
      await lobby.disconnect()
    }
    lobbyAudio.current?.replaceChildren()
    away.current = false
    setFloorSubscribed(true)
    setWhere("floor")
    if (floorRef.current) refreshTiles(floorRef.current)
    void refreshOccupancy()
  }, [refreshOccupancy, refreshTiles, setFloorSubscribed])

  const connectFloor = useCallback(async () => {
    setError(null)
    let ok: boolean
    try {
      ok = await loadTokens()
    } catch {
      setError(t("video.errorConnect"))
      return
    }
    setEnabled(ok)
    if (!ok || !tokens.current) return

    const room = new Room({ adaptiveStream: true, dynacast: true })
    floorRef.current = room
    room
      .on(RoomEvent.ConnectionStateChanged, setFloorState)
      .on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication) => {
        // Published while we are in a lobby: do not start receiving it.
        if (away.current) pub.setSubscribed(false)
      })
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) floorAudio.current?.append(track.attach())
        refreshTiles(room)
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove())
        refreshTiles(room)
      })
      .on(RoomEvent.ParticipantDisconnected, () => refreshTiles(room))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsAudio(!room.canPlaybackAudio))
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
        if (participant !== room.localParticipant) return
        const allowed = !!room.localParticipant.permissions?.canPublish
        setCanPublish(allowed)
        if (!allowed) void stopFloorPublishing(room)
        // Called to speak while lobbying: come back to the floor at once.
        if (allowed && away.current && mode === "delegate") void backToFloor()
      })
    try {
      await room.connect(tokens.current.url, tokens.current.floor.token, { autoSubscribe: true })
      setCanPublish(!!room.localParticipant.permissions?.canPublish)
      setNeedsAudio(!room.canPlaybackAudio)
      refreshTiles(room)
    } catch {
      setError(t("video.errorConnect"))
    }
    void refreshOccupancy()
  }, [backToFloor, loadTokens, mode, refreshOccupancy, refreshTiles, stopFloorPublishing])

  useEffect(() => {
    void connectFloor()
    return () => {
      void lobbyRef.current?.disconnect()
      void floorRef.current?.disconnect()
      micRef.current?.stop()
      lobbyRef.current = null
      floorRef.current = null
      micRef.current = null
    }
  }, [connectFloor])

  useRealtime<null>(`committee:${committeeId}`, {
    event: "voice",
    onEvent: () => void refreshOccupancy(),
    onOpen: () => void refreshOccupancy(),
  })
  useVisiblePoll(OCCUPANCY_POLL_MS, () => void refreshOccupancy())

  const enterLobby = async (slot: number, retried = false): Promise<void> => {
    const set = tokens.current
    const target = set?.lobbies.find((l) => l.slot === slot)
    if (!set || !target) return
    const mic = micRef.current!
    const room = new Room({ adaptiveStream: true, dynacast: true })
    room
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) lobbyAudio.current?.append(track.attach())
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        track.detach().forEach((el) => el.remove())
      })
    try {
      await room.connect(set.url, target.token, { autoSubscribe: true })
      await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone, stopMicTrackOnMute: false })
      lobbyRef.current = room
    } catch (err) {
      await room.disconnect().catch(() => {})
      // A tab left open past the token's lifetime: fetch a fresh set once.
      if (!retried && (await loadTokens().catch(() => false))) return enterLobby(slot, true)
      throw err
    }
  }

  const joinLobby = async (slot: number) => {
    if (joining !== null || where === slot) return
    // A delegate holding the floor stays on it until the speech ends.
    if (mode === "delegate" && canPublish) {
      setError(t("voice.speakingNote"))
      return
    }
    setError(null)
    setJoining(slot)
    try {
      if (!micRef.current) {
        try {
          micRef.current = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true })
        } catch {
          setError(t("voice.errorMic"))
          return
        }
      }
      if (muted) await micRef.current.mute()
      away.current = true
      setFloorSubscribed(false)
      if (floorRef.current && live) await stopFloorPublishing(floorRef.current)

      const previous = lobbyRef.current
      lobbyRef.current = null
      if (previous) {
        await previous.localParticipant.unpublishTrack(micRef.current, false).catch(() => {})
        await previous.disconnect()
        lobbyAudio.current?.replaceChildren()
      }
      await enterLobby(slot)
      setWhere(slot)
    } catch {
      setError(t("voice.errorJoin"))
      await backToFloor()
    } finally {
      setJoining(null)
      void refreshOccupancy()
    }
  }

  const toggleMute = async () => {
    const mic = micRef.current
    if (!mic) return
    if (muted) await mic.unmute()
    else await mic.mute()
    setMuted(!muted)
  }

  const goLive = async () => {
    const room = floorRef.current
    if (!room) return
    setError(null)
    try {
      await room.localParticipant.setMicrophoneEnabled(true)
      await room.localParticipant.setCameraEnabled(true)
      setLive(true)
    } catch {
      setError(t("video.errorDevices"))
      await stopFloorPublishing(room)
    }
  }

  if (!enabled) return null

  const inLobby = where !== "floor"
  const here = (slot: Where) => where === slot

  return (
    <section className="grid gap-4 rounded-lg border border-border/70 p-4 md:grid-cols-[220px_1fr]">
      <nav className="space-y-3" aria-label={t("voice.channels")}>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("voice.channels")}</p>
        <button
          type="button"
          onClick={() => void backToFloor()}
          disabled={!inLobby || joining !== null}
          className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${here("floor") ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
        >
          {t("voice.floor")}
          {here("floor") && <Badge variant="outline" className="ml-2">{t("voice.here")}</Badge>}
        </button>
        <ul className="space-y-1">
          {lobbies.map((l) => {
            const people = occupancy[l.slot] ?? []
            return (
              <li key={l.slot}>
                <button
                  type="button"
                  onClick={() => void joinLobby(l.slot)}
                  disabled={joining !== null || here(l.slot)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${here(l.slot) ? "bg-primary/10 font-medium" : "hover:bg-muted"}`}
                >
                  {l.name}
                  {joining === l.slot && <span className="ml-2 text-xs text-muted-foreground">{t("voice.joining")}</span>}
                </button>
                <ul className="ml-3 text-xs text-muted-foreground">
                  {people.map((o) => (
                    <li key={o.identity}>
                      {o.name}
                      {o.dais && <span className="ml-1">({t("voice.dais")})</span>}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">{t("voice.audioOnly")}</p>
        {mode === "delegate" && <p className="text-xs text-muted-foreground">{t("voice.daisSees")}</p>}
      </nav>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{inLobby ? lobbies.find((l) => l.slot === where)?.name : t("video.title")}</h2>
          <span className="text-xs text-muted-foreground">
            {floorState === ConnectionState.Connected
              ? t("video.connected")
              : floorState === ConnectionState.Reconnecting
                ? t("video.reconnecting")
                : t("video.disconnected")}
          </span>
        </div>

        {inLobby ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={muted ? "default" : "outline"} onClick={() => void toggleMute()}>
              {muted ? t("voice.unmute") : t("voice.mute")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void backToFloor()}>
              {t("voice.backToFloor")}
            </Button>
          </div>
        ) : tiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("video.nobodyLive")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {tiles.map((tile) => (
              <VideoTile key={tile.key} tile={tile} />
            ))}
          </div>
        )}
        <div ref={floorAudio} className="hidden" />
        <div ref={lobbyAudio} className="hidden" />

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!inLobby && (
          <div className="flex flex-wrap items-center gap-2">
            {needsAudio && (
              <Button size="sm" variant="outline" onClick={() => void floorRef.current?.startAudio()}>
                {t("video.enableSound")}
              </Button>
            )}
            {canPublish && !live && (
              <Button size="sm" onClick={() => void goLive()}>
                {t("video.goLive")}
              </Button>
            )}
            {live && (
              <Button size="sm" variant="outline" onClick={() => floorRef.current && void stopFloorPublishing(floorRef.current)}>
                {t("video.stop")}
              </Button>
            )}
            {floorState === ConnectionState.Disconnected && (
              <Button size="sm" variant="outline" onClick={() => void connectFloor()}>
                {t("video.reconnect")}
              </Button>
            )}
          </div>
        )}
        {!inLobby && mode === "delegate" && !canPublish && <p className="text-xs text-muted-foreground">{t("video.delegateNote")}</p>}
      </div>
    </section>
  )
}
