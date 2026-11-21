import Stripe from "stripe";
import { topUpAmounts } from "./commerce-wallet.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });
const paymentEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key.startsWith("sk_test_"))
    throw problem(503, "Chưa cấu hình Stripe test secret key.");
  return new Stripe(key);
}

export async function createCheckout({ buyerId, amount, requestId }) {
  if (
    !uuid.test(buyerId || "") ||
    !uuid.test(requestId || "") ||
    !topUpAmounts.has(amount)
  )
    throw problem(400, "Chọn một mức nạp hợp lệ.");
  let base;
  try {
    base = new URL(process.env.PCK_PUBLIC_URL || "http://127.0.0.1:3100");
  } catch {
    throw problem(503, "PCK_PUBLIC_URL không hợp lệ.");
  }
  const localHttp = base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname);
  if (!(base.protocol === "https:" || localHttp) || base.username || base.password)
    throw problem(503, "PCK_PUBLIC_URL phải dùng HTTPS hoặc localhost.");
  const root = base.origin;
  const session = await stripeClient().checkout.sessions.create({
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "vnd", unit_amount: amount,
        product_data: { name: "Nạp số dư demo PCK" },
      },
      quantity: 1,
    }],
    metadata: { buyerId, requestId },
    success_url: root + "/#account/wallet?stripe=success",
    cancel_url: root + "/#account/wallet?stripe=cancel",
  }, { idempotencyKey: `wallet-${buyerId}-${requestId}` });
  if (session.livemode || !session.url)
    throw problem(503, "Không tạo được Stripe Checkout test.");
  return { url: session.url };
}

export async function handleStripeWebhook(payload, signature, credit, stripe = stripeClient()) {
  if (!process.env.STRIPE_WEBHOOK_SECRET)
    throw problem(503, "Chưa cấu hình Stripe webhook secret.");
  let event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw problem(400, "Chữ ký Stripe không hợp lệ.");
  }
  if (event.livemode || !paymentEvents.has(event.type)) return;
  const session = event.data.object;
  if (session.livemode || session.mode !== "payment" || session.payment_status !== "paid") return;
  const { buyerId, requestId } = session.metadata || {};
  if (!buyerId && !requestId) return;
  if (
    !uuid.test(buyerId || "") ||
    !uuid.test(requestId || "") ||
    session.currency !== "vnd" ||
    !topUpAmounts.has(session.amount_total)
  )
    throw problem(400, "Giao dịch Stripe không hợp lệ.");
  await credit(buyerId, session.amount_total, requestId);
}
