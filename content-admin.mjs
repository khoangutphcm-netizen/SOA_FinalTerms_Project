import { commerce } from "./commerce-client.mjs";
import { callService } from "./internal-services.mjs";
import { uuid, withDb, query, problem, coverColumns, withCoverKind } from "./content-shared.mjs";

const sales = () => commerce("/admin/sales");

export async function adminPosts(requestedPage) {
  const pageSize = 25;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100000 ? requestedPage : 1;
  const [posts, paid] = await Promise.all([
    query("CONTENT", withCoverKind(`
      SELECT p.id,p.title,p.status,p.withdrawn_at,p.moderation_state,p.created_at,${coverColumns}
      FROM public.posts p ORDER BY p.created_at DESC,p.id LIMIT $1 OFFSET $2
    `) + " ORDER BY entries.created_at DESC,entries.id", [pageSize + 1, (page - 1) * pageSize]),
    sales().catch(() => null),
  ]);
  const byPost = new Map(paid?.map(record => [record.post_id,record]));
  return {
    page, hasNext: posts.length > pageSize, salesAvailable: Boolean(paid),
    posts: posts.slice(0, pageSize).map(post => ({
      ...post, paidCount: byPost.get(post.id)?.paidCount ?? 0,
      revenueVnd: byPost.get(post.id)?.revenueVnd ?? "0",
    })),
  };
}

export async function adminAccountMetrics(result) {
  if (!result.accounts.length) return { ...result, metricsAvailable: true };
  const userIds = result.accounts.map(account => account.id);
  const [posts, paid, wallets] = await Promise.all([
    query("CONTENT", "SELECT id, author_id FROM public.posts WHERE author_id=ANY($1::uuid[]) AND published_at IS NOT NULL", [userIds]).catch(() => null),
    sales().catch(() => null),
    commerce("/admin/wallet-balances", { userIds }).catch(() => null),
  ]);
  const byPost = new Map(paid?.map(record => [record.post_id, BigInt(record.revenueVnd)]));
  const byUser = new Map(userIds.map(id => [id, { postCount: 0, revenue: 0n }]));
  for (const post of posts ?? []) {
    const user = byUser.get(post.author_id);
    user.postCount += 1;
    user.revenue += byPost.get(post.id) ?? 0n;
  }
  const balances = new Map(wallets?.map(wallet => [wallet.userId, wallet.balanceVnd]));
  return {
    ...result, metricsAvailable: Boolean(posts && paid && wallets),
    accounts: result.accounts.map(account => ({
      ...account, postCount: posts ? byUser.get(account.id).postCount : null,
      revenueVnd: posts && paid ? byUser.get(account.id).revenue.toString() : null,
      balanceVnd: wallets ? (balances.get(account.id) ?? 0) : null,
    })),
  };
}

export async function adminDashboard() {
  const [posts, paid, reports, genres, events, totals] = await Promise.all([
    query(
      "CONTENT",
      "SELECT id,title,status,withdrawn_at,moderation_state FROM public.posts ORDER BY created_at DESC,id LIMIT 50",
    ),
    sales(),
    callService("COMMUNITY", "reports"),
    query("CONTENT", "SELECT id,name,enabled FROM public.genres ORDER BY name"),
    query(
      "CONTENT",
      `SELECT e.id,e.title,e.description,e.enabled,
      ARRAY(SELECT post_id FROM public.homepage_event_items WHERE event_id=e.id ORDER BY position) AS posts
      FROM public.homepage_events e ORDER BY e.title,e.id`,
    ),
    query(
      "CONTENT",
      `SELECT count(*)::int AS posts,
      count(*) FILTER (WHERE status='PUBLISHED')::int AS published,
      count(*) FILTER (WHERE status='PUBLISHED' AND price_vnd>0)::int AS premium
      FROM public.posts`,
    ),
  ]);
  return {
    posts,
    paid: paid.reduce((total, post) => total + post.paidCount, 0),
    revenueVnd: paid.reduce((total, post) => total + BigInt(post.revenueVnd), 0n).toString(),
    reports,
    genres,
    events,
    totals: totals[0],
  };
}

export async function saveEvent(id, input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const description =
    typeof input?.description === "string" ? input.description.trim() : "";
  const ids = Array.isArray(input?.posts) ? [...new Set(input.posts)] : [];
  if (
    !title ||
    title.length > 80 ||
    description.length > 240 ||
    typeof input?.enabled !== "boolean" ||
    (input.enabled && !ids.length) ||
    ids.length > 25 ||
    ids.some((value) => typeof value !== "string" || !uuid.test(value))
  ) {
    throw problem(
      400,
      "Kiểm tra tên, mô tả và danh sách bài. Sự kiện đang bật cần ít nhất một bài.",
    );
  }
  return withDb("CONTENT", async (client) => {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query(
        "SELECT id FROM public.posts WHERE id=ANY($1::uuid[]) AND status='PUBLISHED' FOR SHARE",
        [ids],
      );
      if (rows.length !== ids.length)
        throw problem(409, "Một bài đã không còn hiển thị.");
      const result = id
        ? await client.query(
            "UPDATE public.homepage_events SET title=$1,description=$2,enabled=$3 WHERE id=$4 RETURNING id",
            [title, description, input.enabled, id],
          )
        : await client.query(
            "INSERT INTO public.homepage_events (title,description,enabled) VALUES ($1,$2,$3) RETURNING id",
            [title, description, input.enabled],
          );
      const eventId = result.rows[0]?.id;
      if (!eventId) throw problem(404, "Không tìm thấy sự kiện.");
      await client.query(
        "DELETE FROM public.homepage_event_items WHERE event_id=$1",
        [eventId],
      );
      if (ids.length)
        await client.query(
          "INSERT INTO public.homepage_event_items (event_id,post_id,position) SELECT $1,v.id,v.pos FROM unnest($2::uuid[]) WITH ORDINALITY v(id,pos)",
          [eventId, ids],
        );
      await client.query("COMMIT");
      return { id: eventId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}
