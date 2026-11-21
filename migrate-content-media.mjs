import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { withDb } from "./content-shared.mjs";

// This one-time importer is the only path that reads the old upload directory.
const oldDirectory = new URL("./.pck-demo/uploads/", import.meta.url);
const oldKey = /^local-demo\/([0-9a-f-]{36}\.(?:jpg|jpeg|png|mp4))$/i;
const schema = await readFile(new URL("./migrations/12_content_asset_blobs.sql", import.meta.url), "utf8");

try {
  const counts = await withDb("CONTENT", async (client) => {
    await client.query(schema);
    const { rows } = await client.query(`
      SELECT a.id,a.size_bytes,v.variant,v.object_key FROM public.assets a
      CROSS JOIN LATERAL (VALUES ('ORIGINAL',a.original_key),('PREVIEW',a.preview_key)) v(variant,object_key)
      WHERE v.object_key IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.asset_blobs b WHERE b.asset_id=a.id AND b.variant=v.variant AND b.object_key=v.object_key
      ) ORDER BY a.id,v.variant`);
    let copied = 0;
    for (const asset of rows) {
      const file = asset.object_key.match(oldKey)?.[1];
      if (!file) continue;
      const bytes = await readFile(new URL(file, oldDirectory)).catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!bytes?.length ||
          (asset.variant === "ORIGINAL" && bytes.length !== Number(asset.size_bytes))) continue;
      const thumbnail = await readFile(new URL(file + ".thumb-v1.jpg", oldDirectory)).catch(error => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      await client.query("BEGIN");
      try {
        const { rows: [stored] } = await client.query(`
          INSERT INTO public.asset_blobs (asset_id,variant,object_key,body,thumbnail)
          SELECT id,$2,$3,$4,$5 FROM public.assets
          WHERE id=$1 AND $3=CASE WHEN $2='ORIGINAL' THEN original_key ELSE preview_key END
          FOR SHARE
          ON CONFLICT (asset_id,variant) DO UPDATE
            SET object_key=excluded.object_key,body=excluded.body,thumbnail=excluded.thumbnail
            WHERE asset_blobs.object_key<>excluded.object_key
          RETURNING encode(sha256(body),'hex') AS hash`,
          [asset.id, asset.variant, asset.object_key, bytes, thumbnail?.length ? thumbnail : null],
        );
        if (stored && stored.hash !== createHash("sha256").update(bytes).digest("hex"))
          throw new Error("Checksum mismatch");
        await client.query("COMMIT");
        if (stored) copied++;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }
    const { rows: audit } = await client.query(`
      SELECT v.variant, count(*)::int AS expected,count(b.asset_id)::int AS stored
      FROM public.assets a
      CROSS JOIN LATERAL (VALUES ('ORIGINAL',a.original_key),('PREVIEW',a.preview_key)) v(variant,object_key)
      LEFT JOIN public.asset_blobs b ON b.asset_id=a.id AND b.variant=v.variant AND b.object_key=v.object_key
      WHERE v.object_key IS NOT NULL GROUP BY v.variant ORDER BY v.variant`);
    return { copied, audit };
  });
  console.log(JSON.stringify(counts));
  if (counts.audit.some(item => item.expected !== item.stored)) {
    console.error("Một số tệp thiếu trên Neon. Chạy lại từ máy còn bản gốc đúng kích thước.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error("Không thể hoàn tất migration Content media (" + (error.code || "file hoặc kết nối") + ").");
  process.exitCode = 1;
}
