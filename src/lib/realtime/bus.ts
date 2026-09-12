import { EventEmitter } from "node:events"

// The realtime bus: one process, one in-memory fan-out.
//
// This replaces Supabase broadcast and presence. It works because each
// environment runs exactly ONE app container (docs/AWS.md), the same assumption
// the quiz cache already makes. A second instance would split the fan-out, so
// scaling out needs an external bus (Redis, AppSync) first.
//
// Kept deliberately small: subscribers are SSE writers, publishing is a
// function call from an already-authorized route, and presence is the set of
// currently connected subscribers.

export interface PresenceMeta {
  nickname: string
  avatar: string
  userId: string
}

interface Subscriber {
  id: string
  channel: string
  presence: PresenceMeta | null
  send: (event: string, data: unknown) => void
}

// Survives hot reload in dev, where the module is re-evaluated on every edit.
const globalForBus = globalThis as unknown as { munBus?: Bus }

class Bus {
  private subscribers = new Map<string, Set<Subscriber>>()
  // Node warns at 10 listeners; a quiz room is 150+ phones.
  readonly emitter = new EventEmitter().setMaxListeners(0)

  subscribe(sub: Subscriber): () => void {
    const set = this.subscribers.get(sub.channel) ?? new Set<Subscriber>()
    set.add(sub)
    this.subscribers.set(sub.channel, set)
    if (sub.presence) this.publishPresence(sub.channel)
    return () => {
      set.delete(sub)
      if (set.size === 0) this.subscribers.delete(sub.channel)
      else if (sub.presence) this.publishPresence(sub.channel)
    }
  }

  publish(channel: string, event: string, data: unknown): number {
    const set = this.subscribers.get(channel)
    if (!set) return 0
    for (const sub of set) {
      try {
        sub.send(event, data)
      } catch {
        // A dead socket must not stop the rest of the room from updating.
        set.delete(sub)
      }
    }
    return set.size
  }

  /** One entry per userId: a reconnecting phone replaces its own older socket. */
  presence(channel: string): PresenceMeta[] {
    const set = this.subscribers.get(channel)
    if (!set) return []
    const byUser = new Map<string, PresenceMeta>()
    for (const sub of set) if (sub.presence) byUser.set(sub.presence.userId, sub.presence)
    return [...byUser.values()]
  }

  publishPresence(channel: string): void {
    this.publish(channel, "presence", this.presence(channel))
  }

  count(channel: string): number {
    return this.subscribers.get(channel)?.size ?? 0
  }
}

export const bus: Bus = (globalForBus.munBus ??= new Bus())
export type { Subscriber }
