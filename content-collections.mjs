import {
  uuid,
  withDb,
  query,
  problem,
  withCoverKind,
  postFields,
  coverColumns,
  originalExists,
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

export async function groups(kind, groupId, caller) {
  const [table, items, fk, visibility] = groupKinds[kind];
  const collectionCover =
    kind === "collections"
      ? `, ARRAY(
    SELECT cover.id FROM public.collection_items ci
    JOIN public.posts cp ON cp.id=ci.post_id AND cp.status='PUBLISHED'
    JOIN LATERAL (
      SELECT a.id FROM public.assets a
      JOIN public.asset_formats f ON f.id=a.format_id AND f.kind IN ('IMAGE','VIDEO')
      WHERE a.post_id=cp.id AND a.status='READY' AND (cp.price_vnd=0 OR a.purpose='PROMO')
        AND ${originalExists}
      ORDER BY a.position LIMIT 1
    ) cover ON true
    WHERE ci.collection_id=g.id
    ORDER BY ci.position LIMIT 3
  ) AS cover_ids`
      : "";
  const groupOrder =
    kind === "collections" ? "g.created_at DESC,g.id" : "g.title,g.id";
  if (!groupId) {
    const rows = await query(
      "CONTENT",
      `SELECT g.id,g.title,g.description,count(p.id)::int AS total${collectionCover}
    FROM public.${table} g LEFT JOIN public.${items} i ON i.${fk}=g.id
    LEFT JOIN public.posts p ON p.id=i.post_id AND p.status='PUBLISHED' WHERE ${visibility}
    GROUP BY g.id ORDER BY ${groupOrder} LIMIT 50`,
    );
    return kind === "collections"
      ? rows.map(group => ({ ...group, cover_id: group.cover_ids[0] ?? null }))
      : rows;
  }
  return withDb("CONTENT", async (client) => {
    const {
      rows: [group],
    } = await client.query(
      `SELECT g.id,g.title,g.description${kind === "collections" ? ",g.owner_id" : ""} FROM public.${table} g WHERE g.id=$1 AND ${visibility}`,
      [groupId],
    );
    if (!group) throw problem(404, "Không tìm thấy danh mục.");
    const canEdit = kind === "collections" && group.owner_id === caller?.id;
    const { rows: posts } = await client.query(
      withCoverKind(`SELECT ${postFields}, ${coverColumns}, i.position FROM public.${items} i
      JOIN public.posts p ON p.id=i.post_id AND (p.status='PUBLISHED' OR $2) WHERE i.${fk}=$1`) +
        " ORDER BY position",
      [groupId, canEdit],
    );
    const { owner_id, ...publicGroup } = group;
    return { group: publicGroup, posts, canEdit };
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
    throw problem(400, "Hãy nhập tên và chọn tối đa 25 tác phẩm đã phát hành.");
  return withDb("CONTENT", async (client) => {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query(
        "SELECT id FROM public.posts WHERE status='PUBLISHED' AND id=ANY($1::uuid[]) FOR SHARE",
        [ids],
      );
      if (rows.length !== ids.length)
        throw problem(409, "Một tác phẩm không còn hiển thị.");
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

export async function myCollections(caller, postId) {
  return query("CONTENT", `SELECT c.id,c.title,
    EXISTS (SELECT 1 FROM public.collection_items i WHERE i.collection_id=c.id AND i.post_id=$2::uuid) AS contains_post
    FROM public.collections c WHERE c.owner_id=$1 ORDER BY lower(c.title),c.id`,
    [caller.id, postId || null]);
}

export async function renameCollection(id, caller, input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 80) throw problem(400, "Nhập tên bộ sưu tập tối đa 80 ký tự.");
  const [row] = await query("CONTENT",
    "UPDATE public.collections SET title=$3 WHERE id=$1 AND owner_id=$2 RETURNING id,title",
    [id, caller.id, title]);
  if (!row) throw problem(404, "Không tìm thấy bộ sưu tập của bạn.");
  return row;
}

export async function changeCollectionItem(id, postId, caller, add) {
  return withDb("CONTENT", async (client) => {
    await client.query("BEGIN");
    try {
      const { rowCount } = await client.query(
        "SELECT id FROM public.collections WHERE id=$1 AND owner_id=$2 FOR UPDATE", [id, caller.id],
      );
      if (!rowCount) throw problem(404, "Không tìm thấy bộ sưu tập của bạn.");
      if (add) {
        const { rowCount: available } = await client.query(
          "SELECT id FROM public.posts WHERE id=$1 AND status='PUBLISHED' FOR SHARE", [postId],
        );
        if (!available) throw problem(409, "Tác phẩm hiện không công khai.");
        const { rows: [state] } = await client.query(
          `SELECT count(*)::int AS total, COALESCE(max(position),0) AS last,
             COALESCE(bool_or(post_id=$2),false) AS included
           FROM public.collection_items WHERE collection_id=$1`, [id, postId],
        );
        if (!state.included) {
          if (state.total >= 25) throw problem(409, "Bộ sưu tập đã có 25 tác phẩm.");
          await client.query(
            "INSERT INTO public.collection_items (collection_id,post_id,position) VALUES ($1,$2,$3)",
            [id, postId, state.last + 1],
          );
        }
      } else {
        await client.query(
          "DELETE FROM public.collection_items WHERE collection_id=$1 AND post_id=$2", [id, postId],
        );
      }
      await client.query("COMMIT");
      return { active: add };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}
