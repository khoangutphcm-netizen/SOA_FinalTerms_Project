import {
  uuid,
  withDb,
  query,
  problem,
  withCoverKind,
  postFields,
  coverColumns,
} from "./content-shared.mjs";
const groupKinds = {
  collections: ["collections", "collection_items", "collection_id", "true"],
  events: [
    "homepage_events",
    "homepage_event_items",
    "event_id",
    "g.enabled AND (g.starts_at IS NULL OR g.starts_at<=now()) AND (g.ends_at IS NULL OR g.ends_at>now())",
  ],
};

export async function groups(kind, groupId) {
  const [table, items, fk, visibility] = groupKinds[kind];
  const collectionCover =
    kind === "collections"
      ? `, (
    SELECT a.id FROM public.collection_items ci
    JOIN public.posts cp ON cp.id=ci.post_id AND cp.status='PUBLISHED'
    JOIN public.assets a ON a.post_id=cp.id AND a.status='READY'
    JOIN public.asset_formats f ON f.id=a.format_id AND f.kind='IMAGE'
    WHERE ci.collection_id=g.id AND (cp.price_vnd=0 OR a.purpose='PROMO')
      AND a.original_key LIKE 'local-demo/%'
    ORDER BY ci.position,a.position LIMIT 1
  ) AS cover_id`
      : "";
  const groupOrder =
    kind === "collections" ? "g.created_at DESC,g.id" : "g.title,g.id";
  if (!groupId)
    return query(
      "CONTENT",
      `SELECT g.id,g.title,g.description,count(p.id)::int AS total${collectionCover}
    FROM public.${table} g LEFT JOIN public.${items} i ON i.${fk}=g.id
    LEFT JOIN public.posts p ON p.id=i.post_id AND p.status='PUBLISHED' WHERE ${visibility}
    GROUP BY g.id ORDER BY ${groupOrder} LIMIT 50`,
    );
  return withDb("CONTENT", async (client) => {
    const {
      rows: [group],
    } = await client.query(
      `SELECT g.id,g.title,g.description FROM public.${table} g WHERE g.id=$1 AND ${visibility}`,
      [groupId],
    );
    if (!group) throw problem(404, "Không tìm thấy danh mục.");
    const { rows: posts } = await client.query(
      withCoverKind(`SELECT ${postFields}, ${coverColumns}, i.position FROM public.${items} i
      JOIN public.posts p ON p.id=i.post_id AND p.status='PUBLISHED' WHERE i.${fk}=$1`) +
        " ORDER BY position",
      [groupId],
    );
    return { group, posts };
  });
}

export async function createCollection(caller, input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const description =
    typeof input?.description === "string" ? input.description.trim() : "";
  const ids = Array.isArray(input?.posts) ? [...new Set(input.posts)] : [];
  if (
    !title ||
    title.length > 80 ||
    description.length > 240 ||
    !ids.length ||
    ids.length > 25 ||
    ids.some((id) => typeof id !== "string" || !uuid.test(id))
  )
    throw problem(400, "Nhập tên và chọn tối đa 25 bài đã phát hành.");
  return withDb("CONTENT", async (client) => {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query(
        "SELECT id FROM public.posts WHERE status='PUBLISHED' AND id=ANY($1::uuid[]) FOR SHARE",
        [ids],
      );
      if (rows.length !== ids.length)
        throw problem(409, "Một bài đã không còn hiển thị.");
      const {
        rows: [row],
      } = await client.query(
        "INSERT INTO public.collections (owner_id,title,description) VALUES ($1,$2,$3) RETURNING id",
        [caller.id, title, description],
      );
      await client.query(
        "INSERT INTO public.collection_items (collection_id,post_id,position) SELECT $1,v.id,v.pos FROM unnest($2::uuid[]) WITH ORDINALITY v(id,pos)",
        [row.id, ids],
      );
      await client.query("COMMIT");
      return row;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}
