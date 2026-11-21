const problem = (status, message) => Object.assign(new Error(message), { status });
export const topUpAmounts = new Set([50000, 100000, 200000]);

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

export async function topUpWallet(client, userId, amount, requestId) {
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO public.wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    const { rows: [wallet] } = await client.query(
      "SELECT balance_vnd FROM public.wallets WHERE user_id=$1 FOR UPDATE", [userId],
    );
    const { rows: [existing] } = await client.query(
      "SELECT amount_vnd FROM public.wallet_entries WHERE user_id=$1 AND request_id=$2", [userId, requestId],
    );
    if (existing && Number(existing.amount_vnd) !== amount) {
      throw problem(409, "Yêu cầu nạp thử đã được dùng với số tiền khác.");
    }
    const balanceVnd = Number(wallet.balance_vnd) + (existing ? 0 : amount);
    if (!existing) {
      if (balanceVnd > 1000000000) throw problem(409, "Đã đạt giới hạn số dư demo.");
      await client.query("UPDATE public.wallets SET balance_vnd=$2 WHERE user_id=$1", [userId, balanceVnd]);
      await client.query(
        `INSERT INTO public.wallet_entries (user_id,kind,amount_vnd,balance_after_vnd,request_id)
          VALUES ($1,'TOP_UP',$2,$3,$4)`, [userId, amount, balanceVnd, requestId],
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
