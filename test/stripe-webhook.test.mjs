import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { handleStripeWebhook } from "../commerce-stripe.mjs";
import { topUpWallet } from "../commerce-wallet.mjs";

const stripe = new Stripe("sk_test_example");
const secret = "whsec_test_secret";
process.env.STRIPE_WEBHOOK_SECRET = secret;
const buyerId = "70ca0000-0000-4000-8000-000000000001";
const requestId = "70ca0000-0000-4000-8000-000000000002";
const event = (overrides = {}) => ({
  type: "checkout.session.completed", livemode: false,
  data: { object: { livemode: false, mode: "payment", payment_status: "paid",
    amount_total: 50000, currency: "vnd", metadata: { buyerId, requestId }, ...overrides } },
});
function signed(value) {
  const payload = JSON.stringify(value);
  return [Buffer.from(payload), stripe.webhooks.generateTestHeaderString({ payload, secret })];
}

test("verified paid Stripe session credits the expected wallet", async () => {
  const calls = [];
  await handleStripeWebhook(...signed(event()), (...args) => calls.push(args), stripe);
  assert.deepEqual(calls, [[buyerId, 50000, requestId]]);
});

test("unpaid, invalid and unsigned events never credit a wallet", async () => {
  let calls = 0;
  const credit = () => { calls++; };
  await handleStripeWebhook(...signed(event({ payment_status: "unpaid" })), credit, stripe);
  await handleStripeWebhook(...signed(event({ metadata: {} })), credit, stripe);
  await assert.rejects(handleStripeWebhook(...signed(event({ currency: "usd" })), credit, stripe), /không hợp lệ/);
  const [payload] = signed(event());
  await assert.rejects(handleStripeWebhook(payload, "invalid", credit, stripe), /Chữ ký/);
  assert.equal(calls, 0);
});

test("replayed Stripe webhook credits the wallet only once", async () => {
  let balance = 0;
  let entry;
  const client = { async query(sql, params) {
    if (sql.startsWith("SELECT balance_vnd")) return { rows: [{ balance_vnd: balance }] };
    if (sql.startsWith("SELECT amount_vnd")) return { rows: entry ? [entry] : [] };
    if (sql.startsWith("UPDATE public.wallets")) balance = params[1];
    if (sql.includes("INSERT INTO public.wallet_entries")) {
      const [, kind, amount_vnd, balance_after_vnd, , actor_id] = params;
      entry = { kind, amount_vnd, balance_after_vnd, actor_id };
    }
    return { rows: [] };
  } };
  const credit = (id, amount, request) => topUpWallet(client, id, amount, request);
  await handleStripeWebhook(...signed(event()), credit, stripe);
  await handleStripeWebhook(...signed(event()), credit, stripe);
  assert.equal(balance, 50000);
});
