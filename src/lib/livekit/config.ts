// LiveKit connection settings, read from the environment on the server.
//
// Video is off wherever these are unset, which today is every deployed
// environment: the SFU is provisioned only for the conference month. Callers get
// null and hide video rather than failing, so the rest of the committee floor
// works the same with or without it.
//
// Because the URL, key and secret are configuration and nothing else names a
// host, moving from the self-hosted server to LiveKit Cloud in an emergency is an
// edit to /srv/mun/app.env and a restart. That is the whole failover.

export interface LiveKitConfig {
  /** What the browser connects to, e.g. wss://sfu.example.com or ws://localhost:7880. */
  url: string
  apiKey: string
  apiSecret: string
  /** The same server over HTTP(S), for the server SDK. */
  httpUrl: string
}

export function liveKitConfig(env: Record<string, string | undefined> = process.env): LiveKitConfig | null {
  const url = env.LIVEKIT_URL?.trim()
  const apiKey = env.LIVEKIT_API_KEY?.trim()
  const apiSecret = env.LIVEKIT_API_SECRET?.trim()
  if (!url || !apiKey || !apiSecret) return null
  if (!/^wss?:\/\//.test(url)) return null
  // A plain ws:// URL is only acceptable on this machine; anywhere else the media
  // signalling would travel unencrypted.
  if (url.startsWith("ws://") && !/^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) return null
  return { url, apiKey, apiSecret, httpUrl: url.replace(/^ws/, "http") }
}
