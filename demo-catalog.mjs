import { callService } from "./internal-services.mjs";
import { testPurchase } from "./content-purchase.mjs";
import { groups, createCollection, myCollections, renameCollection, changeCollectionItem } from "./content-collections.mjs";
import { adminDashboard, saveEvent } from "./content-admin.mjs";
import { moderatePost } from "./content-moderation.mjs";
import { commerce } from "./commerce-client.mjs";
import { catalog, sendMedia } from "./content-discovery.mjs";
import {
  uuid,
  localKey,
  mediaUrl,
  uploads,
  postFields,
  coverColumns,
  withDb,
  query,
  problem,
  removeLocalAssets,
  hasEntitlement,
  postById,
  hasFull,
  localAssetAvailable,
  postMedia,
  withCoverKind,
} from "./content-shared.mjs";
export {
  withDb,
  query,
  problem,
  removeLocalAssets,
} from "./content-shared.mjs";

async function publish(id, caller) {
  return withDb("CONTENT", async (client) => {
    await client.query("BEGIN");
    try {
      const {
        rows: [post],
      } = await client.query(
        "SELECT status,price_vnd FROM public.posts WHERE id=$1 AND author_id=$2 FOR UPDATE",
        [id, caller.id],
      );
      if (!post) throw problem(404, "Không tìm thấy bài của bạn.");
      if (!["DRAFT", "PUBLISHED"].includes(post.status))
        throw problem(409, "Bài này không thể phát hành.");
      if (post.status === "DRAFT") {
        const { rows } = await client.query(
          "SELECT original_key,purpose FROM public.assets WHERE post_id=$1 AND status='READY'",
          [id],
        );
        if (
          !rows.some((file) => file.purpose === "FULL") ||
          (Number(post.price_vnd) > 0 &&
            !rows.some((file) => file.purpose === "PROMO"))
        ) {
          throw problem(
            409,
            "Bài cần tệp đầy đủ sẵn sàng. Bài Premium còn cần một tệp đại diện công khai.",
          );
        }
        if (
          !(
            await Promise.all(
              rows.map((file) => localAssetAvailable(file.original_key)),
            )
          ).every(Boolean)
        ) {
          throw problem(409, "Một hoặc nhiều tệp gốc hiện không khả dụng.");
        }
        await client.query(
          "UPDATE public.posts SET status='PUBLISHED',published_at=now() WHERE id=$1",
          [id],
        );
      }
      await client.query("COMMIT");
      return { status: "PUBLISHED" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
}

async function community(path, req, caller, id, readJson) {
  const action = path.split("/").at(-1);
  const { method } = req;
  const input = { action, method, id, userId: caller.id };
  if (["like", "save"].includes(action)) {
    if (!["PUT", "DELETE"].includes(method))
      throw problem(405, "Phương thức không hợp lệ.");
    if (method === "PUT") await postById(id, caller, true);
  } else {
    if (method !== "POST") throw problem(405, "Dùng POST.");
    await postById(id, caller, true);
    const body = await readJson(req);
    input.content = typeof body?.text === "string" ? body.text.trim() : "";
    if (!input.content || input.content.length > 1000)
      throw problem(400, "Nhập nội dung từ 1 đến 1000 ký tự.");
  }
  const result = await callService("COMMUNITY", "interact", input);
  if (action === "comments") {
    return { ...result, comment: {
      ...result.comment, author: caller.alias, authorId: caller.id, avatarVersion: caller.avatarVersion,
    } };
  }
  return result;
}

async function detail(id, caller) {
  const post = await postById(id, caller);
  const canManage =
    post.author_id === caller?.id &&
    ["DRAFT", "PUBLISHED"].includes(post.status);
  if (post.status !== "PUBLISHED") {
    return {
      post,
      media: await postMedia(post, caller),
      canManage,
      canPublish: post.status === "DRAFT" && canManage,
      comments: [],
      likes: 0,
      liked: false,
      saved: false,
    };
  }
  const optionalService = { timeoutMs: 3500 };
  const [media, communityData] = await Promise.all([
    postMedia(post, caller),
    callService(
      "COMMUNITY",
      "detail",
      { id, userId: caller?.id || null },
      optionalService,
    ).catch(() => null),
  ]);
  const comments = communityData?.comments ?? [];
  const ids = [
    ...new Set([post.author_id, ...comments.map((c) => c.author_id)]),
  ];
  const users = await callService(
    "IDENTITY",
    "names",
    { ids },
    optionalService,
  ).catch(() => null);
  const profiles = new Map((users ?? []).map((user) => [user.id, user]));
  const author = profiles.get(post.author_id);
  const wallet = caller && media.some((file) => file.locked)
    ? await commerce("/wallet?" + new URLSearchParams({ buyerId:caller.id, history:"0" }), undefined, optionalService).catch(() => null)
    : null;
  return {
    post: { ...post, author: author?.display_name, authorAvatarVersion: author?.avatar_updated_at },
    walletBalance: wallet?.balanceVnd ?? null,
    media,
    canManage,
    communityAvailable: Boolean(communityData),
    identityAvailable: Boolean(users),
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      created_at: c.created_at,
      author: profiles.get(c.author_id)?.display_name,
      authorId: c.author_id,
      avatarVersion: profiles.get(c.author_id)?.avatar_updated_at,
    })),
    ...communityData?.reaction,
  };
}

async function library(kind, caller) {
  const purchased = kind === "purchases";
  const rows =
    kind === "saved"
      ? await callService("COMMUNITY", "saved", { userId: caller.id })
      : await commerce(
          "/purchases?" + new URLSearchParams({ buyerId: caller.id }),
        );
  if (!rows.length) return [];
  const files = purchased ? `, ARRAY(SELECT a.original_key FROM public.assets a
    WHERE a.post_id=p.id AND a.status='READY' AND a.purpose='FULL') AS premium_keys` : "";
  const posts = await query(
    "CONTENT",
    withCoverKind(`SELECT ${postFields}, ${coverColumns}${files} FROM public.posts p
    WHERE p.id=ANY($1::uuid[]) AND ($2 OR p.status='PUBLISHED')`),
    [rows.map((row) => row.post_id), purchased],
  );
  const byId = new Map(posts.map((post) => [post.id, post]));
  const fallback = (row) => ({
        id: row.post_id,
        title: "Tác phẩm không khả dụng",
        status: "HIDDEN",
        unavailable: true,
  });
  if (!purchased) return rows.map((row) => byId.get(row.post_id) || fallback(row));
  return Promise.all(rows.map(async (row) => {
    const { premium_keys: keys = [], ...post } = byId.get(row.post_id) || fallback(row);
    const canOpen = post.moderation_state !== "TAKEN_DOWN" &&
      (post.status === "PUBLISHED" || Boolean(post.withdrawn_at) || post.moderation_state === "TEMP_HIDDEN");
    const ready = canOpen ? (await Promise.all(keys.map(localAssetAvailable))).filter(Boolean).length : 0;
    const downloadState = ready === 0 ? "UNAVAILABLE" : ready < keys.length ? "PARTIAL" : "READY";
    return { ...post, purchase: {
      orderId: row.order_id, purchasedAt: row.purchased_at, amountVnd: row.amount_vnd,
      downloadState, canOpen,
    } };
  }));
}

export async function setPostGenre(client, id, genreId) {
  if (genreId) {
    const {
      rows: [genre],
    } = await client.query(
      "SELECT enabled FROM public.genres WHERE id=$1 FOR SHARE",
      [genreId],
    );
    if (!genre) throw problem(400, "Không tìm thấy thể loại.");
    const { rows: assigned } = await client.query(
      "SELECT 1 FROM public.post_genres WHERE post_id=$1 AND genre_id=$2",
      [id, genreId],
    );
    if (assigned.length) return;
    if (!genre.enabled) throw problem(400, "Thể loại này đã tạm dừng.");
  }
  await client.query("DELETE FROM public.post_genres WHERE post_id=$1", [id]);
  if (genreId)
    await client.query(
      "INSERT INTO public.post_genres (post_id,genre_id) VALUES ($1,$2)",
      [id, genreId],
    );
}

async function managePost(id, caller, method, input) {
  const result = await withDb("CONTENT", async (client) => {
    await client.query("BEGIN");
    try {
      const {
        rows: [post],
      } = await client.query(
        `SELECT ${postFields},p.xmin::text AS revision FROM public.posts p
        WHERE p.id=$1 AND p.author_id=$2 ${method === "GET" ? "FOR SHARE" : "FOR UPDATE"}`,
        [id, caller.id],
      );
      if (!post) throw problem(404, "Không tìm thấy bài của bạn.");
      if (method === "DELETE") {
        if (post.withdrawn_at) {
          await client.query("COMMIT");
          return { status: "WITHDRAWN" };
        }
        if (input?.status && input.status !== post.status)
          throw problem(
            409,
            "Trạng thái bài đã đổi. Tải lại trước khi xóa hoặc gỡ.",
          );
        if (post.status === "DRAFT") {
          const { rows } = await client.query(
            "DELETE FROM public.assets WHERE post_id=$1 RETURNING original_key,preview_key",
            [id],
          );
          await client.query(
            "DELETE FROM public.post_genres WHERE post_id=$1",
            [id],
          );
          await client.query("DELETE FROM public.posts WHERE id=$1", [id]);
          await client.query("COMMIT");
          return {
            status: "DELETED",
            keys: rows.flatMap((row) => [row.original_key, row.preview_key]),
          };
        }
        if (
          post.status !== "PUBLISHED" &&
          post.moderation_state !== "TEMP_HIDDEN"
        )
          throw problem(409, "Bài đang bị quản trị viên ẩn.");
        await client.query(
          "UPDATE public.posts SET status='HIDDEN',withdrawn_at=now() WHERE id=$1",
          [id],
        );
        await client.query(
          "INSERT INTO public.post_moderation_actions (post_id,actor_id,actor_kind,action) VALUES ($1,$2,'AUTHOR','WITHDRAW')",
          [id, caller.id],
        );
        await client.query("COMMIT");
        return { status: "WITHDRAWN" };
      }
      if (!["DRAFT", "PUBLISHED"].includes(post.status))
        throw problem(409, "Bài này không còn sửa được.");
      if (method === "GET") {
        const { rows: genres } = await client.query(
          `SELECT g.id,g.name FROM public.post_genres pg JOIN public.genres g ON g.id=pg.genre_id
          WHERE pg.post_id=$1 ORDER BY g.name,g.id`,
          [id],
        );
        const { rows: assets } = await client.query(
          `SELECT a.id,a.filename,a.original_key,a.size_bytes,a.position,a.purpose,a.preview_start_seconds,f.kind
          FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
          WHERE a.post_id=$1 AND a.status='READY' ORDER BY a.position`,
          [id],
        );
        await client.query("COMMIT");
        return {
          post,
          genres,
          media: assets.map((a) => ({
            id: a.id,
            filename: a.filename,
            size: Number(a.size_bytes),
            kind: a.kind,
            previewStart: a.preview_start_seconds,
            premium: Number(post.price_vnd) > 0 && a.purpose === "FULL",
            url: localKey.test(a.original_key) ? mediaUrl(a.id) : null,
          })),
        };
      }
      if (post.status !== "PUBLISHED")
        throw problem(409, "Dùng form chỉnh sửa bản nháp để lưu tệp.");
      if (input?.revision !== post.revision)
        throw problem(409, "Bài đã thay đổi. Tải lại form trước khi lưu.");
      const title = typeof input.title === "string" ? input.title.trim() : "";
      const description =
        typeof input.description === "string" ? input.description.trim() : "";
      const genreId = input.genreId || null;
      const coverId = input.coverId || null;
      if (
        !title ||
        title.length > 100 ||
        description.length > 1000 ||
        (genreId && (typeof genreId !== "string" || !uuid.test(genreId))) ||
        (coverId && (typeof coverId !== "string" || !uuid.test(coverId)))
      )
        throw problem(
          400,
          "Kiểm tra tiêu đề, mô tả, thể loại và ảnh đại diện.",
        );
      if (coverId) {
        const {
          rows: [cover],
        } = await client.query(
          `SELECT a.position,a.purpose,f.kind FROM public.assets a
          JOIN public.asset_formats f ON f.id=a.format_id WHERE a.id=$1 AND a.post_id=$2 AND a.status='READY'`,
          [coverId, id],
        );
        if (
          !cover ||
          !["IMAGE", "VIDEO"].includes(cover.kind) ||
          (Number(post.price_vnd) > 0 && cover.purpose !== "PROMO")
        ) {
          throw problem(400, "Chọn tệp công khai phù hợp làm đại diện.");
        }
        if (cover.position !== 1) {
          await client.query("SET CONSTRAINTS ALL DEFERRED");
          await client.query(
            `UPDATE public.assets SET position=CASE WHEN id=$1 THEN 1 ELSE $3 END
            WHERE post_id=$2 AND (id=$1 OR position=1)`,
            [coverId, id, cover.position],
          );
        }
      }
      await setPostGenre(client, id, genreId);
      await client.query(
        "UPDATE public.posts SET title=$2,description=$3,auto_cycle=$4 WHERE id=$1",
        [id, title, description, input.autoCycle === true],
      );
      await client.query("COMMIT");
      return { status: "PUBLISHED" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
  if (result.keys) await removeLocalAssets(result.keys);
  const { keys, ...response } = result;
  return response;
}

export async function handleCatalog(req, res, path, send, caller, readJson) {
  const search = new URL(req.url, "http://localhost").searchParams;
  const match =
    /^\/api\/demo\/(media|preview|catalog|publish|manage-post|test-purchase|purchase-status|admin-post|admin-genre|admin-report|admin-event)\/([^/]+)(?:\/(like|save|comments|report))?$/.exec(
      path,
    );
  const group = /^\/api\/demo\/(collections|events)(?:\/([^/]+))?$/.exec(path);
  const collectionItem = /^\/api\/demo\/collections\/([^/]+)\/posts\/([^/]+)$/.exec(path);
  const requireUser = () => {
    if (!caller) throw problem(401, "Hãy đăng nhập để tiếp tục.");
  };
  const requireAdmin = () => {
    if (caller?.role !== "ADMIN")
      throw problem(403, "Chỉ tài khoản admin được thực hiện.");
  };
  try {
    if (path === "/api/demo/catalog" && req.method === "GET")
      return send(res, 200, { posts: await catalog(search) });
    if (group && req.method === "GET" && (!group[2] || uuid.test(group[2])))
      return send(res, 200, await groups(group[1], group[2], caller));
    if (path === "/api/demo/my-collections" && req.method === "GET") {
      requireUser();
      const postId = search.get("postId");
      if (postId && !uuid.test(postId)) throw problem(400, "Tác phẩm không hợp lệ.");
      return send(res, 200, { collections: await myCollections(caller, postId) });
    }
    if (group?.[1] === "collections" && group[2] && uuid.test(group[2]) && req.method === "PUT") {
      requireUser();
      return send(res, 200, await renameCollection(group[2], caller, await readJson(req)));
    }
    if (collectionItem && uuid.test(collectionItem[1]) && uuid.test(collectionItem[2]) &&
        ["PUT","DELETE"].includes(req.method)) {
      requireUser();
      return send(res, 200, await changeCollectionItem(collectionItem[1], collectionItem[2], caller, req.method === "PUT"));
    }
    if (path === "/api/demo/collections" && req.method === "POST") {
      requireUser();
      return send(
        res,
        201,
        await createCollection(caller, await readJson(req)),
      );
    }
    if (path === "/api/demo/genres" && req.method === "GET") {
      return send(res, 200, {
        genres: await query(
          "CONTENT",
          "SELECT id,name FROM public.genres WHERE enabled OR $1 ORDER BY name",
          [search.has("all")],
        ),
      });
    }
    if (
      ["/api/demo/saved", "/api/demo/purchases"].includes(path) &&
      req.method === "GET"
    ) {
      requireUser();
      return send(res, 200, {
        posts: await library(path.split("/").at(-1), caller),
      });
    }
    if (path === "/api/demo/wallet" && req.method === "GET") {
      requireUser();
      return send(res, 200, await commerce("/wallet?" + new URLSearchParams({ buyerId:caller.id })));
    }
    if (path === "/api/demo/wallet/top-up" && req.method === "POST") {
      requireUser();
      const input = await readJson(req);
      return send(res, 200, await commerce("/wallet/top-up", {
        buyerId: caller.id, amount: input?.amount, requestId: input?.requestId,
      }));
    }
    if (path === "/api/demo/admin" && req.method === "GET") {
      requireAdmin();
      return send(res, 200, await adminDashboard());
    }
    if (path === "/api/demo/admin-events" && req.method === "POST") {
      requireAdmin();
      return send(res, 201, await saveEvent(null, await readJson(req)));
    }
    if (path === "/api/demo/admin-genres" && req.method === "POST") {
      requireAdmin();
      const input = await readJson(req);
      const name = typeof input?.name === "string" ? input.name.trim() : "";
      const slug = name
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (!slug || name.length > 60)
        throw problem(400, "Nhập tên thể loại từ 1 đến 60 ký tự.");
      const rows = await query(
        "CONTENT",
        "INSERT INTO public.genres (name,slug) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING RETURNING id",
        [name, slug],
      );
      if (!rows.length) throw problem(409, "Thể loại đã tồn tại.");
      return send(res, 201, rows[0]);
    }
    if (!match || !uuid.test(match[2]) || (match[3] && match[1] !== "catalog"))
      return send(res, 404, { message: "Không tìm thấy API." });
    const [, action, id, sub] = match;
    if (["media", "preview"].includes(action) && req.method === "GET")
      return await sendMedia(req, res, id, caller, action === "preview", search.get("thumbnail") === "1");
    if (action === "catalog" && !sub && req.method === "GET")
      return send(res, 200, await detail(id, caller));
    if (sub) {
      requireUser();
      return send(res, 200, await community(path, req, caller, id, readJson));
    }
    if (action === "publish" && req.method === "PUT") {
      requireUser();
      return send(res, 200, await publish(id, caller));
    }
    if (
      action === "manage-post" &&
      ["GET", "PUT", "DELETE"].includes(req.method)
    ) {
      requireUser();
      return send(
        res,
        200,
        await managePost(
          id,
          caller,
          req.method,
          req.method === "GET" ? null : await readJson(req),
        ),
      );
    }
    if (action === "test-purchase" && req.method === "POST") {
      requireUser();
      const input = await readJson(req);
      const result = await testPurchase(id, caller, input?.price);
      return send(res, result.status === "VERIFYING" ? 202 : 200, result);
    }
    if (action === "purchase-status" && req.method === "GET") {
      requireUser();
      return send(res, 200, {
        status: (await hasEntitlement(id, caller)) ? "PAID" : "UNCONFIRMED",
      });
    }
    if (action === "admin-event" && req.method === "PUT") {
      requireAdmin();
      return send(res, 200, await saveEvent(id, await readJson(req)));
    }
    if (action.startsWith("admin-") && req.method === "PUT") {
      requireAdmin();
      const input = await readJson(req);
      if (action === "admin-genre" && typeof input?.enabled === "boolean") {
        const rows = await query(
          "CONTENT",
          "UPDATE public.genres SET enabled=$2 WHERE id=$1 RETURNING id",
          [id, input.enabled],
        );
        if (!rows.length) throw problem(404, "Không tìm thấy thể loại.");
      } else if (action === "admin-post") {
        await moderatePost(id, caller, input);
      } else if (action === "admin-report" && input?.status === "DISMISSED") {
        await callService("COMMUNITY", "dismiss", { id, userId: caller.id });
      } else throw problem(400, "Thao tác không hợp lệ.");
      return send(res, 200, { saved: true });
    }
    return send(res, 405, { message: "Phương thức không hợp lệ." });
  } catch (error) {
    return send(res, error.status || 503, {
      message: error.status
        ? error.message
        : "Không đọc hoặc ghi được dữ liệu. Kiểm tra kết nối DB.",
    });
  }
}
