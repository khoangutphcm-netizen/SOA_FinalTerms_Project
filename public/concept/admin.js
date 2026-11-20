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
) {
  if (user?.role !== "ADMIN")
    return heading(
      "Khu vực quản trị",
      "Đăng nhập với tài khoản admin.",
      link("Tài khoản", "#account"),
    );
  const data = await api("admin");
  const list = (rows, format, msg) =>
    rows.length
      ? `<ul class="real-list surface">${rows.map(format).join("")}</ul>`
      : empty(msg);
  const eventForm = (
    event = { title: "", description: "", enabled: false, posts: [] },
  ) => `<form class="surface edit-form" data-event-id="${esc(event.id || "")}">
  <label>Tên sự kiện<input name="title" maxlength="80" required value="${esc(event.title)}"></label><label>Mô tả<textarea name="description" maxlength="240">${esc(event.description)}</textarea></label>
  <label class="check"><input type="checkbox" name="enabled" ${event.enabled ? "checked" : ""}> Hiện trên Trang chủ</label>
  <fieldset><legend>Bài đã phát hành</legend>${data.posts
    .filter((p) => p.status === "PUBLISHED" || event.posts.includes(p.id))
    .map(
      (p) =>
        `<label class="check"><input type="checkbox" name="posts" value="${esc(p.id)}" ${event.posts.includes(p.id) ? "checked" : ""}> ${esc(p.title)}${p.status === "HIDDEN" ? " · Đã ẩn" : ""}</label>`,
    )
    .join("")}</fieldset>
  <button class="btn dark">${event.id ? "Lưu sự kiện" : "Tạo sự kiện"}</button><p role="status"></p></form>`;
  const views = {
    overview: () =>
      `<div class="stats">${[
        [data.totals.posts, "Tổng bài"],
        [data.totals.published, "Đã phát hành"],
        [data.totals.premium, "Premium công khai"],
        [data.paid, "Đơn đã thanh toán"],
      ]
        .map(
          ([count, label]) =>
            `<div class="surface"><strong>${count}</strong><span>${label}</span></div>`,
        )
        .join("")}</div>`,
    posts: () =>
      list(
        data.posts,
        (p) =>
          `<li><a href="${postLink(p)}">${esc(p.title)}</a><span>${esc(postStatus(p))}</span>${moderationButtons(p)}</li>`,
        "Chưa có bài đăng.",
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
    ["posts", "Bài đăng"],
    ["genres", "Thể loại"],
    ["events", "Sự kiện"],
    ["reports", "Báo cáo"],
  ];
  return `<div class="admin-layout"><aside class="admin-sidebar"><a class="logo" href="#admin">PCK<span>.</span></a><nav>${tabs.map(([id, label]) => `<a href="#admin/${id}" ${id === tab ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
 <a class="admin-exit" href="#home">← Về trang người dùng</a></aside><div class="admin-content">${heading(tabs.find(([id]) => id === tab)?.[1] || "Tổng quan")}${Object.hasOwn(views, tab) ? views[tab]() : views.overview()}</div></div>`;
}
