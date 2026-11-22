import { commerce } from "./commerce-client.mjs";
import { coverColumns, problem, query, withCoverKind } from "./content-shared.mjs";

const vietnamCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "numeric",
});
const searchText = (value) => value.normalize("NFD").replace(/\p{M}/gu, "")
  .toLocaleLowerCase("vi").replace(/đ/g, "d");

function reportFilters(search) {
  const current = Object.fromEntries(vietnamCalendar.formatToParts().map(({ type, value }) => [type, value]));
  const period = search.get("period") ?? "month";
  const year = Number(search.get("year") ?? current.year);
  const month = Number(search.get("month") ?? current.month);
  const sort = search.get("sort") ?? "revenue-desc";
  if (!["month", "year", "all"].includes(period) ||
      (period !== "all" && (!Number.isInteger(year) || year < 1000 || year > 9998)) ||
      (period === "month" && (!Number.isInteger(month) || month < 1 || month > 12)) ||
      !["revenue-desc", "revenue-asc", "sold", "recent"].includes(sort))
    throw problem(400, "Bộ lọc doanh thu không hợp lệ.");
  return { period, year: period === "all" ? Number(current.year) : year,
    month: period === "month" ? month : Number(current.month), sort };
}

export async function sellerReport(sellerId, search) {
  const filters = reportFilters(search);
  const { period, year, month, sort } = filters;
  const keyword = (search.get("q") ?? "").trim().slice(0, 100);
  const match = searchText(keyword);
  const firstDay = (y, m) => `${y}-${String(m).padStart(2, "0")}-01`;
  const from = period === "all" ? null : firstDay(year, period === "year" ? 1 : month);
  const to = period === "all" ? null : period === "year" || month === 12
    ? firstDay(year + 1, 1) : firstDay(year, month + 1);
  const titles = new Map((await query("CONTENT", "SELECT id,title FROM public.posts WHERE author_id=$1", [sellerId]))
    .map(({ id, title }) => [id, title]));
  const ids = [...titles.keys()];
  const posts = new Map();
  let paidCount = 0;
  let revenueVnd = 0n;
  // Legacy orders are attributed to the original post owner. Only the first request includes new orders.
  for (let start = 0; start < Math.max(1, ids.length); start += 90) {
    const sales = await commerce("/sales/report", {
      sellerId, legacyPostIds: ids.slice(start, start + 90), includeSeller: start === 0, from, to,
    });
    for (const sale of sales) {
      const id = sale.post_id;
      const amount = BigInt(sale.revenueVnd);
      const post = posts.get(id) ?? { id, title: titles.get(id) ?? "Tác phẩm đã bán",
        paidCount: 0, revenueVnd: 0n, lastSoldAt: "" };
      post.paidCount += sale.paidCount;
      post.revenueVnd += amount;
      if (sale.lastSoldAt > post.lastSoldAt) post.lastSoldAt = sale.lastSoldAt;
      posts.set(id, post);
      paidCount += sale.paidCount;
      revenueVnd += amount;
    }
  }
  const revenueOrder = (a, b) => {
    if (a.revenueVnd === b.revenueVnd) return 0;
    return a.revenueVnd > b.revenueVnd ? -1 : 1;
  };
  const sortBy = {
    "revenue-desc": revenueOrder,
    "revenue-asc": (a, b) => revenueOrder(b, a),
    sold: (a, b) => b.paidCount - a.paidCount,
    recent: (a, b) => b.lastSoldAt.localeCompare(a.lastSoldAt),
  };
  const ranked = [...posts.values()].filter(post => searchText(post.title).includes(match))
    .sort((a, b) => sortBy[sort](a, b) || a.id.localeCompare(b.id));
  const pageSize = 25;
  const lastPage = Math.max(1, Math.ceil(ranked.length / pageSize));
  const requestedPage = Number(search.get("page"));
  const page = Number.isSafeInteger(requestedPage) ? Math.min(lastPage, Math.max(1, requestedPage)) : 1;
  const visible = ranked.slice((page - 1) * pageSize, page * pageSize);
  const covers = visible.length ? await query("CONTENT", withCoverKind(`
    SELECT p.id, ${coverColumns} FROM public.posts p
    WHERE p.author_id=$1 AND p.id=ANY($2::uuid[]) AND p.moderation_state<>'TAKEN_DOWN'
      AND (p.status IN ('PUBLISHED','DRAFT') OR p.withdrawn_at IS NOT NULL OR p.moderation_state='TEMP_HIDDEN')
  `), [sellerId, visible.map(post => post.id)]) : [];
  const previews = new Map(covers.map(({ id, cover_id, cover_kind }) => [id, { cover_id, cover_kind }]));
  return {
    ...filters, q: keyword, page, lastPage,
    summary: { paidCount, revenueVnd: String(revenueVnd) },
    posts: visible.map(post => ({ ...post, ...previews.get(post.id),
      canOpen: previews.has(post.id), revenueVnd: String(post.revenueVnd) })),
  };
}

export async function sellerWallet(sellerId) {
  const wallet = await commerce("/wallet?" + new URLSearchParams({ buyerId: sellerId }));
  const saleIds = [...new Set(wallet.history.filter(entry => entry.kind === "SALE_EARNING").map(entry => entry.post_id))];
  if (!saleIds.length) return wallet;
  const posts = await query("CONTENT", "SELECT id,title FROM public.posts WHERE author_id=$1 AND id=ANY($2::uuid[])",
    [sellerId, saleIds]).catch(() => []);
  const titles = new Map(posts.map(({ id, title }) => [id, title]));
  return { ...wallet, history: wallet.history.map(entry => entry.kind === "SALE_EARNING"
    ? { ...entry, post_title: titles.get(entry.post_id) } : entry) };
}
