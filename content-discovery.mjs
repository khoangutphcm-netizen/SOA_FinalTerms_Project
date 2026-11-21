import { makeThumbnail } from "./media-preview.mjs";
import { byteRange, rangeHeaders } from "./media-range.mjs";
import {
  uuid,
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

export async function sendMedia(req, res, id, caller, preview = false, thumbnail = false) {
  const variant = preview ? "PREVIEW" : "ORIGINAL";
  const [asset] = await query(
    "CONTENT",
    `SELECT a.post_id,a.purpose,f.mime_type,b.object_key,octet_length(b.body) AS size,
      CASE WHEN $3 THEN b.thumbnail END AS thumbnail
    FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
    JOIN public.asset_blobs b ON b.asset_id=a.id AND b.variant=$2
      AND b.object_key=CASE WHEN $2='PREVIEW' THEN a.preview_key ELSE a.original_key END
    WHERE a.id=$1 AND a.status='READY'`,
    [id, variant, thumbnail],
  );
  if (!asset) throw problem(404, "Tệp hiện không khả dụng.");
  const post = await postById(asset.post_id, caller);
  if (preview && (asset.purpose !== "FULL" || Number(post.price_vnd) <= 0))
    throw problem(404, "Không có bản xem trước.");
  if (!preview && asset.purpose !== "PROMO" && !(await hasFull(post, caller)))
    throw problem(403, "Bạn chưa có quyền xem tệp.");
  const mime = preview && asset.mime_type !== "video/mp4" ? "image/jpeg" : asset.mime_type;
  if (!["image/jpeg", "image/png", "video/mp4"].includes(mime))
    throw problem(415, "Tệp không được hỗ trợ.");

  const key = [id, variant, asset.object_key];
  async function load(range) {
    const [blob] = await query("CONTENT",
      `SELECT substring(body FROM $4::int FOR $5::int) AS data
       FROM public.asset_blobs WHERE asset_id=$1 AND variant=$2 AND object_key=$3`,
      [...key, range.first + 1, range.length]);
    if (!blob || blob.data.length !== range.length) throw problem(404, "Tệp hiện không khả dụng.");
    return blob.data;
  }
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (thumbnail) {
    let image = asset.thumbnail;
    if (!image) {
      image = await makeThumbnail(asset.object_key,
        () => load({ first: 0, length: asset.size }), mime === "video/mp4").catch(() => {
        throw problem(404, "Ảnh thu nhỏ chưa khả dụng.");
      });
      await query("CONTENT",
        `UPDATE public.asset_blobs SET thumbnail=$4
          WHERE asset_id=$1 AND variant=$2 AND object_key=$3 AND thumbnail IS NULL`, [...key, image]);
    }
    res.writeHead(200, {
      ...headers, "Content-Type": "image/jpeg", "Content-Length": image.length,
    }).end(image);
    return;
  }
  const range = byteRange(req.headers.range, asset.size);
  const bytes = range ? await load(range) : undefined;
  res.writeHead(range?.status ?? 416, {
    ...headers, ...rangeHeaders(range, asset.size),
    "Content-Type": mime, "Accept-Ranges": "bytes", "Content-Disposition": "inline",
  }).end(bytes);
}
