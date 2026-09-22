import { WebhookReceiver, type WebhookEvent } from "livekit-server-sdk"
import type { LiveKitConfig } from "./config"

// LiveKit signs each webhook with a JWT from the API secret whose sha256 claim is
// the hash of the exact body. So the body must be verified as the raw text that
// arrived, never re-serialised JSON, and nothing in it is trusted before this
// returns. Bodies are small; anything large is not LiveKit.
export const MAX_WEBHOOK_BYTES = 64 * 1024

export async function verifyWebhook(
  config: LiveKitConfig,
  body: string,
  authorization: string | null,
): Promise<WebhookEvent | null> {
  if (!authorization || body.length > MAX_WEBHOOK_BYTES) return null
  try {
    // skipAuth is never passed: an unsigned event is refused, not parsed.
    return await new WebhookReceiver(config.apiKey, config.apiSecret).receive(body, authorization)
  } catch {
    return null
  }
}
