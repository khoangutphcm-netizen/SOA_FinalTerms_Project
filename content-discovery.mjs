import { readFile } from "node:fs/promises";
import {
  uuid,
  localKey,
  uploads,
  postFields,
  coverColumns,
  query,
  problem,
  postById,
  hasFull,
  withCoverKind,
} from "./content-shared.mjs";

export async function catalog(search) {
  const keyword = (search.get("q") || "").trim().slice(0, 100);
  const kind = search.get("kind");
  const sort = search.get("sort") === "old" ? "ASC" : "DESC";
  const offset = Math.min(
    3000,
    Math.max(0, Number.parseInt(search.get("offset"), 10) || 0),
  );
  const pay = ["free", "premium"].includes(search.get("pay"))
    ? search.get("pay")
    : "";
  const days = ["7", "30", "older"].includes(search.get("days"))
    ? search.get("days")
    : "";
  const include = search
    .getAll("include")
    .filter((id) => uuid.test(id))
    .slice(0, 50);
  const exclude = search
    .getAll("exclude")
    .filter((id) => uuid.test(id))
    .slice(0, 50);
  const kinds =
    kind === "MIXED"
      ? ["IMAGE", "VIDEO"]
      : ["IMAGE", "VIDEO"].includes(kind)
        ? [kind]
        : [];
  const assetKinds = `ARRAY(SELECT DISTINCT f.kind FROM public.assets a
    JOIN public.asset_formats f ON f.id=a.format_id
    WHERE a.post_id=p.id AND a.status='READY' AND f.kind IN ('IMAGE','VIDEO'))`;
  return query(
    "CONTENT",
    withCoverKind(`SELECT ${postFields}, ${coverColumns}
    FROM public.posts p WHERE p.status='PUBLISHED'
    AND ($1='' OR strpos(lower(p.title), lower($1))>0 OR strpos(lower(p.description), lower($1))>0
      OR EXISTS (SELECT 1 FROM public.post_genres pg JOIN public.genres g ON g.id=pg.genre_id
        WHERE pg.post_id=p.id AND strpos(lower(g.name),lower($1))>0))
    AND (cardinality($2::text[])=0 OR (${assetKinds} @> $2::text[] AND ${assetKinds} <@ $2::text[]))
    AND ($4='' OR ($4='free' AND p.price_vnd=0) OR ($4='premium' AND p.price_vnd>0))
    AND ($5='' OR ($5='7' AND p.published_at>=now()-interval '7 days')
      OR ($5='30' AND p.published_at>=now()-interval '30 days') OR ($5='older' AND p.published_at<now()-interval '30 days'))
    AND (cardinality($6::uuid[])=0 OR EXISTS (SELECT 1 FROM public.post_genres WHERE post_id=p.id AND genre_id=ANY($6)))
    AND NOT EXISTS (SELECT 1 FROM public.post_genres WHERE post_id=p.id AND genre_id=ANY($7::uuid[]))
    ORDER BY p.published_at ${sort}, p.id LIMIT 25 OFFSET $3`) +
      ` ORDER BY entries.published_at ${sort}, entries.id`,
    [keyword, kinds, offset, pay, days, include, exclude],
  );
}

export async function sendMedia(req, res, id, caller, preview = false) {
  const [asset] = await query(
    "CONTENT",
    `SELECT a.post_id, a.original_key, a.preview_key, a.purpose, f.mime_type
    FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id WHERE a.id=$1 AND a.status='READY'`,
    [id],
  );
  const key = (preview ? asset?.preview_key : asset?.original_key)?.match(
    localKey,
  )?.[1];
  if (!key) throw problem(404, "Tệp không có trên kho local.");
  const post = await postById(asset.post_id, caller);
  if (preview && (asset.purpose !== "FULL" || Number(post.price_vnd) <= 0))
    throw problem(404, "Không có bản xem trước.");
  if (!preview && asset.purpose !== "PROMO" && !(await hasFull(post, caller)))
    throw problem(403, "Bạn chưa có quyền xem tệp.");
  const mime = preview
    ? key.endsWith(".mp4")
      ? "video/mp4"
      : "image/jpeg"
    : asset.mime_type;
  if (!["image/jpeg", "image/png", "video/mp4"].includes(mime))
    throw problem(415, "Tệp không được hỗ trợ.");
  const bytes = await readFile(new URL(key, uploads)).catch((error) => {
    if (
      ["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(error.code)
    ) {
      throw problem(404, "Tệp hiện không khả dụng.");
    }
    throw error;
  });
  const headers = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
  const requested = req.headers.range;
  if (!requested) {
    res
      .writeHead(200, { ...headers, "Content-Length": bytes.length })
      .end(bytes);
    return;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(requested);
  let first = NaN,
    last = NaN;
  if (range && (range[1] || range[2])) {
    first = range[1]
      ? Number(range[1])
      : Math.max(0, bytes.length - Number(range[2]));
    last =
      range[1] && range[2]
        ? Math.min(Number(range[2]), bytes.length - 1)
        : bytes.length - 1;
  }
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    first > last ||
    first >= bytes.length
  ) {
    res
      .writeHead(416, {
        ...headers,
        "Content-Range": "bytes */" + bytes.length,
      })
      .end();
    return;
  }
  res
    .writeHead(206, {
      ...headers,
      "Content-Length": last - first + 1,
      "Content-Range": `bytes ${first}-${last}/${bytes.length}`,
    })
    .end(bytes.subarray(first, last + 1));
}
