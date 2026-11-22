import { avatar, money } from "./account-extras.js";

const roles = { USER: "Người dùng", ADMIN: "Quản trị viên" };
const statuses = {
  ACTIVE: "Đang hoạt động",
  PENDING_VERIFICATION: "Chờ xác minh",
  DISABLED: "Đã khóa",
};
const joinedOn = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short" });
const amountLabel = (amount) => (amount == null ? "-" : money(amount));

function pagination(page, hasNext, pageUrl, link, label) {
  return page > 1 || hasNext
    ? `<nav class="admin-account-pager" aria-label="${label}">
    ${page > 1 ? link("Trang trước", pageUrl(page - 1)) : ""}
    <span>Trang ${page}</span>
    ${hasNext ? link("Trang sau", pageUrl(page + 1)) : ""}
  </nav>`
    : "";
}

async function accountsView({ api, esc, empty, button, link }, params) {
  const q = (params.get("q") || "").slice(0, 100);
  const status = params.get("status") || "";
  const role = params.get("role") || "";
  const select = (values, selected) =>
    Object.entries(values)
      .map(
        ([value, label]) =>
          `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`,
      )
      .join("");
  const filters = `<form id="admin-accounts-search" class="surface admin-account-filters" role="search" aria-label="Tìm tài khoản">
    <label>Tên hoặc email<input name="q" type="search" maxlength="100" value="${esc(q)}" placeholder="Tìm tên hoặc email"></label>
    <label><span id="admin-account-role-label">Vai trò</span><select name="role" aria-labelledby="admin-account-role-label"><option value="">Tất cả</option>${select(roles, role)}</select></label>
    <label><span id="admin-account-status-label">Trạng thái</span><select name="status" aria-labelledby="admin-account-status-label"><option value="">Tất cả</option>${select(statuses, status)}</select></label>
    <button class="btn dark" type="submit">Tìm</button>
  </form>`;
  const pageUrl = (page) => {
    const filters = new URLSearchParams({ q, role, status, page });
    for (const key of ["q", "role", "status"]) {
      if (!filters.get(key)) filters.delete(key);
    }
    return "#admin/accounts?" + filters;
  };
  let result;
  try {
    result = await api(
      "admin-accounts?" +
        new URLSearchParams({ q, role, status, page: params.get("page") || 1 }),
    );
  } catch (error) {
    return (
      filters +
      empty(error.message) +
      link("Thử lại", pageUrl(params.get("page") || 1))
    );
  }
  const { accounts, page, hasNext, metricsAvailable } = result;
  const rows = accounts
    .map((account) => {
      const canChange =
        account.role === "USER" &&
        ["ACTIVE", "DISABLED"].includes(account.status);
      const locked = account.status === "DISABLED";
      const metrics = `<dl class="admin-account-metrics">
      <div><dt>Đã đăng</dt><dd>${account.postCount ?? "-"}</dd></div>
      <div><dt>Doanh thu demo</dt><dd>${amountLabel(account.revenueVnd)}</dd></div>
      <div><dt>Số dư demo</dt><dd>${amountLabel(account.balanceVnd)}</dd></div>
    </dl>`;
      return `<tr>
      <th scope="row"><div class="admin-account-identity">${avatar(account, esc)}<div><strong data-account-alias>${esc(account.alias)}</strong><small data-account-email>${esc(account.email)}</small><small class="admin-account-role-mobile">${esc(roles[account.role])}</small></div></div><div class="admin-account-metrics-mobile">${metrics}</div></th>
      <td class="admin-account-role">${esc(roles[account.role])}</td>
      <td><span class="admin-account-status" data-state="${esc(account.status)}">${esc(statuses[account.status])}</span></td>
      <td class="admin-account-date">${joinedOn.format(new Date(account.createdAt))}</td>
      <td class="admin-account-metrics-cell">${metrics}</td>
      <td class="admin-account-action"><div class="admin-account-actions">
        ${account.status === "ACTIVE" && account.balanceVnd != null ? button("Điều chỉnh số dư", "admin-edit-money", account.id, account.balanceVnd) : ""}
        ${canChange ? button(locked ? "Mở khóa" : "Khóa", "admin-account-status", account.id, locked ? "enable" : "disable") : ""}
      </div></td>
    </tr>`;
    })
    .join("");
  const list = rows
    ? `<div class="surface admin-account-directory" tabindex="0" role="region" aria-label="Danh sách tài khoản">
    <table>
      <thead><tr><th scope="col">Tài khoản</th><th scope="col" class="admin-account-role">Vai trò</th><th scope="col">Trạng thái</th><th scope="col" class="admin-account-date">Ngày tạo</th><th scope="col" class="admin-account-metrics-cell">Thống kê</th><th scope="col" class="admin-account-action">Thao tác</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
    : empty("Không tìm thấy tài khoản phù hợp.");
  const warning = metricsAvailable
    ? ""
    : '<p class="muted" role="status">Một số số liệu tài khoản tạm thời chưa có.</p>';
  return (
    filters +
    warning +
    list +
    pagination(page, hasNext, pageUrl, link, "Trang danh sách tài khoản")
  );
}

async function postsView(
  { api, esc, empty, link, postLink, postStatus, moderationButtons },
  params,
) {
  const { posts, page, hasNext, salesAvailable } = await api(
    "admin-posts?" + new URLSearchParams({ page: params.get("page") || 1 }),
  );
  const rows = posts
    .map((post) => {
      const preview =
        post.cover_id && post.moderation_state !== "TAKEN_DOWN"
          ? `<img alt="" loading="lazy" src="/api/demo/media/${encodeURIComponent(post.cover_id)}${post.cover_kind === "VIDEO" ? "?thumbnail=1" : ""}">`
          : "";
      return `<li><a class="admin-post-heading" href="${postLink(post)}"><span class="admin-post-preview"><span>-</span>${preview}</span>
      <span><strong>${esc(post.title)}</strong><small>${esc(postStatus(post))}</small></span></a>
      <div class="admin-post-revenue"><strong>${salesAvailable ? money(post.revenueVnd) : "-"}</strong>
        <span>${salesAvailable ? `${post.paidCount} đơn đã thanh toán` : "Không thể tải doanh thu"}</span></div>
      <div class="button-row">${moderationButtons(post)}</div></li>`;
    })
    .join("");
  return (
    (rows
      ? `<ul class="surface admin-post-list" aria-label="Doanh thu demo theo tác phẩm">${rows}</ul>`
      : empty("Chưa có tác phẩm nào.")) +
    pagination(
      page,
      hasNext,
      (p) => "#admin/posts?page=" + p,
      link,
      "Trang danh sách tác phẩm",
    )
  );
}

export async function admin(
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
  tab = "overview",
  params = new URLSearchParams(),
) {
  if (user?.role !== "ADMIN")
    return heading(
      "Khu vực quản trị",
      "Đăng nhập bằng tài khoản quản trị viên.",
      link("Tài khoản", "#account"),
    );
  const data = ["accounts", "posts"].includes(tab) ? null : await api("admin");
  const list = (rows, format, msg) =>
    rows.length
      ? `<ul class="real-list surface">${rows.map(format).join("")}</ul>`
      : empty(msg);
  const eventForm = (
    event = { title: "", description: "", enabled: false, posts: [] },
  ) => `<form class="surface edit-form" data-event-id="${esc(event.id || "")}">
  <label>Tên sự kiện<input name="title" maxlength="80" required value="${esc(event.title)}"></label><label>Mô tả<textarea name="description" maxlength="240">${esc(event.description)}</textarea></label>
  <label class="check"><input type="checkbox" name="enabled" ${event.enabled ? "checked" : ""}> Hiện trên trang chủ</label>
  <fieldset><legend>Tác phẩm đã phát hành</legend>${data.posts
    .filter((p) => p.status === "PUBLISHED" || event.posts.includes(p.id))
    .map(
      (p) =>
        `<label class="check"><input type="checkbox" name="posts" value="${esc(p.id)}" ${event.posts.includes(p.id) ? "checked" : ""}> ${esc(p.title)}${p.status === "HIDDEN" ? " | Đã ẩn" : ""}</label>`,
    )
    .join("")}</fieldset>
  <button class="btn dark">${event.id ? "Lưu sự kiện" : "Tạo sự kiện"}</button><p role="status"></p></form>`;
  const views = {
    accounts: () => accountsView({ api, esc, empty, button, link }, params),
    overview: () =>
      `<div class="stats admin-overview-stats">${[
        [data.totals.posts, "Tổng tác phẩm"],
        [data.totals.published, "Đã phát hành"],
        [data.totals.premium, "Premium công khai"],
        [data.paid, "Đơn đã thanh toán"],
        [money(data.revenueVnd), "Tổng doanh thu demo"],
      ]
        .map(
          ([count, label]) =>
            `<div class="surface"><strong>${count}</strong><span>${label}</span></div>`,
        )
        .join("")}</div>`,
    posts: () =>
      postsView(
        { api, esc, empty, link, postLink, postStatus, moderationButtons },
        params,
      ),
    genres: () =>
      `<form class="surface edit-form" id="genre-form"><label>Tên thể loại<input name="name" required maxlength="60"></label><button class="btn dark">Thêm thể loại</button><p role="status"></p></form>` +
      list(
        data.genres,
        (g) =>
          `<li>${esc(g.name)}${button(g.enabled ? "Tạm dừng" : "Bật lại", "admin-genre", g.id, !g.enabled)}</li>`,
        "Chưa có thể loại.",
      ),
    events: () =>
      `<div class="event-editors">${eventForm()}${data.events.map(eventForm).join("")}</div>`,
    reports: () =>
      list(
        data.reports,
        (r) =>
          `<li><a href="#post/${encodeURIComponent(r.post_id)}">${esc(r.reason)}</a>${button("Đóng báo cáo", "admin-report", r.id, "DISMISSED")}</li>`,
        "Chưa có báo cáo đang chờ.",
      ),
  };
  const tabs = [
    ["overview", "Tổng quan"],
    ["accounts", "Tài khoản"],
    ["posts", "Tác phẩm"],
    ["genres", "Thể loại"],
    ["events", "Sự kiện"],
    ["reports", "Báo cáo"],
  ];
  return `<div class="admin-layout"><aside class="admin-sidebar"><a class="logo" href="#admin">PCK<span>.</span></a><nav>${tabs.map(([id, label]) => `<a href="#admin/${id}" ${id === tab ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
 <a class="admin-exit" href="#home">← Về trang người dùng</a></aside><div class="admin-content">${heading(tabs.find(([id]) => id === tab)?.[1] || "Tổng quan")}${Object.hasOwn(views, tab) ? await views[tab]() : views.overview()}</div></div>`;
}
