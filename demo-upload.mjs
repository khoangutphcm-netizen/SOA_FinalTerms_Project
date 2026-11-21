import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { connect } from "./demo-accounts.mjs";
import { callService } from "./internal-services.mjs";
import { makePreview } from "./media-preview.mjs";
import {
  handleCatalog,
  problem,
  removeLocalAssets,
  setPostGenre,
} from "./demo-catalog.mjs";

const sessions = new Map();
const hour = 60 * 60 * 1000;
const maxFile = 10 * 1024 * 1024;
const maxTotal = 40 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const signatures = {
  jpg: [
    "image/jpeg",
    (b) => b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255,
  ],
  png: [
    "image/png",
    (b) => b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
  ],
  mp4: [
    "video/mp4",
    (b) => b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp",
  ],
};
signatures.jpeg = signatures.jpg;

async function body(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function saveUpload(
  userId,
  { title, description, genreId, price, autoCycle, files, draftId, revision },
) {
  const client = connect("CONTENT");
  const directory = new URL("./.pck-demo/uploads/", import.meta.url);
  const written = [];
  let committing = false;
  try {
    await client.connect();
    await client.query("BEGIN");
    let post;
    const removed = [];
    const byId = new Map();
    if (draftId) {
      const {
        rows: [draft],
      } = await client.query(
        "SELECT id,status,xmin::text AS revision FROM public.posts WHERE id=$1 AND author_id=$2 FOR UPDATE",
        [draftId, userId],
      );
      if (!draft) throw problem(404, "Không tìm thấy bài của bạn.");
      if (draft.status !== "DRAFT" || draft.revision !== revision)
        throw problem(409, "Bản nháp đã thay đổi. Tải lại form trước khi lưu.");
      post = draft;
      const retained = files.filter((file) => file.id).map((file) => file.id);
      const { rows: existing } = await client.query(
        `
        SELECT a.id,a.size_bytes,a.original_key,a.preview_key,a.preview_start_seconds,f.kind FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
        WHERE a.post_id=$1 AND a.id=ANY($2::uuid[]) AND a.status='READY'`,
        [draftId, retained],
      );
      if (existing.length !== retained.length)
        throw problem(400, "Một tệp giữ lại không thuộc bản nháp này.");
      for (const file of existing) byId.set(file.id, file);
      const size = files.reduce(
        (total, file) =>
          total +
          (file.id ? Number(byId.get(file.id).size_bytes) : file.bytes.length),
        0,
      );
      if (size > maxTotal) throw problem(413, "Tổng dung lượng tối đa 40 MiB.");
      await client.query("SET CONSTRAINTS ALL DEFERRED");
      const result = await client.query(
        "DELETE FROM public.assets WHERE post_id=$1 AND NOT (id=ANY($2::uuid[])) RETURNING original_key,preview_key",
        [draftId, retained],
      );
      removed.push(
        ...result.rows.flatMap((row) => [row.original_key, row.preview_key]),
      );
    }
    const { rows: formats } = await client.query(
      "SELECT id,extension,mime_type FROM public.asset_formats WHERE enabled",
    );
    const formatIds = new Map(
      formats.map((f) => [f.extension + " " + f.mime_type, f.id]),
    );
    if (files.some((f) => !f.id && !formatIds.has(f.extension + " " + f.mime)))
      return null;
    await mkdir(directory, { recursive: true });
    if (draftId) {
      await client.query(
        "UPDATE public.posts SET title=$2,description=$3,price_vnd=$4,auto_cycle=$5 WHERE id=$1",
        [draftId, title, description, price, autoCycle],
      );
    } else {
      const {
        rows: [created],
      } = await client.query(
        "INSERT INTO public.posts (author_id,title,description,price_vnd,auto_cycle) VALUES ($1,$2,$3,$4,$5) RETURNING id,status",
        [userId, title, description, price, autoCycle],
      );
      post = created;
    }
    await setPostGenre(client, post.id, genreId);
    const assetIds = [];
    for (const [index, file] of files.entries()) {
      const purpose = price > 0 && !file.premium ? "PROMO" : "FULL";
      const existing = byId.get(file.id);
      const video = existing
        ? existing.kind === "VIDEO"
        : file.extension === "mp4";
      const start = video && file.premium ? file.previewStart : 0;
      let original = existing?.original_key;
      if (!existing) {
        const key = randomUUID() + "." + file.extension;
        const path = new URL(key, directory);
        await writeFile(path, file.bytes, { flag: "wx" });
        written.push(path);
        original = "local-demo/" + key;
      }
      const preview = file.premium
        ? existing?.preview_key && existing.preview_start_seconds === start
          ? existing.preview_key
          : await makePreview(original, video, start, written)
        : null;
      if (existing?.preview_key && existing.preview_key !== preview)
        removed.push(existing.preview_key);
      if (file.id) {
        await client.query(
          "UPDATE public.assets SET position=$2,purpose=$3,preview_key=$4,preview_start_seconds=$5 WHERE id=$1",
          [file.id, index + 1, purpose, preview, start],
        );
        assetIds.push(file.id);
        continue;
      }
      const {
        rows: [asset],
      } = await client.query(
        `
        INSERT INTO public.assets (post_id,format_id,original_key,filename,size_bytes,position,purpose,preview_key,preview_start_seconds,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'READY') RETURNING id`,
        [
          post.id,
          formatIds.get(file.extension + " " + file.mime),
          original,
          file.name,
          file.bytes.length,
          index + 1,
          purpose,
          preview,
          start,
        ],
      );
      assetIds.push(asset.id);
    }
    committing = true;
    await client.query("COMMIT");
    await removeLocalAssets(removed);
    return {
      postId: post.id,
      assetId: assetIds[0],
      assetIds,
      status: post.status,
    };
  } catch (error) {
    if (!committing)
      await Promise.all(written.map((path) => unlink(path).catch(() => {})));
    throw error;
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function readJson(req) {
  const bytes = await body(req, 16384);
  try {
    if (bytes) return JSON.parse(bytes.toString("utf8"));
  } catch {}
  return null;
}

export async function handleDemo(req, res, path, send) {
  const media =
    /^\/api\/demo\/(media|preview)\//.test(path) && req.method === "GET";
  if (!media && req.headers["x-pck-demo"] !== "1")
    return send(res, 403, { message: "Yêu cầu không hợp lệ." });
  const cookieName = "pck_demo";
  const cookieSettings =
    "; Path=/api/demo; HttpOnly; SameSite=Strict;" +
    (process.env.PCK_SECURE_COOKIE === "1" ? " Secure;" : "") +
    " Max-Age=";
  const token = (req.headers.cookie || "").match(
    /(?:^|;\s*)pck_demo=([\w-]+)/,
  )?.[1];
  const session = sessions.get(token);
  const active = session && session.expires > Date.now() ? session : null;
  const draftId = path.startsWith("/api/demo/edit-draft/")
    ? path.split("/").at(-1)
    : null;
  if (draftId && !uuid.test(draftId))
    return send(res, 404, { message: "Không tìm thấy bản nháp." });
  const method = draftId
    ? "PUT"
    : {
        "/api/demo/session": "GET",
        "/api/demo/posts": "GET",
        "/api/demo/login": "POST",
        "/api/demo/register": "POST",
        "/api/demo/verify": "POST",
        "/api/demo/resend": "POST",
        "/api/demo/logout": "POST",
        "/api/demo/upload": "POST",
      }[path];
  if (!method) return handleCatalog(req, res, path, send, active, readJson);
  if (req.method !== method)
    return send(res, 405, { message: "Phương thức không hợp lệ." });
  try {
    if (path === "/api/demo/session") {
      return send(res, 200, {
        user: active ? { alias: active.alias, role: active.role } : null,
      });
    }
    if (path === "/api/demo/logout") {
      sessions.delete(token);
      res.setHeader("Set-Cookie", cookieName + "=" + cookieSettings + "0");
      return send(res, 200, { user: null });
    }
    if (
      [
        "/api/demo/login",
        "/api/demo/register",
        "/api/demo/verify",
        "/api/demo/resend",
      ].includes(path)
    ) {
      const bytes = await body(req, 4096);
      if (!bytes) return send(res, 413, { message: "Yêu cầu quá lớn." });
      let login;
      try {
        login = JSON.parse(bytes.toString("utf8"));
      } catch {}
      const operation = path.split("/").at(-1);
      const user = await callService("IDENTITY", operation, login ?? {}, {
        timeoutMs:
          operation === "register" || operation === "resend" ? 60000 : 25000,
      });
      if (operation !== "login") return send(res, 200, user);
      if (!user)
        return send(res, 401, {
          message: "Tài khoản hoặc mật khẩu không đúng.",
        });
      for (const [key, session] of sessions)
        if (session.expires <= Date.now()) sessions.delete(key);
      sessions.delete(token);
      const newToken = randomBytes(32).toString("base64url");
      sessions.set(newToken, {
        id: user.id,
        alias: user.alias,
        role: user.role,
        expires: Date.now() + hour,
      });
      res.setHeader(
        "Set-Cookie",
        cookieName + "=" + newToken + cookieSettings + "3600",
      );
      return send(res, 200, { role: user.role, alias: user.alias });
    }
    if (!active)
      return send(res, 401, { message: "Hãy đăng nhập bằng tài khoản demo." });
    if (path === "/api/demo/posts") {
      const keyword = (new URL(req.url,"http://localhost").searchParams.get("q") || "").trim().slice(0,100);
      const client = connect("CONTENT");
      try {
        await client.connect();
        const { rows } = await client.query(
          `
          SELECT p.id,p.title,p.status,p.withdrawn_at,p.moderation_state,
            cover.id AS cover_id,cover.kind AS cover_kind
          FROM public.posts p
          LEFT JOIN LATERAL (
            SELECT a.id,f.kind FROM public.assets a
            JOIN public.asset_formats f ON f.id=a.format_id
            WHERE a.post_id=p.id AND a.status='READY' AND f.kind IN ('IMAGE','VIDEO')
              AND a.original_key LIKE 'local-demo/%'
              AND p.moderation_state<>'TAKEN_DOWN'
              AND (p.status IN ('DRAFT','PUBLISHED') OR p.withdrawn_at IS NOT NULL OR p.moderation_state='TEMP_HIDDEN')
            ORDER BY a.position LIMIT 1
          ) cover ON true
          WHERE p.author_id=$1
            AND ($2='' OR strpos(lower(p.title),lower($2))>0 OR strpos(lower(p.description),lower($2))>0)
          ORDER BY p.created_at DESC,p.id LIMIT 50`,
          [active.id,keyword],
        );
        return send(res, 200, { posts: rows });
      } finally {
        await client.end().catch(() => {});
      }
    }
    if (path !== "/api/demo/upload" && !draftId)
      return send(res, 404, { message: "Không tìm thấy API." });
    if (
      !(req.headers["content-type"] || "").startsWith("multipart/form-data;")
    ) {
      return send(res, 415, { message: "Dùng form tải tệp." });
    }
    const bytes = await body(req, maxTotal + 65536);
    if (!bytes)
      return send(res, 413, { message: "Tổng dung lượng tối đa 40 MiB." });
    let form;
    try {
      form = await new Response(bytes, {
        headers: { "Content-Type": req.headers["content-type"] },
      }).formData();
    } catch {
      return send(res, 400, { message: "Form tải tệp không hợp lệ." });
    }
    const title = form.get("title")?.toString().trim();
    const description = form.get("description")?.toString().trim() || "";
    const genreId = form.get("genre")?.toString() || "";
    const uploads = form.getAll("file");
    let entries = uploads.map((_, upload) => ({ upload }));
    if (draftId) {
      try {
        entries = JSON.parse(form.get("entries"));
      } catch {
        entries = null;
      }
      const valid =
        Array.isArray(entries) &&
        entries.length <= 8 &&
        entries.every(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            ((typeof entry.id === "string" &&
              uuid.test(entry.id) &&
              entry.upload === undefined) ||
              (Number.isInteger(entry.upload) &&
                Boolean(uploads[entry.upload]) &&
                entry.id === undefined)),
        );
      if (
        !valid ||
        new Set(entries.map((entry) => entry.id || entry.upload)).size !==
          entries.length ||
        entries.filter((entry) => !entry.id).length !== uploads.length
      ) {
        return send(res, 400, {
          message: "Danh sách tệp chỉnh sửa không hợp lệ.",
        });
      }
    }
    const cover = Number(form.get("cover") ?? 0);
    const price = Number(form.get("price") ?? 0);
    const marked = form.getAll("premiumIndex");
    const premiumIndexes = new Set(marked.map(Number));
    if (
      !title ||
      title.length > 100 ||
      !entries.length ||
      entries.length > 8 ||
      uploads.some((file) => !(file instanceof File) || !file.size) ||
      !Number.isInteger(cover) ||
      !entries[cover] ||
      !Number.isInteger(price) ||
      price < 0 ||
      price > 100000000
    ) {
      return send(res, 400, {
        message: "Kiểm tra tiêu đề, 1–8 tệp, ảnh đại diện và giá.",
      });
    }
    if (
      uploads.some((file) => file.size > maxFile) ||
      uploads.reduce((sum, file) => sum + file.size, 0) > maxTotal
    ) {
      return send(res, 413, {
        message: "Tối đa 10 MiB mỗi tệp và 40 MiB cho cả bài.",
      });
    }
    if (
      marked.some(
        (index) =>
          typeof index !== "string" ||
          !/^\d+$/.test(index) ||
          !entries[Number(index)],
      ) ||
      premiumIndexes.size !== marked.length
    ) {
      return send(res, 400, { message: "Danh sách tệp Premium không hợp lệ." });
    }
    if (premiumIndexes.has(cover)) {
      return send(res, 400, {
        message:
          "Tệp đại diện phải công khai. Chọn tệp khác làm đại diện trước khi khóa tệp này.",
      });
    }
    if (premiumIndexes.size && !price)
      return send(res, 400, {
        message: "Nhập giá mua một lần cho các tệp Premium.",
      });
    if (price && !premiumIndexes.size)
      return send(res, 400, {
        message: "Chọn ít nhất một tệp Premium trước khi đặt giá.",
      });
    if (
      description.length > 1000 ||
      (genreId &&
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(genreId))
    ) {
      return send(res, 400, { message: "Mô tả hoặc thể loại không hợp lệ." });
    }
    const files = [];
    const order = [...entries.keys()].filter((index) => index !== cover);
    order.unshift(cover);
    for (const index of order) {
      const entry = entries[index];
      const premium = premiumIndexes.has(index);
      const rawStart = form.get("previewStart:" + index) ?? "0";
      const previewStart = Number(rawStart);
      if (
        typeof rawStart !== "string" ||
        !/^\d+$/.test(rawStart) ||
        previewStart > 86400
      ) {
        return send(res, 400, {
          message: "Giây bắt đầu preview phải là số nguyên từ 0 đến 86400.",
        });
      }
      if (entry.id) {
        files.push({ id: entry.id, premium, previewStart });
        continue;
      }
      const file = uploads[entry.upload];
      const extension = file.name.split(".").pop().toLowerCase();
      const bytes = Buffer.from(await file.arrayBuffer());
      const format =
        Object.hasOwn(signatures, extension) && signatures[extension];
      if (!format || !format[1](bytes))
        return send(res, 415, {
          message: "Chỉ nhận JPG, PNG hoặc MP4 hợp lệ.",
        });
      files.push({
        extension,
        mime: format[0],
        name: file.name.slice(0, 180),
        bytes,
        premium,
        previewStart,
      });
    }
    const result = await saveUpload(active.id, {
      title,
      description,
      genreId,
      price,
      autoCycle: form.get("autoCycle") === "on",
      files,
      draftId,
      revision: form.get("revision"),
    });
    return result
      ? send(res, draftId ? 200 : 201, result)
      : send(res, 415, {
          message: "Định dạng hoặc thể loại chưa được bật trong Content DB.",
        });
  } catch (error) {
    return send(res, error.status || 503, {
      message: error.status
        ? error.message
        : "Không xử lý được yêu cầu. Kiểm tra DB và cấu hình demo.",
    });
  }
}
