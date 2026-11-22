const problem = (status, message) => Object.assign(new Error(message), { status });
export const topUpLimits = { min: 20000, max: 1000000 };
export const topUpAmountMessage = "Nhập số tiền nguyên từ 20.000 đến 1.000.000 ₫.";
export const validTopUpAmount = amount =>
  Number.isSafeInteger(amount) && amount >= topUpLimits.min && amount <= topUpLimits.max;

export async function walletSummary(client, userId, includeHistory) {
  const history = includeHistory ? `, (
    SELECT json_agg(entry ORDER BY created_at DESC,id)
    FROM (
      SELECT id,kind,amount_vnd,balance_after_vnd,post_id,created_at FROM public.wallet_entries
      WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 100
    ) AS entry
  ) AS history` : "";
  const { rows: [wallet] } = await client.query(
    `SELECT balance_vnd${history} FROM public.wallets WHERE user_id=$1`, [userId],
  );
  return { balanceVnd: Number(wallet?.balance_vnd ?? 0), history: wallet?.history ?? [] };
}

export function topUpWallet(client, userId, amount, requestId) {
  return changeWallet(client, userId, amount, requestId);
}

export async function changeWallet(client, userId, amount, requestId, { actorId = null, expectedBalance } = {}) {
  const kind = actorId ? (amount < 0 ? "ADMIN_DEBIT" : "ADMIN_CREDIT") : "TOP_UP";
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO public.wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    const { rows: [wallet] } = await client.query(
      "SELECT balance_vnd FROM public.wallets WHERE user_id=$1 FOR UPDATE", [userId],
    );
    const { rows: [existing] } = await client.query(
      "SELECT amount_vnd, kind, actor_id, balance_after_vnd FROM public.wallet_entries WHERE user_id=$1 AND request_id=$2", [userId, requestId],
    );
    if (existing && (Number(existing.amount_vnd) !== amount || existing.kind !== kind || existing.actor_id !== actorId ||
        (actorId && Number(existing.balance_after_vnd) !== expectedBalance + amount))) {
      throw problem(409, "Mã giao dịch đã được dùng cho một yêu cầu khác.");
    }
    const current = Number(wallet.balance_vnd);
    if (!existing && actorId && current !== expectedBalance)
      throw problem(409, "Số dư đã thay đổi. Hãy kiểm tra số dư mới rồi chỉnh lại.");
    const balanceVnd = current + (existing ? 0 : amount);
    if (!existing && amount !== 0) {
      if (balanceVnd < 0 || balanceVnd > 1000000000) throw problem(409, "Số dư demo phải từ 0 đến 1.000.000.000 ₫.");
      await client.query("UPDATE public.wallets SET balance_vnd=$2 WHERE user_id=$1", [userId, balanceVnd]);
      await client.query(
        `INSERT INTO public.wallet_entries (user_id,kind,amount_vnd,balance_after_vnd,request_id,actor_id)
          VALUES ($1,$2,$3,$4,$5,$6)`, [userId, kind, amount, balanceVnd, requestId, actorId],
      );
    }
    await client.query("COMMIT");
    return { balanceVnd, reused: Boolean(existing) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function debitWallet(client, userId, amount) {
  const { rows: [updated] } = await client.query(
    `UPDATE public.wallets SET balance_vnd=balance_vnd-$2
      WHERE user_id=$1 AND balance_vnd >= $2 RETURNING balance_vnd`, [userId, amount],
  );
  if (updated) return Number(updated.balance_vnd);
  const { balanceVnd } = await walletSummary(client, userId, false);
  const missing = Math.max(0, amount - balanceVnd);
  throw problem(409, missing
    ? `Số dư chưa đủ. Cần nạp thêm ${missing.toLocaleString("vi-VN")} ₫.`
    : "Số dư vừa thay đổi. Hãy xác nhận lại giao dịch.");
}

export async function lockPurchaseWallets(client, buyerId, sellerId) {
  const users = [buyerId, sellerId];
  // A stable order also covers two users buying from one another concurrently.
  await client.query(
    `INSERT INTO public.wallets (user_id) SELECT id FROM unnest($1::uuid[]) AS users(id)
     ORDER BY id ON CONFLICT DO NOTHING`, [users],
  );
  await client.query(
    "SELECT user_id FROM public.wallets WHERE user_id=ANY($1::uuid[]) ORDER BY user_id FOR UPDATE",
    [users],
  );
}

export async function creditSeller(client, sellerId, amount) {
  const { rows: [wallet] } = await client.query(
    `UPDATE public.wallets SET balance_vnd=balance_vnd+$2
     WHERE user_id=$1 AND balance_vnd+$2<=1000000000 RETURNING balance_vnd`,
    [sellerId, amount],
  );
  if (!wallet) throw problem(409, "Ví demo của người bán không thể nhận thêm khoản này do giới hạn số dư.");
  return Number(wallet.balance_vnd);
}
