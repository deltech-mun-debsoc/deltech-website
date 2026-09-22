#!/usr/bin/env tsx
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { POST } from "../src/app/api/webhooks/razorpay/route"

const previous = process.env.RAZORPAY_WEBHOOK_SECRET
const body = JSON.stringify({ event: "harmless.unhandled", payload: {} })

function request(signature: string) {
  return new Request("https://example.test/api/webhooks/razorpay", {
    method: "POST",
    headers: { "x-razorpay-signature": signature },
    body,
  })
}

async function main() {
try {
  delete process.env.RAZORPAY_WEBHOOK_SECRET
  const missing = await POST(request(createHmac("sha256", "").update(body).digest("hex")) as never)
  assert.equal(missing.status, 503, "an empty-key signature must never authenticate")

  process.env.RAZORPAY_WEBHOOK_SECRET = "test-secret"
  assert.equal((await POST(request("not-hex") as never)).status, 400)
  assert.equal((await POST(request("00".repeat(32)) as never)).status, 400)

  const signature = createHmac("sha256", "test-secret").update(body).digest("hex")
  const valid = await POST(request(signature) as never)
  assert.equal(valid.status, 200)
  assert.deepEqual(await valid.json(), { received: true })
} finally {
  if (previous === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET
  else process.env.RAZORPAY_WEBHOOK_SECRET = previous
}

console.log("razorpay webhook security checks passed (missing, malformed, invalid and valid signatures)")
}

main().catch((error) => { console.error(error); process.exit(1) })
