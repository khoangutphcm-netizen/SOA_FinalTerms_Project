const accountFields = `id,display_name AS alias,email_normalized AS email,role,status,
  created_at AS "createdAt",email_verified_at AS "verifiedAt",avatar_updated_at AS "avatarVersion"`;
const accountStatuses = ["ACTIVE", "PENDING_VERIFICATION", "DISABLED"];
const roles = ["USER", "ADMIN"];
const pageSize = 25;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const problem = (status, message) => Object.assign(new Error(message), { status });

async function requireAdmin(query, actorId) {
  const [actor] = await query(
    "SELECT id FROM public.users WHERE id=$1 AND role='ADMIN' AND status='ACTIVE'", [actorId],
  );
  if (!actor) throw problem(403, "Chỉ quản trị viên đang hoạt động có quyền quản lý tài khoản.");
}

export const accountAdmin = {
  async "admin-wallet-recipient"(query, { actorId, accountId }) {
    await requireAdmin(query, actorId);
    const [recipient] = await query("SELECT id FROM public.users WHERE id=$1 AND status='ACTIVE'", [accountId]);
    if (!recipient) throw problem(409, "Chỉ có thể cộng tiền cho tài khoản đang hoạt động.");
    return recipient;
  },
  async "admin-accounts"(query, { actorId, q, status, role, page }) {
    await requireAdmin(query, actorId);
    const search = typeof q === "string" ? q.trim().toLowerCase().slice(0, 100) : "";
    const currentPage = Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1;
    const rows = await query(
      `SELECT ${accountFields} FROM public.users
       WHERE ($1='' OR strpos(lower(display_name),$1)>0 OR strpos(email_normalized,$1)>0)
        AND ($2='' OR status=$2) AND ($3='' OR role=$3)
       ORDER BY created_at DESC,id
       LIMIT $4 OFFSET $5`,
      [search, accountStatuses.includes(status) ? status : "", roles.includes(role) ? role : "",
        pageSize + 1, (currentPage - 1) * pageSize],
    );
    return { accounts: rows.slice(0, pageSize), page: currentPage, hasNext: rows.length > pageSize };
  },

  async "admin-account-status"(query, { actorId, accountId, disabled }) {
    await requireAdmin(query, actorId);
    if (typeof accountId !== "string" || !uuid.test(accountId) || typeof disabled !== "boolean")
      throw problem(400, "Tài khoản hoặc thao tác không hợp lệ.");
    const [account] = await query(
      `UPDATE public.users
       SET status=CASE WHEN $2 THEN 'DISABLED'
          WHEN email_verified_at IS NULL THEN 'PENDING_VERIFICATION' ELSE 'ACTIVE' END
       WHERE id=$1 AND role='USER' AND status IN ('ACTIVE','DISABLED')
       RETURNING ${accountFields}`,
      [accountId, disabled],
    );
    if (!account) throw problem(409, "Chỉ có thể khóa tài khoản người dùng đã xác minh hoặc mở khóa tài khoản đã khóa.");
    return account;
  },
};
