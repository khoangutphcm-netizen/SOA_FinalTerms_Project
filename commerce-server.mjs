import { createServer } from "node:http";
import { bindHost, servicePort } from "./service-network.mjs";
import { connect } from "./demo-accounts.mjs";
import {
  changeWallet, creditSeller, debitWallet, lockPurchaseWallets,
  topUpLimits, topUpAmountMessage, validTopUpAmount, topUpWallet, walletSummary,
} from "./commerce-wallet.mjs";
import { createCheckout, handleStripeWebhook } from "./commerce-stripe.mjs";

const token = process.env.PCK_INTERNAL_TOKEN;
if (!token) throw new Error("PCK_INTERNAL_TOKEN is required");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const problem = (status, message) =>
  Object.assign(new Error(message), { status });

async function withCommerceDb(work) {
  const client = connect("COMMERCE");
  client.on("error", () => {});
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function rows(sql, params) {
  return withCommerceDb(
    async (client) => (await client.query(sql, params)).rows,
  );
}

function paidSales(postIds = null) {
  return rows(
    `SELECT post_id,count(*)::int AS "paidCount",sum(amount_vnd)::text AS "revenueVnd"
     FROM public.orders WHERE status='PAID'
     ${postIds ? "AND post_id=ANY($1::uuid[])" : ""}
     GROUP BY post_id`,
    postIds ? [postIds] : [],
  );
}

async function readRawBody(req, limit = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw problem(413, "Yêu cầu quá lớn.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const body = await readRawBody(req);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw problem(400, "JSON không hợp lệ.");
  }
}

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function recordTestPurchase(id, caller, expectedPrice, post) {
  if (post.author_id === caller.id || Number(post.price_vnd) <= 0) {
    throw problem(409, "Chỉ có thể mua thử tác phẩm Premium của người khác.");
  }
  return withCommerceDb(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [caller.id, id],
      );
      const {
        rows: [existing],
      } = await client.query(
        `
        SELECT o.id,o.status FROM public.entitlements e JOIN public.orders o ON o.id=e.source_order_id
        WHERE e.buyer_id=$1 AND e.post_id=$2`,
        [caller.id, id],
      );
      if (existing) {
        await client.query("COMMIT");
        return { ...existing, reused: true };
      }
      if (expectedPrice !== Number(post.price_vnd))
        throw problem(409, "Giá đã thay đổi. Hãy tải lại tác phẩm để xác nhận.");
      await lockPurchaseWallets(client, caller.id, post.author_id);
      const balanceVnd = await debitWallet(client, caller.id, expectedPrice);
      const sellerBalanceVnd = await creditSeller(client, post.author_id, expectedPrice);
      const {
        rows: [order],
      } = await client.query(
        `
        INSERT INTO public.orders (buyer_id,post_id,amount_vnd,seller_id,provider,expires_at)
        VALUES ($1,$2,$3,$4,'PCK_WALLET_TEST',now()+interval '15 minutes')
        ON CONFLICT (buyer_id,post_id) WHERE status='PENDING' DO NOTHING RETURNING id`,
        [caller.id, id, post.price_vnd, post.author_id],
      );
      if (!order) throw problem(409, "Đã có một đơn đang chờ cho tác phẩm này.");
      await client.query(
        `
        INSERT INTO public.payment_events (order_id,provider,event_key,payload)
        VALUES ($1,'PCK_WALLET_TEST',$2,'{"mode":"demo_wallet","result":"success"}'::jsonb)`,
        [order.id, "pck-wallet:" + order.id],
      );
      await client.query(
        "UPDATE public.orders SET status='PAID',paid_at=now(),provider_transaction_id=$2 WHERE id=$1",
        [order.id, "pck-wallet:" + order.id],
      );
      await client.query(
        `INSERT INTO public.wallet_entries (user_id,kind,amount_vnd,balance_after_vnd,order_id,post_id)
         VALUES ($1,'PURCHASE',-$2::bigint,$3,$4,$5)`,
        [caller.id, expectedPrice, balanceVnd, order.id, id],
      );
      await client.query(
        `INSERT INTO public.wallet_entries (user_id,kind,amount_vnd,balance_after_vnd,sale_order_id,post_id)
         VALUES ($1,'SALE_EARNING',$2,$3,$4,$5)`,
        [post.author_id, expectedPrice, sellerBalanceVnd, order.id, id],
      );
      await client.query(
        "INSERT INTO public.entitlements (buyer_id,post_id,source_order_id) VALUES ($1,$2,$3)",
        [caller.id, id, order.id],
      );
      await client.query("COMMIT");
      return { id: order.id, status: "PAID", reused: false, balanceVnd };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + token)
    return send(res, 403, { message: "Yêu cầu nội bộ." });
  try {
    const { pathname, searchParams } = new URL(req.url, "http://localhost");
    if (req.method === "POST" && pathname === "/stripe/webhook") {
      const payload = await readRawBody(req, 65536);
      await handleStripeWebhook(payload, req.headers["stripe-signature"], (buyerId, amount, requestId) =>
        withCommerceDb((client) => topUpWallet(client, buyerId, amount, requestId)));
      return send(res, 200, { received: true });
    }
    if (req.method === "POST" && pathname === "/wallet/stripe-checkout")
      return send(res, 200, await createCheckout(await readBody(req)));
    if (req.method === "GET") {
      if (pathname === "/health") {
        await rows("SELECT 1");
        return send(res, 200, {
          status: "ok",
          message: "Commerce đã kết nối PostgreSQL.",
        });
      }
      if (pathname === "/paid-count") {
        const [result] = await rows(
          "SELECT count(*)::int AS count FROM public.orders WHERE status='PAID'",
        );
        return send(res, 200, result);
      }
      if (pathname === "/admin/sales") {
        return send(res, 200, await paidSales());
      }
      const buyerId = searchParams.get("buyerId");
      const postId = searchParams.get("postId");
      if (pathname === "/wallet" && uuid.test(buyerId)) {
        const wallet = await withCommerceDb((client) =>
          walletSummary(client, buyerId, searchParams.get("history") !== "0"),
        );
        return send(res, 200, { ...wallet, topUpLimits });
      }
      if (pathname === "/purchases" && uuid.test(buyerId)) {
        return send(
          res,
          200,
          await rows(
            `SELECT e.post_id,o.id AS order_id,o.amount_vnd,COALESCE(o.paid_at,e.granted_at) AS purchased_at
              FROM public.entitlements e JOIN public.orders o ON o.id=e.source_order_id
              WHERE e.buyer_id=$1 ORDER BY purchased_at DESC,e.post_id`,
            [buyerId],
          ),
        );
      }
      if (
        pathname === "/entitlement" &&
        uuid.test(buyerId) &&
        uuid.test(postId)
      ) {
        const rights = await rows(
          "SELECT 1 FROM public.entitlements WHERE buyer_id=$1 AND post_id=$2",
          [buyerId, postId],
        );
        return send(res, 200, { allowed: rights.length > 0 });
      }
    }
    if (req.method === "POST" && pathname === "/sales/by-post") {
      const { postIds } = (await readBody(req)) ?? {};
      if (!Array.isArray(postIds) || postIds.length > 100 ||
          postIds.some(id => typeof id !== "string" || !uuid.test(id)))
        throw problem(400, "Danh sách tác phẩm không hợp lệ.");
      return send(res, 200, postIds.length ? await paidSales(postIds) : []);
    }
    if (req.method === "POST" && pathname === "/sales/report") {
      const { sellerId, legacyPostIds, includeSeller, from, to } = (await readBody(req)) ?? {};
      const reportDate = (date) => date === null || (typeof date === "string" &&
        /^[1-9]\d{3}-(0[1-9]|1[0-2])-01$/.test(date));
      if (typeof sellerId !== "string" || !uuid.test(sellerId) ||
          !Array.isArray(legacyPostIds) || legacyPostIds.length > 90 ||
          legacyPostIds.some(id => typeof id !== "string" || !uuid.test(id)) ||
          typeof includeSeller !== "boolean" || !reportDate(from) || !reportDate(to))
        throw problem(400, "Kỳ báo cáo hoặc danh sách tác phẩm không hợp lệ.");
      return send(res, 200, await rows(
        `SELECT post_id, count(*)::int AS "paidCount", sum(amount_vnd)::text AS "revenueVnd",
                max(paid_at) AS "lastSoldAt"
         FROM public.orders WHERE status='PAID'
           AND (($2::boolean AND seller_id=$1) OR (seller_id IS NULL AND post_id=ANY($3::uuid[])))
           AND ($4::date IS NULL OR paid_at >= ($4::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
           AND ($5::date IS NULL OR paid_at < ($5::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
         GROUP BY post_id`,
        [sellerId, includeSeller, legacyPostIds, from, to],
      ));
    }
    if (req.method === "POST" && pathname === "/admin/wallet-balances") {
      const { userIds } = (await readBody(req)) ?? {};
      if (!Array.isArray(userIds) || userIds.length > 25 ||
          userIds.some(id => typeof id !== "string" || !uuid.test(id)))
        throw problem(400, "Danh sách tài khoản không hợp lệ.");
      return send(res, 200, await rows(
        'SELECT user_id AS "userId",balance_vnd::int AS "balanceVnd" FROM public.wallets WHERE user_id=ANY($1::uuid[])',
        [userIds],
      ));
    }
    if (req.method === "POST" && pathname === "/admin/wallet-balance") {
      const { buyerId, balance, expectedBalance, requestId, actorId } = (await readBody(req)) ?? {};
      if (![buyerId, requestId, actorId].every(id => typeof id === "string" && uuid.test(id)) ||
          ![balance, expectedBalance].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000))
        throw problem(400, "Nhập số dư demo từ 0 đến 1.000.000.000 ₫.");
      return send(res, 200, await withCommerceDb((client) =>
        changeWallet(client, buyerId.toLowerCase(), balance - expectedBalance, requestId.toLowerCase(), {
          actorId: actorId.toLowerCase(), expectedBalance,
        }),
      ));
    }
    if (req.method === "POST" && pathname === "/wallet/top-up") {
      const { buyerId, amount, requestId } = (await readBody(req)) ?? {};
      if (typeof buyerId !== "string" || !uuid.test(buyerId) ||
          typeof requestId !== "string" || !uuid.test(requestId) || !validTopUpAmount(amount)) {
        throw problem(400, topUpAmountMessage);
      }
      return send(res, 200, await withCommerceDb((client) =>
        topUpWallet(client, buyerId, amount, requestId),
      ));
    }
    if (req.method === "POST" && pathname === "/test-purchase") {
      const { buyerId, postId, price, authorId } = (await readBody(req)) ?? {};
      if (
        ![buyerId, postId, authorId].every(
          (id) => typeof id === "string" && uuid.test(id),
        ) ||
        !Number.isSafeInteger(price) ||
        price <= 0
      )
        throw problem(400, "Đơn không hợp lệ.");
      return send(
        res,
        200,
        await recordTestPurchase(postId.toLowerCase(), { id: buyerId.toLowerCase() }, price, {
          author_id: authorId.toLowerCase(),
          price_vnd: price,
        }),
      );
    }
    send(res, 404, { message: "Không tìm thấy API Commerce." });
  } catch (error) {
    send(res, error.status || 503, {
      message: error.status
        ? error.message
        : "Không truy cập được Commerce DB.",
    });
  }
});

const port = servicePort("COMMERCE");
server.listen(port, bindHost, () =>
  console.log("PCK Commerce: " + port),
);
