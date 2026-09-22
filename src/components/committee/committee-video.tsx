"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteParticipant,
} from "livekit-client"
import { Button } from "@/components/ui/button"
import { t } from "@/content/strings"

// The committee's floor room. Who may be seen and heard is decided on the server
// and enforced by LiveKit: a delegate's connection cannot publish until the floor
// is theirs, and loses the right, with its tracks, when it passes on. This
// component only reflects that. It never switches a camera on by itself: a
// delegate given the floor presses Go live.

type TokenResponse = { enabled: false } | { enabled: true; url: string; token: string; room: string }

interface Tile {
  key: string
  name: string
  track: RemoteTrack
}

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
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected)
  const [tiles, setTiles] = useState<Tile[]>([])
  const [canPublish, setCanPublish] = useState(false)
  const [live, setLive] = useState(false)
  const [needsAudio, setNeedsAudio] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const roomRef = useRef<Room | null>(null)
  const audioBox = useRef<HTMLDivElement>(null)

  const refreshTiles = useCallback((room: Room) => {
    const next: Tile[] = []
    room.remoteParticipants.forEach((p: RemoteParticipant) => {
      p.videoTrackPublications.forEach((pub) => {
        if (pub.track && pub.isSubscribed) next.push({ key: `${p.identity}:${pub.trackSid}`, name: p.name || p.identity, track: pub.track })
      })
    })
    setTiles(next)
  }, [])

  const stopLocal = useCallback(async (room: Room) => {
    await room.localParticipant.setCameraEnabled(false).catch(() => {})
    await room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
    setLive(false)
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    let res: TokenResponse
    try {
      const r = await fetch(`/api/committee/${committeeId}/video-token`, { method: "POST", cache: "no-store" })
      if (!r.ok) {
        setEnabled(false)
        return
      }
      res = (await r.json()) as TokenResponse
    } catch {
      setError(t("video.errorConnect"))
      return
    }
    if (!res.enabled) {
      setEnabled(false)
      return
    }
    setEnabled(true)

    const room = new Room({ adaptiveStream: true, dynacast: true })
    roomRef.current = room
    room
      .on(RoomEvent.ConnectionStateChanged, setState)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) audioBox.current?.append(track.attach())
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
        // The server has already unpublished our tracks; release the devices too,
        // so the camera light goes off when the floor passes on.
        if (!allowed) void stopLocal(room)
      })
    try {
      await room.connect(res.url, res.token, { autoSubscribe: true })
      setCanPublish(!!room.localParticipant.permissions?.canPublish)
      setNeedsAudio(!room.canPlaybackAudio)
      refreshTiles(room)
    } catch {
      setError(t("video.errorConnect"))
    }
  }, [committeeId, refreshTiles, stopLocal])

  useEffect(() => {
    void connect()
    return () => {
      void roomRef.current?.disconnect()
      roomRef.current = null
    }
  }, [connect])

  const goLive = async () => {
    const room = roomRef.current
    if (!room) return
    setError(null)
    try {
      await room.localParticipant.setMicrophoneEnabled(true)
      await room.localParticipant.setCameraEnabled(true)
      setLive(true)
    } catch {
      // Most often the browser's camera or microphone permission was refused.
      setError(t("video.errorDevices"))
      await stopLocal(room)
    }
  }

  if (enabled === false) return null
  if (enabled === null) return null

  return (
    <section className="space-y-3 rounded-lg border border-border/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("video.title")}</h2>
        <span className="text-xs text-muted-foreground">
          {state === ConnectionState.Connected
            ? t("video.connected")
            : state === ConnectionState.Reconnecting
              ? t("video.reconnecting")
              : t("video.disconnected")}
        </span>
      </div>

      {tiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("video.nobodyLive")}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {tiles.map((tile) => (
            <VideoTile key={tile.key} tile={tile} />
          ))}
        </div>
      )}
      <div ref={audioBox} className="hidden" />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {needsAudio && (
          <Button size="sm" variant="outline" onClick={() => void roomRef.current?.startAudio()}>
            {t("video.enableSound")}
          </Button>
        )}
        {canPublish && !live && (
          <Button size="sm" onClick={() => void goLive()}>
            {t("video.goLive")}
          </Button>
        )}
        {live && (
          <Button size="sm" variant="outline" onClick={() => roomRef.current && void stopLocal(roomRef.current)}>
            {t("video.stop")}
          </Button>
        )}
        {state === ConnectionState.Disconnected && (
          <Button size="sm" variant="outline" onClick={() => void connect()}>
            {t("video.reconnect")}
          </Button>
        )}
      </div>
      {mode === "delegate" && !canPublish && <p className="text-xs text-muted-foreground">{t("video.delegateNote")}</p>}
    </section>
  )
}
