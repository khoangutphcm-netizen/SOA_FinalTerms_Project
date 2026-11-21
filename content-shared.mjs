import { commerce } from "./commerce-client.mjs";
import { constants } from "node:fs";
import { access, stat, unlink } from "node:fs/promises";
import { connect } from "./demo-accounts.mjs";

export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const localKey = /^local-demo\/([0-9a-f-]{36}\.(?:jpg|jpeg|png|mp4))$/i;
export const mediaUrl = (id) => "/api/demo/media/" + id;
export const uploads = new URL("./.pck-demo/uploads/", import.meta.url);
export const postFields =
  "p.id, p.author_id, p.title, p.description, p.price_vnd, p.auto_cycle, p.status, p.withdrawn_at, p.moderation_state, p.published_at, p.view_count, p.created_at";

export async function withDb(name, work) {
  const client = connect(name);
  client.on("error", () => {});
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export function query(name, sql, params = []) {
  return withDb(name, async (client) => (await client.query(sql, params)).rows);
}

export function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

export async function removeLocalAssets(keys) {
  await Promise.all(
    keys.map(async (key) => {
      const file = key?.match(localKey)?.[1];
      if (file) {
        await Promise.all([file, file + ".thumb-v1.jpg"].map(name =>
          unlink(new URL(name, uploads)).catch(() => {}),
        ));
      }
    }),
  );
}

export async function hasEntitlement(postId, caller) {
  if (!caller) return false;
  return (
    await commerce(
      "/entitlement?" + new URLSearchParams({ buyerId: caller.id, postId }),
    )
  ).allowed;
}

export async function postById(id, caller, publishedOnly = false) {
  const [post] = await query(
    "CONTENT",
    `SELECT ${postFields} FROM public.posts p WHERE id=$1`,
    [id],
  );
  if (post?.moderation_state === "TAKEN_DOWN")
    throw problem(403, "Tác phẩm đã bị gỡ do kiểm duyệt.");
  const retainedAccess =
    post?.withdrawn_at || post?.moderation_state === "TEMP_HIDDEN";
  const allowed =
    post &&
    (post.status === "PUBLISHED" ||
      (!publishedOnly &&
        (post.status === "DRAFT" || retainedAccess) &&
        post.author_id === caller?.id) ||
      (!publishedOnly && caller?.role === "ADMIN"));
  if (
    !allowed &&
    !(
      retainedAccess &&
      !publishedOnly &&
      (await hasEntitlement(post.id, caller))
    )
  ) {
    throw problem(404, "Không tìm thấy tác phẩm.");
  }
  return post;
}

export async function hasFull(post, caller) {
  if (post.author_id === caller?.id) return true;
  if (!Number(post.price_vnd)) return true;
  return hasEntitlement(post.id, caller);
}

export async function localAssetAvailable(key) {
  const name = key?.match(localKey)?.[1];
  if (!name) return false;
  const file = new URL(name, uploads);
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function postMedia(post, caller) {
  const rows = await query(
    "CONTENT",
    `SELECT a.id, a.filename, a.original_key, a.preview_key, a.purpose, f.mime_type, f.kind
    FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
    WHERE a.post_id=$1 AND a.status='READY' ORDER BY a.position`,
    [post.id],
  );
  const full = await hasFull(post, caller);
  return Promise.all(
    rows.map(
      async ({
        id,
        filename,
        original_key,
        preview_key,
        purpose,
        mime_type,
        kind,
      }) => {
        const locked = !full && purpose !== "PROMO";
        const premium = Number(post.price_vnd) > 0 && purpose === "FULL";
        const [originalAvailable, previewAvailable] = await Promise.all([
          localAssetAvailable(original_key),
          (locked || (premium && kind === "VIDEO")) && localAssetAvailable(preview_key),
        ]);
        const previewSource = previewAvailable ? "/api/demo/preview/" + id : null;
        return {
          id,
          filename,
          purpose,
          mime_type,
          kind,
          premium,
          locked,
          originalAvailable,
          previewUrl: locked ? previewSource : null,
          clipUrl: kind === "VIDEO" ? previewSource : null,
          url: originalAvailable && !locked ? mediaUrl(id) : null,
        };
      },
    ),
  );
}

export const coverColumns = `(
  SELECT a.id FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
  WHERE a.post_id=p.id AND a.status='READY' AND (p.price_vnd=0 OR a.purpose='PROMO')
    AND f.kind IN ('IMAGE','VIDEO') AND a.original_key LIKE 'local-demo/%'
  ORDER BY a.position LIMIT 1
) AS cover_id, ARRAY(
  SELECT DISTINCT f.kind FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
  WHERE a.post_id=p.id AND a.status='READY'
) AS kinds, ARRAY(
  SELECT g.name FROM public.post_genres pg JOIN public.genres g ON g.id=pg.genre_id WHERE pg.post_id=p.id ORDER BY g.name
) AS genres`;

export function withCoverKind(sql) {
  return `SELECT entries.*, f.kind AS cover_kind FROM (${sql}) entries
    LEFT JOIN public.assets a ON a.id=entries.cover_id
    LEFT JOIN public.asset_formats f ON f.id=a.format_id`;
}
