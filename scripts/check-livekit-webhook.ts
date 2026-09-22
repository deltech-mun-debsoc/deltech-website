// Runnable check for the LiveKit webhook signature:
//   npx tsx scripts/check-livekit-webhook.ts
//
// The webhook route is open to the internet; the signature is the only thing
// that makes a request LiveKit's. These sign requests exactly as LiveKit does
// and prove only an intact, correctly signed body is accepted.
import assert from "node:assert"
import { createHash } from "node:crypto"
import { AccessToken } from "livekit-server-sdk"
import { MAX_WEBHOOK_BYTES, verifyWebhook } from "../src/lib/livekit/webhook"

const config = { url: "ws://localhost:7880", httpUrl: "http://localhost:7880", apiKey: "devkey", apiSecret: "a-long-enough-dev-secret-for-hs256" }

async function sign(body: string, key = config.apiKey, secret = config.apiSecret): Promise<string> {
  const at = new AccessToken(key, secret, { ttl: 600 })
  at.sha256 = createHash("sha256").update(body).digest("base64")
  return at.toJwt()
}

async function main() {
  const body = JSON.stringify({
    event: "participant_joined",
    room: { name: "floor_cs_1" },
    participant: { identity: "seat:p_fr:u1" },
    id: "EV_1",
    createdAt: "1",
  })
  const good = await sign(body)

  const event = await verifyWebhook(config, body, good)
  assert.equal(event?.event, "participant_joined", "a correctly signed event is accepted")
  assert.equal(event?.participant?.identity, "seat:p_fr:u1")

  assert.equal(await verifyWebhook(config, body, null), null, "no signature, no event")
  assert.equal(await verifyWebhook(config, body, ""), null)
  assert.equal(await verifyWebhook(config, body.replace("u1", "u2"), good), null, "a body changed after signing is refused")
  assert.equal(await verifyWebhook(config, body, await sign(body, config.apiKey, "someone-elses-secret-entirely-x")), null,
    "signed with the wrong secret is refused")
  assert.equal(await verifyWebhook(config, body, await sign(body, "otherkey")), null, "signed for another API key is refused")
  assert.equal(await verifyWebhook(config, body, "Bearer " + good + "x"), null, "a mangled token is refused")
  // Re-serialising the JSON changes bytes (spacing, key order), which is why the
  // route hashes the raw text and never a parsed-and-restringified body.
  assert.equal(await verifyWebhook(config, JSON.stringify(JSON.parse(body), null, 1), good), null,
    "the signature covers the exact bytes, not the parsed JSON")
  const huge = JSON.stringify({ event: "room_started", pad: "x".repeat(MAX_WEBHOOK_BYTES) })
  assert.equal(await verifyWebhook(config, huge, await sign(huge)), null, "oversized bodies are refused before hashing")

  console.log("livekit webhook checks passed (valid, unsigned, tampered, wrong secret, wrong key, mangled, re-serialised, oversized)")
}
main().catch((e) => { console.error(e); process.exit(1) })
