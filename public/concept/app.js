import { createUploadTools, upload } from "./upload.js";
import { discover } from "./discover.js";
import { welcome, authForm, verifyForm } from "./auth.js";
import { admin } from "./admin.js";
import { handlePurchase } from "./purchase.js";
import { createCollectionBuilder } from "./collection-builder.js";
import { createCollectionPages } from "./collection-pages.js";
import { setupTheme } from "./theme.js";
import {
  galleryCycleItems,
  galleryInterval,
  galleryFrame as renderGalleryFrame,
  galleryStrip as renderGalleryStrip,
} from "./gallery.js";
import {
  avatar,
  avatarPayload,
  filterPurchases,
  money,
  profilePage,
  purchaseLibrary,
  revenuePage,
  revenueResults,
  walletPage,
} from "./account-extras.js";

const app = document.querySelector("#app");
const loginLink = document.querySelector("#login-link");
const adminLink = document.querySelector("#admin-link");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const link = (label, href, style = "light") =>
  `<a class="btn ${style}" href="${esc(href)}">${esc(label)}</a>`;
const heading = (title, text = "", action = "") =>
  `<header class="page-head"><div><h1>${esc(title)}</h1>${text ? `<p>${esc(text)}</p>` : ""}</div>${action}</header>`;
const empty = (text) => `<p class="empty">${esc(text)}</p>`;
const price = (p) =>
  Number(p.price_vnd)
    ? Number(p.price_vnd).toLocaleString("vi-VN") + " ₫"
    : "Miễn phí";
const postLink = (p) => "#post/" + encodeURIComponent(p.id);
const creatorLink = (id) => "#creator/" + encodeURIComponent(id);
const kindNames = { IMAGE: "Ảnh", VIDEO: "Video", AUDIO: "Âm thanh" };
let user = null,
  version = 0,
  afterLogin = "account",
  currentMedia = [],
  noticeTimer;
let heroTimer;
async function cycleHero(hero) {
  try {
    const response = await fetch("/assets/hero/images");
    if (!response.ok) return;
    const { images } = await response.json();
    if (!hero.isConnected || !images.length) return;
    const slides = document.createElement("div");
    slides.className = "hero-slides";
    slides.setAttribute("aria-hidden", "true");
    hero.prepend(slides);
    function loadSlide(src) {
      const image = new Image();
      image.alt = "";
      image.src = src;
      return image;
    }
    let index = 0;
    let current = loadSlide(images[index]);
    slides.append(current);
    if (images.length < 2) return;
    let next = loadSlide(images[1]);
    heroTimer = setInterval(() => {
      if (!hero.isConnected) return;
      if (!next.complete) return;
      if (next.naturalWidth) {
        current.className = "hero-slide-out";
        next.className = "hero-slide-in";
        slides.replaceChildren(current, next);
        current = next;
      }
      index = (index + 1) % images.length;
      next = loadSlide(images[(index + 1) % images.length]);
    }, 7000);
  } catch {
    // The gradient remains visible if the image list cannot be loaded.
  }
}
const browseDefaults = () => ({
  q: "",
  kind: "",
  sort: "new",
  pay: "",
  days: "",
  offset: 0,
  include: [],
  exclude: [],
});
let filters = browseDefaults();
let galleryTimer,
  galleryIndex = 0,
  galleryPost = "";
const cycleOverrides = new Map();
const uploadState = { files: [], cover: null, busy: false };

const {
  clearUploadFiles,
  uploadPriceSummary,
  renderUploadFiles,
  addUploadFiles,
  buildUploadPayload,
  syncUploadVideo,
  rememberUploadTime,
  useCurrentPreviewTime,
} = createUploadTools(uploadState, esc);

async function api(path, options = {}) {
  const response = await fetch("/api/demo/" + path, {
    ...options,
    headers: { "X-PCK-Demo": "1", ...options.headers },
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.message || "Yêu cầu thất bại."), {
      status: response.status,
    });
  return result;
}
const json = (path, method, body) =>
  api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
function go(route) {
  if (location.hash === "#" + route) render();
  else location.hash = route;
}
function notice(text) {
  const box = document.querySelector("#notice");
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => box.classList.remove("show"), 3700);
}
function button(label, action, id = "", next = "") {
  const style =
    action === "test-purchase" || action === "publish" ? "primary" : "light";
  return `<button type="button" class="btn ${style}" data-action="${action}" data-id="${esc(id)}" data-next="${esc(next)}">${esc(label)}</button>`;
}
function card(p, { quickSave = false, compact = false } = {}) {
  const types = p.kinds || [];
  const kinds =
    types.includes("IMAGE") && types.includes("VIDEO")
      ? ["Hỗn hợp"]
      : types.map((k) => kindNames[k] || "Tệp");
  const cover =
    p.status === "PUBLISHED" && p.cover_id
      ? "/api/demo/media/" + encodeURIComponent(p.cover_id)
      : "";
  const video = cover && p.cover_kind === "VIDEO";
  const paid = Number(p.price_vnd) > 0;
  const metadata = [...kinds, ...(p.genres || [])].join(" | ");
  const showDetails = compact && Boolean(metadata || paid);
  const availablePrice =
    p.moderation_state === "TAKEN_DOWN"
      ? "Đã gỡ do kiểm duyệt"
      : p.withdrawn_at
        ? "Đã gỡ khỏi Khám phá"
        : p.moderation_state === "TEMP_HIDDEN"
          ? "Tạm ẩn | Người mua vẫn xem được"
          : p.status === "HIDDEN"
            ? "Không khả dụng"
            : price(p);
  const infoId = "catalog-info-" + esc(p.id);
  const author = p.author || "Người dùng PCK";
  return `<article class="card${video ? " video-card" : ""}${compact ? " catalog-compact-card" : ""}${p.author_id ? " card-has-author" : ""}">
  ${p.author_id ? `<a class="card-author" href="${creatorLink(p.author_id)}" aria-label="Xem hồ sơ ${esc(author)}">${avatar({ id: p.author_id, alias: author, avatarVersion: p.authorAvatarVersion }, esc)}<span>${esc(author)}</span></a>` : ""}
  <a href="${postLink(p)}">
  <div class="visual real-cover">${
    video
      ? `<video src="${cover}" muted playsinline loop preload="metadata" aria-hidden="true"></video>`
      : cover && p.cover_kind === "IMAGE"
        ? `<img src="${cover}" alt="" loading="lazy">`
        : "<span>Chưa có ảnh bìa</span>"
  }${
    compact
      ? `<div class="catalog-card-overlay">
    ${showDetails ? `<div class="catalog-card-reveal" id="${infoId}"><div class="catalog-card-detail-row">${metadata ? `<span>${esc(metadata)}</span>` : ""}${paid ? `<strong>${esc(price(p))}</strong>` : ""}</div></div>` : ""}
    <div class="catalog-card-caption"><h3>${esc(p.title)}</h3><span class="catalog-card-tier${paid ? " is-paid" : ""}">${paid ? "Trả phí" : "Miễn phí"}</span></div>
  </div>`
      : ""
  }</div>
  ${
    compact
      ? ""
      : `<div class="card-body"><div class="catalog-card-meta"><span class="category">${esc(kinds.join(" | "))}</span>${p.genres?.length ? `<span>${esc(p.genres.join(" | "))}</span>` : ""}</div><h3>${esc(p.title)}</h3>
  <p>${esc(availablePrice)}</p></div>`
  }</a>
  ${showDetails ? `<button type="button" class="catalog-card-info" data-card-info aria-label="Thông tin tác phẩm ${esc(p.title)}" aria-controls="${infoId}" aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01" stroke-linecap="round"/></svg></button>` : ""}
  ${quickSave ? `<div class="card-quick-actions"><button type="button" class="card-save" data-quick-save="${esc(p.id)}" aria-label="Lưu ${esc(p.title)} vào Xem sau" aria-pressed="${savedForBrowse.has(p.id)}">${savedForBrowse.has(p.id) ? "Đã lưu" : "Lưu"}</button><button type="button" class="card-save" data-action="collection-add" data-id="${esc(p.id)}" aria-label="Thêm ${esc(p.title)} vào bộ sưu tập" title="Thêm vào bộ sưu tập">＋</button></div>` : ""}
  ${video ? '<button type="button" class="video-card-toggle" aria-label="Phát video đại diện" data-video-toggle>▶</button>' : ""}</article>`;
}
const grid = (posts, msg = "Chưa có tác phẩm nào.", options) =>
  posts.length
    ? `<div class="grid">${posts.map((post) => card(post, options)).join("")}</div>`
    : empty(msg);
async function creatorPage(id, params) {
  try {
    const query = new URLSearchParams({ page: params.get("page") ?? "1" });
    const { profile, posts, page, hasMore } = await api(
      "creators/" + encodeURIComponent(id) + "?" + query,
    );
    const href = creatorLink(profile.id);
    const pagination =
      page > 1 || hasMore
        ? `<nav class="button-row creator-pagination" aria-label="Trang tác phẩm của người đăng">
          ${page > 1 ? link("Trang trước", href + "?page=" + (page - 1)) : ""}
          <span>Trang ${page}</span>
          ${hasMore ? link("Trang sau", href + "?page=" + (page + 1)) : ""}
        </nav>`
        : "";
    return `<div class="catalog-page creator-page">
      <header class="surface creator-header">
        ${avatar(profile, esc)}
        <div class="creator-intro"><h1>${esc(profile.alias)}</h1>
          ${profile.bio ? `<p>${esc(profile.bio)}</p>` : ""}</div>
        ${user?.id === profile.id ? link("Chỉnh sửa hồ sơ", "#account/profile") : ""}
      </header>
      <section class="section creator-works" aria-labelledby="creator-works-title">
        <div class="heading"><h2 id="creator-works-title">Tác phẩm đã đăng</h2></div>
        ${grid(posts, page === 1 ? "Người dùng này chưa có tác phẩm công khai." : "Trang này không có tác phẩm.", { compact: true })}
        ${pagination}
      </section></div>`;
  } catch (error) {
    if (error.status !== 404) throw error;
    return heading(
      "Hồ sơ không khả dụng",
      "",
      link("Về Khám phá", "#" + browseRoute()),
    );
  }
}
function collectionCover(group) {
  const covers = (
    group.cover_ids ?? (group.cover_id ? [group.cover_id] : [])
  ).slice(0, 3);
  return `<div class="visual real-cover collection-cover">${
    covers.length
      ? `<div class="collection-cover-panes">${covers
          .map((id) => {
            const source = "/api/demo/media/" + encodeURIComponent(id);
            return `<span class="collection-cover-pane"><img src="${source}?thumbnail=1" data-fallback="${source}" alt="" loading="lazy"></span>`;
          })
          .join("")}</div>`
      : "<span>Chưa có ảnh bìa</span>"
  }</div>`;
}

const groupCards = (groups, route) =>
  groups.length
    ? `<div class="grid compact-collections">${groups.map((g) => `<article class="card"><a href="#${route}/${encodeURIComponent(g.id)}">${route === "collection" ? collectionCover(g) : ""}<div class="card-body"><span class="category">${g.total} tác phẩm</span><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p></div></a></article>`).join("")}</div>`
    : empty("Chưa có nội dung trong mục này.");
const shelf = (title, body, action = "") =>
  `<section class="section"><div class="heading"><h2>${title}</h2>${action}</div>${body}</section>`;
async function home() {
  const [catalog, photos, videos, mixed, collections, events] =
    await Promise.all([
      api("catalog"),
      api("catalog?kind=IMAGE"),
      api("catalog?kind=VIDEO"),
      api("catalog?kind=MIXED"),
      api("collections"),
      api("events"),
    ]);
  const activeEvents = events.filter((event) => event.total > 0).slice(0, 2);
  const highlights = await Promise.allSettled(
    activeEvents.map((event) => api("events/" + encodeURIComponent(event.id))),
  );
  const featured = [
    ...new Map(
      highlights
        .flatMap((result) => result.value?.posts ?? [])
        .map((post) => [post.id, post]),
    ).values(),
  ];
  const picks = (featured.length ? featured : catalog.posts).slice(0, 3);
  const shown = new Set(picks.map((post) => post.id));
  function take(posts) {
    const entries = posts.filter((post) => !shown.has(post.id)).slice(0, 4);
    for (const post of entries) shown.add(post.id);
    return entries;
  }
  const recent = take(catalog.posts);
  const mediaShelf = (title, entries, route) =>
    entries.length
      ? shelf(
          title,
          grid(entries, undefined, { compact: true }),
          link("Xem thêm", route),
        )
      : "";
  return (
    '<div class="catalog-page catalog-home">' +
    document.querySelector("#hero-template").innerHTML +
    '<nav class="home-format-nav" aria-label="Duyệt theo định dạng"><a href="#browse/IMAGE">Ảnh</a><a href="#browse/VIDEO">Video</a><a href="#browse/MIXED">Hỗn hợp</a></nav>' +
    shelf(
      "Nổi bật",
      picks.length
        ? `<div class="feature-gallery">${picks.map((post) => card(post, { compact: true })).join("")}</div>`
        : empty("Chưa có tác phẩm nổi bật."),
      link("Vào Khám phá", "#browse"),
    ) +
    mediaShelf("Mới phát hành", recent, "#browse") +
    mediaShelf("Ảnh", take(photos.posts), "#browse/IMAGE") +
    mediaShelf("Video", take(videos.posts), "#browse/VIDEO") +
    mediaShelf("Hỗn hợp", take(mixed.posts), "#browse/MIXED") +
    (activeEvents.length
      ? shelf("Sự kiện", groupCards(activeEvents, "event"))
      : "") +
    shelf(
      "Bộ sưu tập",
      groupCards(collections.slice(0, 4), "collection"),
      link("Xem tất cả", "#collections"),
    ) +
    "</div>"
  );
}
let browseTimer,
  browseRequest = 0;
let savedForBrowse = new Set();

function browseParams(value) {
  const { include, exclude, ...basic } = value;
  const search = new URLSearchParams(basic);
  for (const id of include) search.append("include", id);
  for (const id of exclude) search.append("exclude", id);
  return search;
}

function browseRoute(value = filters) {
  const search = browseParams(value);
  for (const key of ["q", "kind", "pay", "days"]) {
    if (!search.get(key)) search.delete(key);
  }
  if (!value.offset) search.delete("offset");
  return "browse?" + search;
}

function readBrowseRoute(id, rawQuery) {
  const kinds = ["IMAGE", "VIDEO", "MIXED"];
  if (rawQuery === undefined) {
    return kinds.includes(id) ? { ...browseDefaults(), kind: id } : filters;
  }
  const params = new URLSearchParams(rawQuery);
  const choose = (key, allowed, fallback = "") => {
    const value = params.get(key);
    return allowed.includes(value) ? value : fallback;
  };
  const genres = (key) =>
    [
      ...new Set(
        params
          .getAll(key)
          .filter((value) =>
            /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value),
          )
          .map((value) => value.toLowerCase()),
      ),
    ].slice(0, 50);
  return {
    q: (params.get("q") || "").trim().slice(0, 100),
    kind: choose("kind", kinds),
    sort: choose("sort", ["new", "old"], "new"),
    pay: choose("pay", ["free", "premium"]),
    days: choose("days", ["7", "30", "older"]),
    offset: Math.min(
      3000,
      Math.max(0, Number.parseInt(params.get("offset"), 10) || 0),
    ),
    include: genres("include"),
    exclude: genres("exclude"),
  };
}

function rememberBrowseRoute() {
  const hash = "#" + browseRoute();
  if (location.hash !== hash) history.replaceState(history.state, "", hash);
}

function browseSearch() {
  return api("catalog?" + browseParams(filters));
}

function browseResults(posts) {
  return (
    grid(posts, "Không tìm thấy tác phẩm phù hợp.", {
      compact: true,
      quickSave: true,
    }) +
    `<div class="button-row pagination">${filters.offset ? button("Trang trước", "previous") : ""}${posts.length === 25 && filters.offset < 3000 ? button("Trang sau", "next") : ""}</div>`
  );
}

function updateBrowse(form, delay = 0) {
  rememberBrowseRoute();
  clearTimeout(browseTimer);
  const request = ++browseRequest;
  const status = form.querySelector("[role=status]");
  const results = document.querySelector("#browse-results");
  status.textContent = "Đang lọc…";
  results.setAttribute("aria-busy", "true");
  browseTimer = setTimeout(async () => {
    if (!form.isConnected) return;
    try {
      const { posts } = await browseSearch();
      if (request !== browseRequest || !form.isConnected) return;
      results.innerHTML = browseResults(posts);
      status.textContent = posts.length
        ? `Hiển thị ${posts.length} tác phẩm.`
        : "";
    } catch {
      if (request !== browseRequest || !form.isConnected) return;
      status.textContent =
        "Chưa cập nhật được kết quả. Nhấn Tìm kiếm để thử lại.";
    } finally {
      if (request === browseRequest && form.isConnected)
        results.removeAttribute("aria-busy");
    }
  }, delay);
}

function filterBrowse(form, delay = 0) {
  const data = new FormData(form);
  const { q, kind, sort, pay, days } = Object.fromEntries(data);
  const tags = [...data].filter(([key]) => key.startsWith("genre:"));
  const selected = (mode) =>
    tags.filter(([, value]) => value === mode).map(([key]) => key.slice(6));
  filters = {
    q: q.trim(),
    kind,
    sort,
    pay,
    days,
    offset: 0,
    include: selected("yes"),
    exclude: selected("no"),
  };
  form
    .querySelectorAll("[data-topic]")
    .forEach((choice) =>
      choice.setAttribute(
        "aria-pressed",
        String(filters.include.includes(choice.dataset.topic)),
      ),
    );
  const active =
    Number(sort !== "new") +
    Number(Boolean(pay)) +
    Number(Boolean(days)) +
    filters.include.length +
    filters.exclude.length;
  form.querySelector("[data-filter-count]").textContent = active
    ? ` (${active})`
    : "";
  updateBrowse(form, delay);
}

let verificationEmail = "";
const loginRequired = (message) =>
  heading("Bạn đang xem với vai trò Khách", message) +
  button("Đăng nhập", "login", location.hash.slice(1) || "account");
function genreOptions(genres, assigned = []) {
  const choices = [
    ...genres,
    ...assigned.filter((item) => !genres.some((g) => g.id === item.id)),
  ];
  return (
    '<option value="">Chưa chọn</option>' +
    choices
      .map(
        (g) =>
          `<option value="${esc(g.id)}" ${g.id === assigned[0]?.id ? "selected" : ""}>${esc(g.name)}</option>`,
      )
      .join("")
  );
}
const postStatus = (p) =>
  p.moderation_state === "TAKEN_DOWN"
    ? "Đã gỡ do kiểm duyệt"
    : p.withdrawn_at
      ? "Tác giả đã gỡ"
      : p.moderation_state === "TEMP_HIDDEN"
        ? "Đang ẩn tạm"
        : { DRAFT: "Bản nháp", PUBLISHED: "Đã phát hành", HIDDEN: "Đang ẩn" }[
            p.status
          ] || p.status;

function moderationButtons(post) {
  const action = (label, next) => button(label, "admin-post", post.id, next);
  if (post.status === "DRAFT") return "";
  if (post.moderation_state === "TAKEN_DOWN")
    return action("Gỡ chặn", "REINSTATE");
  const takedown = action("Gỡ do vi phạm", "TAKEDOWN");
  if (post.status === "PUBLISHED") return action("Ẩn tạm", "HIDE") + takedown;
  if (post.moderation_state === "TEMP_HIDDEN" || !post.withdrawn_at)
    return action("Bỏ ẩn", "RESTORE") + takedown;
  return takedown;
}
function postActions(p) {
  if (!["DRAFT", "PUBLISHED"].includes(p.status)) return "";
  return (
    link("Sửa tác phẩm", "#edit/" + encodeURIComponent(p.id)) +
    button(
      p.status === "DRAFT" ? "Xóa nháp" : "Gỡ tác phẩm",
      "remove-post",
      p.id,
      p.status,
    )
  );
}
function publishedEditor({ post, media, genres: assigned }, genres) {
  const publicMedia = media.filter((file) => !file.premium);
  return (
    heading(
      "Sửa tác phẩm đã phát hành",
      "Bạn có thể sửa thông tin, ảnh đại diện và chế độ tự chuyển ảnh.",
      link("Hủy", postLink(post)),
    ) +
    `<form id="published-edit" class="surface edit-form" data-id="${esc(post.id)}">
  <input name="revision" type="hidden" value="${esc(post.revision)}">
  <label>Tiêu đề<input name="title" required maxlength="100" value="${esc(post.title)}"></label>
  <label>Mô tả<textarea name="description" maxlength="1000" rows="4">${esc(post.description)}</textarea></label>
  <label>Thể loại<select name="genre">${genreOptions(genres, assigned)}</select></label>
  <label>Ảnh đại diện<select name="cover"><option value="">Giữ ảnh đại diện hiện tại</option>
   ${publicMedia.map((file) => `<option value="${esc(file.id)}">${esc(file.filename)}</option>`).join("")}</select></label>
  <label class="check"><input name="autoCycle" type="checkbox" ${post.auto_cycle ? "checked" : ""}> Tự chuyển ảnh và video mỗi 10 giây khi mở tác phẩm</label>
  <p class="muted">Tệp, trạng thái Premium và giá được giữ nguyên để người mua tiếp tục truy cập nội dung đã mua.</p>
  <button class="btn dark">Lưu thay đổi</button><p role="status" class="muted"></p></form>`
  );
}
const galleryFrame = (media, i) =>
  renderGalleryFrame(media, i, { empty, esc, kindNames });
const galleryStrip = (media, selected) =>
  renderGalleryStrip(media, selected, {
    esc,
    kindNames,
    autoCycle: Boolean(cycleOverrides.get(galleryPost)),
  });

const likeButtonText = (liked, count) =>
  `${liked ? "Bỏ thích" : "Thích"} | ${count}`;
const commentRow = (comment) =>
  `<div class="post-comment">${avatar({ id: comment.authorId, alias: comment.author, avatarVersion: comment.avatarVersion }, esc)}<div><strong>${esc(comment.author || "Người dùng PCK")}</strong><p>${esc(comment.body)}</p></div></div>`;

async function togglePostLike(control, id) {
  control.disabled = true;
  try {
    const { active, likes } = await api(
      "catalog/" + encodeURIComponent(id) + "/like",
      {
        method: control.dataset.action === "unlike" ? "DELETE" : "PUT",
      },
    );
    if (!control.isConnected) return;
    control.dataset.action = active ? "unlike" : "like";
    control.setAttribute("aria-pressed", String(active));
    control.textContent = likeButtonText(active, likes);
  } catch (error) {
    if (control.isConnected) notice(error.message);
  } finally {
    control.disabled = false;
  }
}

async function addPostComment(form) {
  const submit = form.querySelector("button");
  if (submit.disabled) return;
  const input = form.elements.text;
  const originalText = input.value;
  const status = form.querySelector("[role=status]");
  submit.disabled = true;
  status.textContent = "Đang gửi bình luận…";
  try {
    const { comment } = await json(
      "catalog/" + encodeURIComponent(form.dataset.id) + "/comments",
      "POST",
      {
        text: originalText,
      },
    );
    if (!form.isConnected) return;
    const list = form
      .closest(".comments")
      .querySelector("[data-post-comments]");
    list.querySelector("[data-comments-empty]")?.remove();
    list.insertAdjacentHTML("afterbegin", commentRow(comment));
    if (list.children.length > 50) list.lastElementChild.remove();
    if (input.value === originalText) input.value = "";
    status.textContent = "Đã gửi bình luận.";
  } catch (error) {
    if (form.isConnected) status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}
async function detail(id) {
  const data = await api("catalog/" + encodeURIComponent(id));
  const { post, media } = data;
  const published = post.status === "PUBLISHED";
  const premiumCount = media.filter((file) => file.premium).length;
  const locked = media.some((file) => file.locked);
  const purchaseAvailable = media
    .filter((file) => file.premium)
    .every((file) => file.originalAvailable);
  const socialAvailable = published && data.communityAvailable;
  const author =
    post.author ||
    (published && data.identityAvailable === false
      ? "Thông tin tác giả tạm thời không khả dụng."
      : "");
  const authorRow = post.author
    ? `<a class="post-author creator-link" href="${creatorLink(post.author_id)}">
         ${avatar({ id: post.author_id, alias: author, avatarVersion: post.authorAvatarVersion }, esc)}
         <span>${esc(author)}</span></a>`
    : author
      ? `<p class="post-author">${esc(author)}</p>`
      : "";
  const balance = data.walletBalance ?? null;
  const amount = Number(post.price_vnd);
  const walletDetails =
    balance === null
      ? user
        ? "<p>Không thể tải số dư demo.</p>"
        : ""
      : `<div class="checkout-balance"><span>Số dư demo <strong>${money(balance)}</strong></span>${
          balance < amount
            ? `<span>Còn thiếu <strong>${money(amount - balance)}</strong></span>` +
              link(
                "Nạp thêm số dư",
                "#account/wallet?post=" + encodeURIComponent(id),
                "primary",
              )
            : `<span>Sau khi mua <strong>${money(balance - amount)}</strong></span>`
        }</div>`;
  const form = (name, label) =>
    `<form id="${name}" data-id="${esc(id)}"><input name="text" required maxlength="1000" aria-label="${label}" placeholder="${label}"><button class="btn light">Gửi</button><p role="status"></p></form>`;
  return {
    media,
    post,
    html:
      heading(post.title, "", link("Về Khám phá", "#" + browseRoute())) +
      `<div class="detail"><section id="post-media"></section>
 <aside class="surface detail-summary">${authorRow}<p class="category">${esc(published ? (premiumCount ? "Premium" : "Miễn phí") : postStatus(post))}</p>
 <h2>${esc(published ? price(post) : post.title)}</h2>
 <p>${media.length} tệp trong tác phẩm${premiumCount ? ` | ${premiumCount} tệp Premium` : ""}</p>
 ${
   published && locked
     ? purchaseAvailable
       ? `<p>Một lần mua mở khóa ${premiumCount} tệp Premium.</p>${walletDetails}${balance === null || balance >= amount ? `<div class="detail-purchase">${button(user ? "Mua bằng số dư demo" : "Đăng nhập để mua", "test-purchase", id, post.price_vnd)}<p class="purchase-status" role="status"></p></div>` : ""}`
       : "<p>Tạm dừng mua vì có tệp Premium không khả dụng.</p>"
     : ""
 }
 ${premiumCount && !locked && media.some((file) => file.url) ? "<p>Chọn một tệp còn khả dụng để tải bản gốc.</p>" : ""}
 ${post.description ? `<p class="detail-description">${esc(post.description)}</p>` : ""}
 ${data.canManage ? `<div class="button-row post-actions">${data.canPublish ? button("Phát hành", "publish", id) : ""}${postActions(post)}</div>` : ""}
 ${published ? `<div class="button-row detail-social-actions">${socialAvailable ? `<button type="button" class="btn light" data-action="${data.liked ? "unlike" : "like"}" data-id="${esc(id)}" aria-pressed="${data.liked}">${likeButtonText(data.liked, data.likes)}</button>${button(data.saved ? "Bỏ lưu" : "Xem sau", data.saved ? "unsave" : "save", id)}` : ""}${button("Thêm vào bộ sưu tập", "collection-add", id)}</div>` : ""}</aside></div>
 ${
   published
     ? `<section class="surface comments"><h2>Bình luận</h2>${
         socialAvailable
           ? `<div data-post-comments>${data.comments.length ? data.comments.map(commentRow).join("") : "<p data-comments-empty>Chưa có bình luận.</p>"}</div>` +
             (user
               ? form("comments-form", "Viết bình luận") +
                 `<details><summary>Báo cáo tác phẩm</summary>${form("report-form", "Lý do báo cáo")}</details>`
               : button("Đăng nhập để bình luận", "login", "post/" + id))
           : "<p>Bình luận và tương tác tạm thời không khả dụng. Bạn vẫn có thể xem tác phẩm.</p>"
       }</section>`
     : ""
 }`,
  };
}
function updateGallery(direction) {
  const panel = document.querySelector("#post-media");
  if (!panel) return;
  const viewer = panel.querySelector("[data-gallery-view]");
  if (!viewer) {
    panel.innerHTML = currentMedia.length
      ? `<div data-gallery-view>${galleryFrame(currentMedia, galleryIndex)}</div>${galleryStrip(currentMedia, galleryIndex)}`
      : empty("Chưa có tệp để hiển thị.");
    return;
  }
  viewer.innerHTML = galleryFrame(currentMedia, galleryIndex);
  panel.querySelectorAll("[data-media]").forEach((thumb) => {
    thumb.setAttribute(
      "aria-pressed",
      String(Number(thumb.dataset.media) === galleryIndex),
    );
  });
  if (direction) {
    const stage = panel.querySelector(".media-stage");
    stage?.classList.add(
      "gallery-slide",
      direction === "back" ? "gallery-slide-back" : "gallery-slide-forward",
    );
  }
}
function scheduleGallery() {
  clearInterval(galleryTimer);
  const items = galleryCycleItems(currentMedia);
  if (!cycleOverrides.get(galleryPost) || items.length < 2) return;
  galleryTimer = setInterval(() => {
    const panel = document.querySelector("#post-media");
    if (!panel || panel.querySelector(":focus-visible") || document.hidden)
      return;
    const video = panel.querySelector(".media-stage video");
    if (video && !video.paused && !video.ended) return;
    galleryIndex = items.find((index) => index > galleryIndex) ?? items[0];
    updateGallery("forward");
  }, galleryInterval);
}

function ownPostCards(posts, query = "") {
  if (!posts.length)
    return empty(
      query
        ? "Không tìm thấy tác phẩm phù hợp."
        : "Bạn chưa đăng tác phẩm nào.",
    );
  return `<div class="own-post-grid">${posts
    .map((post) => {
      const cover = post.cover_id
        ? "/api/demo/media/" + encodeURIComponent(post.cover_id)
        : "";
      const media =
        cover && post.cover_kind === "VIDEO"
          ? `<video src="${cover}" muted playsinline preload="metadata" aria-hidden="true"></video>`
          : cover
            ? `<img src="${cover}" alt="" loading="lazy">`
            : "";
      return `<article class="own-post-card">
      <a href="${postLink(post)}" class="own-post-link">
        <div class="own-post-cover">${media}<span ${media ? "hidden" : ""}>Chưa có hình xem trước</span></div>
        <div class="own-post-copy"><span>${esc(postStatus(post))}</span><h3>${esc(post.title)}</h3>
          ${
            post.sales
              ? `<div class="own-post-sales"><span>${post.sales.paidCount.toLocaleString("vi-VN")} lượt bán</span><strong>${money(post.sales.revenueVnd)}</strong></div>`
              : '<p class="own-post-sales muted">Số liệu tạm thời không khả dụng.</p>'
          }</div>
      </a>
      <div class="button-row post-actions">${postActions(post)}</div>
    </article>`;
    })
    .join("")}</div>`;
}

let ownPostsTimer,
  ownPostsRequest = 0;
function searchOwnPosts(input, delay = 250) {
  clearTimeout(ownPostsTimer);
  const request = ++ownPostsRequest;
  const query = input.value.trim();
  const results = app.querySelector("#own-post-results");
  const status = app.querySelector("#own-post-status");
  status.textContent = "Đang tìm…";
  results.setAttribute("aria-busy", "true");
  ownPostsTimer = setTimeout(async () => {
    if (!input.isConnected) return;
    try {
      const { posts } = await api("posts?" + new URLSearchParams({ q: query }));
      if (request !== ownPostsRequest || !input.isConnected) return;
      results.innerHTML = ownPostCards(posts, query);
      status.textContent = posts.length
        ? `Hiển thị ${posts.length} tác phẩm.`
        : "";
    } catch (error) {
      if (request === ownPostsRequest && input.isConnected)
        status.textContent = error.message;
    } finally {
      if (request === ownPostsRequest && input.isConnected)
        results.removeAttribute("aria-busy");
    }
  }, delay);
}

let revenueTimer,
  revenueRequest = 0;
function filterRevenue(form, delay = 0) {
  clearTimeout(revenueTimer);
  const request = ++revenueRequest;
  const route = location.hash;
  const params = new URLSearchParams(route.split("?").slice(1).join("?"));
  params.delete("page");
  params.set("q", form.elements.q.value.trim());
  params.set("sort", form.elements.sort.value);
  const results = app.querySelector("#revenue-results");
  const status = app.querySelector("#revenue-status");
  const current = () =>
    request === revenueRequest && form.isConnected && location.hash === route;
  results.setAttribute("aria-busy", "true");
  status.textContent = "Đang cập nhật kết quả…";
  revenueTimer = setTimeout(async () => {
    if (!current()) return;
    try {
      const report = await api("revenue?" + params);
      if (!current()) return;
      results.innerHTML = revenueResults(report, esc, postLink);
      history.replaceState(history.state, "", "#account/revenue?" + params);
      status.textContent = "";
    } catch (error) {
      if (current())
        status.textContent = `${error.message} Nhấn Enter trong ô tìm để thử lại.`;
    } finally {
      if (request === revenueRequest && form.isConnected)
        results.removeAttribute("aria-busy");
    }
  }, delay);
}

async function account(tab = "profile", query) {
  if (!user)
    return loginRequired("Đăng nhập để xem tác phẩm và nội dung của bạn.");
  const tabs = [
    ["profile", "Hồ sơ"],
    ["posts", "Tác phẩm của tôi"],
    ["saved", "Xem sau"],
    ["purchases", "Đã mua"],
    ["collections", "Bộ của tôi"],
    ["wallet", "Số dư"],
    ["revenue", "Doanh thu"],
  ];
  if (!tabs.some(([id]) => id === tab)) tab = "profile";
  let content;
  if (tab === "posts") {
    const { posts } = await api("posts");
    content = `<section aria-label="Tác phẩm của tôi"><form id="own-post-search" role="search" aria-label="Tìm tác phẩm của tôi">
      <input type="search" name="q" maxlength="100" aria-label="Tìm tác phẩm của tôi" placeholder="Tìm theo tên hoặc mô tả tác phẩm…">
    </form><p class="muted" id="own-post-status" role="status"></p>
    <div id="own-post-results">${ownPostCards(posts)}</div></section>`;
  } else if (tab === "saved") {
    const { posts } = await api("saved");
    content = posts.length
      ? `<div class="grid">${posts
          .map(
            (p) =>
              `<div>${
                p.unavailable
                  ? '<div class="surface card-body">Tác phẩm này hiện không công khai.</div>'
                  : card(p)
              }<div class="button-row">${button("Bỏ lưu", "unsave", p.id)}</div></div>`,
          )
          .join("")}</div>`
      : empty("Bạn chưa lưu tác phẩm nào.");
  } else if (tab === "purchases") {
    content = purchaseLibrary((await api("purchases")).posts, esc, postLink);
  } else if (tab === "wallet") {
    content = walletPage(
      await api("wallet"),
      esc,
      query.get("post"),
      query.get("stripe"),
    );
  } else if (tab === "revenue") {
    try {
      content = revenuePage(await api("revenue?" + query), esc, postLink);
    } catch (error) {
      content = `<section class="surface revenue-empty"><h2>Doanh thu</h2>
        <p role="status" class="muted">${esc(error.message)}</p>
        ${button("Mở lại báo cáo", "retry-revenue")}</section>`;
    }
  } else if (tab === "collections") {
    const { collections } = await api("my-collections");
    content =
      `<div class="button-row account-collections-actions">${link("Tạo bộ sưu tập", "#collection-new", "dark")}</div>` +
      (collections.length
        ? `<ul class="surface account-collections">${collections
            .map(
              (group) =>
                `<li><a href="#collection/${encodeURIComponent(group.id)}">${esc(group.title)} <span aria-hidden="true">↗</span></a></li>`,
            )
            .join("")}</ul>`
        : empty("Bạn chưa có bộ sưu tập."));
  } else {
    content = profilePage(
      await api("profile"),
      esc,
      (user.role === "ADMIN" ? link("Quản trị", "#admin") : "") +
        button("Đăng xuất", "logout"),
    );
  }
  return (
    heading("Tài khoản", user.alias) +
    `<nav class="tabs" aria-label="Tài khoản">${tabs.map(([id, label]) => `<a href="#account/${id}" ${id === tab ? 'class="selected" aria-current="page"' : ""}>${label}</a>`).join("")}</nav>` +
    content
  );
}
const { newCollection, wireCollectionBuilder } = createCollectionBuilder({
  getUser: () => user,
  loginRequired,
  heading,
  esc,
  kindNames,
  api,
});

const { groupPage, refreshCollectionPicker, openCollectionPicker } =
  createCollectionPages({
    api,
    heading,
    link,
    grid,
    esc,
    card,
    button,
    empty,
    app,
  });

function more() {
  return (
    heading("Khác") +
    `<div class="shortcut-grid">${[
      ["Bộ sưu tập", "collections"],
      ["Xem sau", "account/saved"],
      ["Đã mua", "account/purchases"],
    ]
      .map(
        ([label, route]) =>
          `<a class="surface shortcut" href="#${route}"><strong>${label} ↗</strong></a>`,
      )
      .join("")}</div>`
  );
}
async function render({ selectedMediaId } = {}) {
  clearInterval(heroTimer);
  clearInterval(galleryTimer);
  const request = ++version;
  const [path, rawQuery] = (
    location.hash.slice(1) || (user ? "home" : "welcome")
  ).split("?");
  const [route, id] = path.split("/");
  clearUploadFiles();
  document.body.classList.toggle(
    "admin-mode",
    route === "admin" && user?.role === "ADMIN",
  );
  document.body.classList.toggle("welcome-mode", route === "welcome");
  adminLink.hidden = user?.role !== "ADMIN";
  loginLink.href = user ? "#account" : "#login";
  loginLink.innerHTML = user
    ? `${avatar(user, esc)}<span>${esc(user.alias)}</span>`
    : "Đăng nhập";
  document.querySelectorAll(".main-nav a").forEach((a) => {
    const parent =
      {
        post: "browse",
        creator: "browse",
        login: "account",
        events: "home",
        event: "home",
        collections: "more",
        collection: "more",
        "collection-new": "more",
      }[route] || route;
    if (a.hash === "#" + parent) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const pages = {
    home,
    browse: () => {
      filters = readBrowseRoute(id, rawQuery);
      rememberBrowseRoute();
      return discover({
        filters,
        browseSearch,
        api,
        user,
        setSaved: (value) => {
          savedForBrowse = value;
        },
        heading,
        esc,
        browseResults,
      });
    },
    welcome: () => welcome({ link }),
    login: () => authForm({ user, heading, link, demo: id === "demo" }),
    register: () => authForm({ user, heading, link }, true),
    verify: () => verifyForm({ heading, esc, verificationEmail }),
    upload: () =>
      upload({
        user,
        loginRequired,
        api,
        publishedEditor,
        heading,
        link,
        postLink,
        esc,
        genreOptions,
      }),
    edit: () =>
      upload(
        {
          user,
          loginRequired,
          api,
          publishedEditor,
          heading,
          link,
          postLink,
          esc,
          genreOptions,
        },
        id,
      ),
    more,
    account: () => account(id, new URLSearchParams(rawQuery)),
    admin: () =>
      admin(
        {
          user,
          heading,
          link,
          api,
          empty,
          esc,
          postLink,
          postStatus,
          moderationButtons,
          button,
        },
        id,
        new URLSearchParams(rawQuery),
      ),
    collections: async () =>
      heading(
        "Bộ sưu tập",
        "",
        link("Tạo bộ sưu tập", "#collection-new", "dark"),
      ) + groupCards(await api("collections"), "collection"),
    collection: () => groupPage("collections", id),
    event: () => groupPage("events", id),
    "collection-new": newCollection,
    creator: () => creatorPage(id, new URLSearchParams(rawQuery)),
    post: () => detail(id),
  };
  app.innerHTML = empty("Đang tải…");
  try {
    const page = await (Object.hasOwn(pages, route) ? pages[route]() : home());
    if (request !== version) return;
    currentMedia = page.media || [];
    app.innerHTML = page.html || page;
    const collectionForm = app.querySelector("#collection-form");
    if (collectionForm) wireCollectionBuilder(collectionForm);
    const form = app.querySelector("#upload-form");
    if (form) {
      if (page.draft) {
        uploadState.files.push(
          ...page.draft.media.map((file) => ({
            id: file.id,
            file: { name: file.filename, size: file.size },
            preview: file.url,
            video: file.kind === "VIDEO",
            premium: file.premium,
            previewStart: file.previewStart,
          })),
        );
        uploadState.cover = uploadState.files[0] || null;
      }
      renderUploadFiles(form);
    }
    if (page.post) {
      galleryPost = page.post.id;
      galleryIndex = Math.max(
        0,
        currentMedia.findIndex((file) => file.id === selectedMediaId),
      );
      if (!cycleOverrides.has(galleryPost))
        cycleOverrides.set(galleryPost, page.post.auto_cycle);
      updateGallery();
      scheduleGallery();
    }
    const hero = app.querySelector(".hero");
    if (hero) cycleHero(hero);
  } catch (error) {
    if (request === version)
      app.innerHTML = heading("Không thể mở trang") + empty(error.message);
  }
}
function playCardVideo(video) {
  // Keep previews silent even when playback starts from a click.
  video.muted = true;
  video.play().catch(() => {});
}
function hoverGalleryClip(thumb, entering) {
  thumb.classList.toggle("is-hovering", entering);
  let video = thumb.querySelector(".gallery-thumb-clip");
  if (!entering) {
    thumb.classList.remove("is-playing");
    if (video) {
      video.pause();
      if (video.readyState >= 1) video.currentTime = 0;
    }
    return;
  }
  if (!video) {
    video = document.createElement("video");
    video.className = "gallery-thumb-clip";
    video.setAttribute("aria-hidden", "true");
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.src = thumb.dataset.clip;
    video.addEventListener("playing", () => {
      if (thumb.classList.contains("is-hovering"))
        thumb.classList.add("is-playing");
    });
    video.addEventListener("error", () => thumb.classList.remove("is-playing"));
    thumb.append(video);
  }
  playCardVideo(video);
}
for (const [eventName, isEntering] of [
  ["pointerover", true],
  ["pointerout", false],
]) {
  app.addEventListener(eventName, (event) => {
    if (
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const thumb = event.target.closest(".gallery-thumb[data-clip]");
    if (thumb) {
      if (!thumb.contains(event.relatedTarget))
        hoverGalleryClip(thumb, isEntering);
      return;
    }
    const card = event.target.closest(".video-card");
    if (!card || card.contains(event.relatedTarget)) return;
    const video = card.querySelector("video");
    if (isEntering) playCardVideo(video);
    else video.pause();
  });
}
for (const eventName of ["playing", "pause", "ended"]) {
  app.addEventListener(
    eventName,
    (event) => {
      const control = event.target
        .closest(".video-card")
        ?.querySelector("[data-video-toggle]");
      if (!control) return;
      const playing = eventName === "playing";
      control.textContent = playing ? "❚❚" : "▶";
      control.setAttribute(
        "aria-label",
        playing ? "Tạm dừng video đại diện" : "Phát video đại diện",
      );
    },
    true,
  );
}
app.addEventListener("click", async (event) => {
  if (event.target.closest('[data-action="retry-revenue"]')) {
    go("account/revenue");
    return;
  }
  const pickerClose = event.target.closest(
    "[data-collection-close], [data-admin-credit-close]",
  );
  if (pickerClose) {
    pickerClose.closest("dialog").close();
    return;
  }
  const pickerItem = event.target.closest("[data-picker-collection]");
  if (pickerItem) {
    const dialog = pickerItem.closest("dialog");
    const status = dialog.querySelector("[data-picker-status]");
    const add = pickerItem.getAttribute("aria-pressed") !== "true";
    const path = `collections/${encodeURIComponent(pickerItem.dataset.pickerCollection)}/posts/${encodeURIComponent(dialog.dataset.postId)}`;
    pickerItem.disabled = true;
    status.textContent = "Đang cập nhật…";
    try {
      const { active } = await api(path, { method: add ? "PUT" : "DELETE" });
      pickerItem.setAttribute("aria-pressed", String(active));
      pickerItem.lastElementChild.textContent = active ? "Đã thêm" : "Thêm";
      status.textContent = active
        ? "Đã thêm vào bộ sưu tập."
        : "Đã bỏ khỏi bộ sưu tập.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      pickerItem.disabled = false;
    }
    return;
  }
  const format = event.target.closest("[data-format]");
  const reset = event.target.closest("[data-browse-reset]");
  const topic = event.target.closest("[data-topic]");
  if (format || reset || topic) {
    const form = (format || reset || topic).closest("#browse-form");
    if (reset) {
      form.elements.q.value = "";
      for (const select of form.querySelectorAll("select"))
        select.selectedIndex = 0;
    }
    if (format || reset)
      form.elements.kind.value = format?.dataset.format || "";
    if (topic) {
      const genre = form.elements.namedItem("genre:" + topic.dataset.topic);
      if (genre) genre.value = genre.value === "yes" ? "" : "yes";
    }
    for (const choice of form.querySelectorAll("[data-format]")) {
      choice.setAttribute(
        "aria-pressed",
        String(choice.dataset.format === form.elements.kind.value),
      );
    }
    filterBrowse(form);
    return;
  }
  const quickSave = event.target.closest("[data-quick-save]");
  if (quickSave) {
    if (!user) {
      afterLogin = browseRoute();
      notice("Đăng nhập để lưu tác phẩm.");
      go("login");
      return;
    }
    const id = quickSave.dataset.quickSave;
    const wasSaved = savedForBrowse.has(id);
    quickSave.disabled = true;
    try {
      await api("catalog/" + encodeURIComponent(id) + "/save", {
        method: wasSaved ? "DELETE" : "PUT",
      });
      if (wasSaved) savedForBrowse.delete(id);
      else savedForBrowse.add(id);
      const current = app.querySelector(
        '[data-quick-save="' + CSS.escape(id) + '"]',
      );
      if (current) {
        current.setAttribute("aria-pressed", String(!wasSaved));
        current.textContent = wasSaved ? "Lưu" : "Đã lưu";
      }
      notice(wasSaved ? "Đã bỏ lưu tác phẩm." : "Đã thêm vào Xem sau.");
    } catch (error) {
      notice(error.message);
    } finally {
      quickSave.disabled = false;
    }
    return;
  }
  const infoToggle = event.target.closest("[data-card-info]");
  if (infoToggle) {
    const open = infoToggle.getAttribute("aria-expanded") !== "true";
    infoToggle.setAttribute("aria-expanded", String(open));
    infoToggle
      .closest(".catalog-compact-card")
      .classList.toggle("is-info-open", open);
    return;
  }
  const videoToggle = event.target.closest("[data-video-toggle]");
  if (videoToggle) {
    const video = videoToggle.closest(".video-card").querySelector("video");
    if (video.paused) playCardVideo(video);
    else video.pause();
    return;
  }
  const uploadControl = event.target.closest("[data-upload-action]");
  if (uploadControl) {
    const form = uploadControl.closest("#upload-form");
    if (!form || uploadState.busy) return;
    const { uploadAction, index } = uploadControl.dataset;
    if (uploadAction === "add") {
      form.querySelector("#upload-picker").click();
      return;
    }
    if (uploadAction === "preview-time") {
      useCurrentPreviewTime(uploadControl);
      return;
    }
    const entry = uploadState.files[Number(index)];
    if (!entry) return;
    const feedback = form.querySelector("#upload-feedback");
    feedback.textContent = "";
    if (uploadAction === "cover") {
      if (entry.premium)
        feedback.textContent =
          "Tệp đã được chuyển sang công khai vì được chọn làm đại diện.";
      entry.premium = false;
      uploadState.cover = entry;
    } else if (uploadAction === "remove") {
      if (!entry.id) URL.revokeObjectURL(entry.preview);
      uploadState.files.splice(Number(index), 1);
      if (entry === uploadState.cover) {
        uploadState.cover =
          uploadState.files.find((file) => !file.video && !file.premium) ||
          uploadState.files.find((file) => !file.video) ||
          uploadState.files[0] ||
          null;
        if (uploadState.cover?.premium) {
          uploadState.cover.premium = false;
          feedback.textContent =
            "Tệp đại diện mới đã được chuyển sang công khai.";
        }
      }
    }
    renderUploadFiles(form);
    const selector =
      uploadAction === "remove"
        ? "#upload-add"
        : '[data-upload-action="cover"][data-index="' + index + '"]';
    form.querySelector(selector)?.focus({ preventScroll: true });
    return;
  }
  const arrow = event.target.closest("[data-gallery-step]");
  if (arrow && currentMedia.length > 1) {
    const direction = arrow.dataset.galleryStep;
    const step = direction === "back" ? -1 : 1;
    galleryIndex =
      (galleryIndex + step + currentMedia.length) % currentMedia.length;
    updateGallery(direction);
    scheduleGallery();
    document
      .querySelector(`[data-gallery-step="${direction}"]`)
      ?.focus({ preventScroll: true });
    return;
  }
  const media = event.target.closest("[data-media]");
  if (media) {
    const nextIndex = Number(media.dataset.media);
    if (nextIndex === galleryIndex) return;
    const direction = nextIndex < galleryIndex ? "back" : "forward";
    galleryIndex = nextIndex;
    updateGallery(direction);
    scheduleGallery();
    document
      .querySelector('[data-media="' + galleryIndex + '"]')
      ?.focus({ preventScroll: true });
    return;
  }
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const { action, id, next } = control.dataset;
  if (action === "cycle") {
    const enabled = !cycleOverrides.get(galleryPost);
    cycleOverrides.set(galleryPost, enabled);
    control.setAttribute("aria-pressed", String(enabled));
    control.textContent = enabled ? "Dừng tự chuyển" : "Tự chuyển mỗi 10 giây";
    scheduleGallery();
    return;
  }
  if (["next", "previous"].includes(action)) {
    const form = app.querySelector("#browse-form");
    if (!form || app.querySelector("#browse-results").hasAttribute("aria-busy"))
      return;
    filters.offset += action === "next" ? 25 : -25;
    updateBrowse(form);
    return;
  }
  if (action === "login" || !user) {
    afterLogin =
      id && action === "login" ? id : location.hash.slice(1) || "account";
    go("login");
    return;
  }
  if (action === "like" || action === "unlike")
    return togglePostLike(control, id);
  if (action === "collection-add") return openCollectionPicker(id);
  if (action === "test-purchase" || action === "check-purchase")
    return handlePurchase(
      {
        api,
        json,
        notice,
        render,
        getSelectedMedia: () => ({
          selected: currentMedia[galleryIndex],
          firstPremium: currentMedia.find((file) => file.premium),
        }),
      },
      control,
    );
  if (action === "admin-edit-money") {
    const row = control.closest("tr");
    const name = row.querySelector("[data-account-alias]").textContent;
    const email = row.querySelector("[data-account-email]").textContent;
    const dialog = document.createElement("dialog");
    dialog.className = "surface collection-picker admin-credit-dialog";
    dialog.setAttribute("aria-labelledby", "admin-credit-title");
    dialog.innerHTML = `<header><h2 id="admin-credit-title">Điều chỉnh số dư</h2></header>
      <p>Tài khoản nhận <strong>${esc(name)}</strong><br><span class="muted">${esc(email)}</span></p>
      <p>Số dư hiện tại <strong>${money(next)}</strong></p>
      <form id="admin-credit-form" data-id="${esc(id)}" data-balance="${esc(next)}">
        <label>Số dư mới (₫)<input name="balance" type="number" value="${esc(next)}" min="0" max="1000000000" step="1" required autofocus></label>
        <div class="button-row"><button type="submit" class="btn dark">Lưu số dư</button>
          <button type="button" class="btn light" data-admin-credit-close>Hủy</button></div>
        <p class="muted" role="status"></p>
      </form>`;
    app.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    dialog.showModal();
    return;
  }
  control.disabled = true;
  try {
    if (action === "logout") {
      await api("logout", { method: "POST" });
      user = null;
      go("home");
      return;
    }
    if (action === "publish") {
      await api("publish/" + id, { method: "PUT" });
      notice(
        "Đã phát hành. Mọi người có thể tìm thấy tác phẩm trong mục Khám phá.",
      );
    }
    if (action === "remove-post") {
      const draft = next === "DRAFT";
      const message = draft
        ? "Xóa vĩnh viễn bản nháp và các tệp của tác phẩm này?"
        : "Gỡ tác phẩm khỏi Khám phá? Người đã mua vẫn xem được tệp của họ.";
      if (!window.confirm(message)) {
        control.disabled = false;
        return;
      }
      const result = await json("manage-post/" + id, "DELETE", {
        status: next,
      });
      notice(
        result.status === "DELETED"
          ? "Đã xóa bản nháp."
          : "Đã gỡ tác phẩm khỏi mục Khám phá.",
      );
      go("account/posts");
      return;
    }
    if (["save", "unsave"].includes(action)) {
      const remove = action.startsWith("un");
      await api("catalog/" + id + "/" + (remove ? action.slice(2) : action), {
        method: remove ? "DELETE" : "PUT",
      });
    }
    if (action === "collection-remove") {
      await api(
        `collections/${encodeURIComponent(next)}/posts/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      notice("Đã bỏ tác phẩm khỏi bộ sưu tập.");
    }
    if (action === "admin-post") {
      let reason;
      if (next === "HIDE" || next === "TAKEDOWN") {
        const message =
          next === "HIDE"
            ? "Ẩn tạm và dừng bán. Người mua cũ vẫn xem được. Nhập lý do:"
            : "Gỡ do vi phạm sẽ chặn cả người đã mua. Nhập lý do để xác nhận:";
        reason = window.prompt(message);
        if (reason === null) {
          control.disabled = false;
          return;
        }
      }
      await json(action + "/" + id, "PUT", { action: next, reason });
      notice("Đã cập nhật kiểm duyệt.");
    } else if (action === "admin-account-status") {
      const disabled = next === "disable";
      if (
        disabled &&
        !window.confirm(
          "Khóa tài khoản này và kết thúc các phiên đang đăng nhập?",
        )
      ) {
        control.disabled = false;
        return;
      }
      await json("admin-accounts/" + encodeURIComponent(id), "PUT", {
        disabled,
      });
      if (!control.isConnected) return;
      notice(disabled ? "Đã khóa tài khoản." : "Đã mở khóa tài khoản.");
    } else if (action.startsWith("admin-")) {
      await json(
        action + "/" + id,
        "PUT",
        action === "admin-genre"
          ? { enabled: next === "true" }
          : { status: next },
      );
    }
    render();
  } catch (error) {
    notice(error.message);
    control.disabled = false;
  }
});
app.addEventListener("change", (event) => {
  const field = event.target;
  if (field.form?.id === "revenue-period" && field.name === "period") {
    const { year, month } = field.form.elements;
    year.closest("label").hidden = year.disabled = field.value === "all";
    month.closest("label").hidden = month.disabled = field.value !== "month";
  }
  if (field.form?.id === "revenue-filters" && field.name === "sort")
    filterRevenue(field.form);
  if (field.form?.id === "purchase-filter") filterPurchases(field.form);
  if (field.form?.id === "browse-form" && field.matches("select"))
    filterBrowse(field.form);
  const form = field.closest("#upload-form");
  if (!form) return;
  if (field.id === "upload-picker") {
    addUploadFiles(form, [...field.files]);
    field.value = "";
  }
  if (field.hasAttribute("data-upload-premium")) {
    const index = Number(field.dataset.uploadPremium);
    const entry = uploadState.files[index];
    if (!entry || entry === uploadState.cover || uploadState.busy) return;
    entry.premium = field.checked;
    renderUploadFiles(form);
    form
      .querySelector('[data-upload-premium="' + index + '"]')
      ?.focus({ preventScroll: true });
  }
});
app.addEventListener(
  "loadedmetadata",
  (event) => {
    if (event.target.matches?.("[data-upload-video]"))
      syncUploadVideo(event.target);
  },
  true,
);
app.addEventListener(
  "timeupdate",
  (event) => {
    if (event.target.matches?.("[data-upload-video]"))
      rememberUploadTime(event.target);
  },
  true,
);

app.addEventListener("input", (event) => {
  if (event.target.form?.id === "own-post-search") searchOwnPosts(event.target);
  if (event.target.form?.id === "revenue-filters" && event.target.name === "q")
    filterRevenue(event.target.form, 250);
  if (event.target.form?.id === "purchase-filter" && event.target.name === "q")
    filterPurchases(event.target.form);
  if (event.target.matches("[data-preview-start]")) {
    const entry = uploadState.files[Number(event.target.dataset.previewStart)];
    if (entry) entry.previewStart = event.target.value;
    event.target
      .closest(".upload-file")
      .querySelector("[data-preview-feedback]").textContent = "";
  }
  if (event.target.name === "q" && event.target.form?.id === "browse-form")
    filterBrowse(event.target.form, 300);
  if (event.target.name === "price" && event.target.form?.id === "upload-form")
    uploadPriceSummary(event.target.form);
});
app.addEventListener("dragover", (event) => {
  const zone = event.target.closest("#upload-drop");
  if (!zone || !event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = uploadState.busy ? "none" : "copy";
  if (!uploadState.busy) zone.classList.add("drag-active");
});
app.addEventListener("dragleave", (event) => {
  const zone = event.target.closest("#upload-drop");
  if (zone && !zone.contains(event.relatedTarget))
    zone.classList.remove("drag-active");
});
app.addEventListener("drop", (event) => {
  const zone = event.target.closest("#upload-drop");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("drag-active");
  addUploadFiles(zone.closest("form"), [...event.dataTransfer.files]);
});
app.addEventListener(
  "error",
  (event) => {
    if (
      event.target.matches?.(".purchase-cover img, .admin-post-preview img")
    ) {
      event.target.hidden = true;
      return;
    }
    if (
      event.target.matches?.(
        ".gallery-thumb-poster, .collection-cover-pane img, .revenue-thumb img",
      )
    ) {
      const image = event.target;
      if (image.dataset.fallback) {
        image.src = image.dataset.fallback;
        delete image.dataset.fallback;
      } else image.hidden = true;
      return;
    }
    const cover = event.target.closest?.(".own-post-cover");
    if (!cover) return;
    event.target.hidden = true;
    cover.querySelector("span").hidden = false;
  },
  true,
);

document.addEventListener(
  "error",
  (event) => {
    if (event.target.matches?.(".user-avatar img")) event.target.hidden = true;
  },
  true,
);

document.querySelector("#global-search").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  go(
    browseRoute({ ...browseDefaults(), q: String(data.get("q") || "").trim() }),
  );
});

const pendingTopups = new Map();
function topupRequestId(key, clear = false) {
  if (clear) {
    pendingTopups.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {}
    return;
  }
  let id = pendingTopups.get(key);
  try {
    id ??= sessionStorage.getItem(key);
  } catch {}
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  pendingTopups.set(key, id);
  try {
    sessionStorage.setItem(key, id);
  } catch {}
  return id;
}

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target,
    data = new FormData(form);
  if (form.id === "revenue-filters") {
    filterRevenue(form);
    return;
  }
  if (form.id === "revenue-period") {
    const filters = app.querySelector("#revenue-filters");
    data.set("q", filters.elements.q.value.trim());
    data.set("sort", filters.elements.sort.value);
    go("account/revenue?" + new URLSearchParams(data));
    return;
  }
  if (form.id === "admin-accounts-search") {
    const params = new URLSearchParams();
    for (const [name, value] of data) {
      if (value.trim()) params.set(name, value.trim());
    }
    go("admin/accounts" + (params.size ? "?" + params : ""));
    return;
  }
  if (form.id === "own-post-search") {
    searchOwnPosts(form.elements.q, 0);
    return;
  }
  if (form.id === "browse-form") {
    filterBrowse(form);
    return;
  }
  if (form.id === "purchase-filter") return filterPurchases(form);
  if (form.id === "comments-form") return addPostComment(form);
  if (
    form.id === "verify-form" &&
    event.submitter?.value === "resend" &&
    !form.elements.email.reportValidity()
  )
    return;
  const status = form.querySelector("[role=status]");
  const buttons = [
    ...form.querySelectorAll("button[type=submit], button:not([type])"),
  ].filter((button) => !button.disabled);
  if (!buttons.length) return;
  buttons.forEach((button) => {
    button.disabled = true;
  });
  status.textContent = "Đang xử lý…";
  try {
    if (form.id === "verify-form") {
      const operation =
        event.submitter?.value === "resend" ? "resend" : "verify";
      const result = await json(operation, "POST", Object.fromEntries(data));
      if (operation === "verify" && form.isConnected) {
        go("login");
        notice(result.message);
      } else {
        status.textContent = result.message;
      }
    } else if (form.id === "register-form") {
      await json("register", "POST", Object.fromEntries(data));
      verificationEmail = String(data.get("email"));
      go("verify");
      notice("Đã gửi mã xác minh tới email.");
    } else if (form.id === "login-form") {
      user = await json("login", "POST", Object.fromEntries(data));
      const route = afterLogin;
      afterLogin = "account";
      go(route);
    } else if (form.id === "upload-form") {
      if (uploadState.busy) return;
      const payload = buildUploadPayload(form);
      uploadState.busy = true;
      status.textContent = uploadState.files.some((entry) => entry.premium)
        ? "Đang lưu bản nháp và chuẩn bị bản xem trước Premium…"
        : "Đang tải tệp và lưu bản nháp…";
      const fields = form.querySelector(".upload-fields");
      fields.disabled = true;
      let result;
      const draftId = form.dataset.postId;
      try {
        result = await api(draftId ? "edit-draft/" + draftId : "upload", {
          method: draftId ? "PUT" : "POST",
          body: payload,
        });
      } finally {
        uploadState.busy = false;
        fields.disabled = false;
      }
      clearUploadFiles();
      notice("Đã lưu bản nháp.");
      go("post/" + result.postId);
    } else if (form.id === "published-edit") {
      await json("manage-post/" + form.dataset.id, "PUT", {
        title: data.get("title"),
        description: data.get("description"),
        genreId: data.get("genre"),
        coverId: data.get("cover"),
        autoCycle: data.has("autoCycle"),
        revision: data.get("revision"),
      });
      cycleOverrides.delete(form.dataset.id);
      notice("Đã lưu thay đổi.");
      go("post/" + form.dataset.id);
    } else if (form.id === "profile-form") {
      const userId = user.id;
      const image = data.get("avatar");
      const payload = {
        displayName: data.get("displayName"),
        bio: data.get("bio"),
      };
      if (image?.size) payload.avatarJpeg = await avatarPayload(image);
      else if (data.has("removeAvatar")) payload.avatarJpeg = null;
      if (user?.id !== userId) return;
      const profile = await json("profile", "PUT", payload);
      if (user?.id !== userId) return;
      user = { ...user, ...profile };
      notice("Đã lưu hồ sơ.");
      render();
    } else if (form.id === "admin-credit-form") {
      const balance = Number(data.get("balance"));
      const expectedBalance = Number(form.dataset.balance);
      const targetId = form.dataset.id;
      const key = `pck-admin-balance-${user.id}-${targetId}-${expectedBalance}-${balance}`;
      let result;
      try {
        result = await json(
          "admin-accounts/" + encodeURIComponent(targetId) + "/balance",
          "POST",
          {
            balance,
            expectedBalance,
            requestId: topupRequestId(key),
          },
        );
      } catch (error) {
        if (error.status >= 400 && error.status < 500 && error.status !== 408)
          topupRequestId(key, true);
        if (error.status === 409 && form.isConnected) {
          form.closest("dialog").close();
          notice(error.message);
          render();
          return;
        }
        throw error;
      }
      topupRequestId(key, true);
      if (!form.isConnected) return;
      form.closest("dialog").close();
      notice(`Số dư demo hiện tại là ${money(result.balanceVnd)}.`);
      render();
    } else if (form.id === "wallet-topup-form") {
      const amount = Number(data.get("amount"));
      const stripe = event.submitter?.value === "stripe";
      const key = `pck-topup-${stripe ? "stripe-" : ""}${user.id}-${amount}`;
      try {
        const result = await json(
          stripe ? "wallet/stripe-checkout" : "wallet/top-up",
          "POST",
          { amount, requestId: topupRequestId(key) },
        );
        if (stripe) {
          const url = new URL(result.url);
          if (
            url.protocol !== "https:" ||
            url.hostname !== "checkout.stripe.com"
          )
            throw new Error("Địa chỉ Stripe Checkout không hợp lệ.");
          topupRequestId(key, true);
          location.assign(url.href);
          return;
        }
      } catch (error) {
        if (error.status >= 400 && error.status < 500 && error.status !== 408)
          topupRequestId(key, true);
        throw error;
      }
      topupRequestId(key, true);
      if (!form.isConnected) return;
      notice(`Đã nạp thử ${money(amount)}.`);
      render();
    } else if (form.id === "collection-rename-form") {
      await json("collections/" + encodeURIComponent(form.dataset.id), "PUT", {
        title: data.get("title"),
      });
      if (!form.isConnected) return;
      notice("Đã đổi tên bộ sưu tập.");
      render();
    } else if (form.id === "collection-picker-create") {
      const dialog = form.closest("dialog");
      const collection = await json("collections", "POST", {
        title: data.get("title"),
        posts: [dialog.dataset.postId],
      });
      if (!dialog.isConnected) return;
      form.reset();
      status.innerHTML = `Đã tạo bộ sưu tập và thêm tác phẩm. <a href="#collection/${encodeURIComponent(collection.id)}">Mở bộ sưu tập</a>`;
      await refreshCollectionPicker(dialog).catch((error) => {
        dialog.querySelector("[data-picker-status]").textContent =
          error.message;
      });
    } else if (form.id === "collection-form") {
      const picker = form.querySelector("fieldset");
      picker.disabled = true;
      try {
        const group = await json("collections", "POST", {
          title: data.get("title"),
          description: data.get("description"),
          posts: data.getAll("posts"),
        });
        if (form.isConnected) go("collection/" + group.id);
      } finally {
        picker.disabled = false;
      }
    } else if (form.id === "genre-form") {
      await json("admin-genres", "POST", { name: data.get("name") });
      notice("Đã thêm thể loại.");
      render();
    } else if (Object.hasOwn(form.dataset, "eventId")) {
      const id = form.dataset.eventId;
      await json(
        id ? "admin-event/" + id : "admin-events",
        id ? "PUT" : "POST",
        {
          title: data.get("title"),
          description: data.get("description"),
          enabled: data.has("enabled"),
          posts: data.getAll("posts"),
        },
      );
      notice("Đã lưu sự kiện.");
      render();
    } else {
      await json("catalog/" + form.dataset.id + "/report", "POST", {
        text: data.get("text"),
      });
      notice("Đã gửi báo cáo.");
      render();
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
});
setupTheme();
window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
});
api("session")
  .then((result) => {
    user = result.user;
  })
  .catch(() => {})
  .finally(render);
