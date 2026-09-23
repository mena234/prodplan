import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import dotenv from "dotenv";
import { testDb } from "./platform-test-db";
const env = dotenv.parse(fs.readFileSync(".env")),
  base = "http://127.0.0.1:3018";
assert.ok(env.MAILGUN_WEBHOOK_SIGNING_KEY);
assert.equal(env.MAILGUN_DOMAIN, "mg.example.test");
const row = testDb
  .prepare(
    "SELECT id FROM email_outbox WHERE recipient LIKE '%@example.test' AND status='pending' LIMIT 1",
  )
  .get() as { id: string };
assert.ok(row);
const now = Date.now() / 1000;
function signed(event: string, timestamp = now, offset = 0) {
  const time = String(Math.floor(now + offset)),
    token =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
  return {
    signature: {
      timestamp: time,
      token,
      signature: createHmac("sha256", env.MAILGUN_WEBHOOK_SIGNING_KEY)
        .update(time + token)
        .digest("hex"),
    },
    "event-data": {
      event,
      timestamp,
      severity: "permanent",
      message: {
        headers: { "message-id": `<prodplan-${row.id}@${env.MAILGUN_DOMAIN}>` },
      },
      "user-variables": { outbox_id: row.id },
    },
  };
}
async function send(value: unknown, status = 200) {
  const r = await fetch(`${base}/api/webhooks/mailgun`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  assert.equal(r.status, status, await r.text());
}
function status() {
  return (
    testDb
      .prepare("SELECT status FROM email_outbox WHERE id=?")
      .get(row.id) as { status: string }
  ).status;
}
try {
  const bad = signed("accepted");
  bad.signature.signature = "0".repeat(64);
  await send(bad, 401);
  await send(signed("accepted", now, -600), 401);
  await send(signed("accepted"));
  assert.equal(status(), "accepted");
  await send(signed("delivered", now + 1));
  assert.equal(status(), "delivered");
  await send(signed("failed", now - 1));
  await send(signed("accepted"));
  await send(signed("delivered", now + 1));
  assert.equal(status(), "delivered");
  console.log(
    "Signed Mailgun webhook checks passed: forged and expired signatures rejected, accepted/delivered events saved, duplicate and out-of-order events safe.",
  );
} finally {
  testDb.close();
}
