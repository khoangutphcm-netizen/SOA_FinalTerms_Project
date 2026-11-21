export function createCollectionPages({ api, heading, link, grid, esc, card, button, empty, app }) {
async function groupPage(kind, id) {
  const { group, posts, canEdit } = await api(
    kind + "/" + encodeURIComponent(id),
  );
  const head = heading(
    group.title,
    group.description,
    canEdit ? link("Tìm thêm tác phẩm", "#browse") : "",
  );
  if (!canEdit) return head + grid(posts);
  return (
    head +
    `<form id="collection-rename-form" class="surface collection-rename" data-id="${esc(id)}">
    <label>Tên bộ sưu tập<input name="title" value="${esc(group.title)}" required maxlength="80"></label>
    <button type="submit" class="btn dark">Lưu tên</button><p role="status" class="muted"></p></form>` +
    (posts.length
      ? `<div class="grid">${posts.map((post) => `<div class="collection-owned-post">${card(post)}${button("Bỏ khỏi bộ", "collection-remove", post.id, id)}</div>`).join("")}</div>`
      : empty("Bộ sưu tập chưa có tác phẩm."))
  );
}

async function refreshCollectionPicker(dialog) {
  const list = dialog.querySelector(".collection-picker-list");
  const { collections } = await api(
    "my-collections?" + new URLSearchParams({ postId: dialog.dataset.postId }),
  );
  if (!dialog.isConnected) return;
  list.innerHTML = collections.length
    ? collections
        .map(
          (
            group,
          ) => `<li><button type="button" data-picker-collection="${esc(group.id)}"
    aria-pressed="${group.contains_post}"><span>${esc(group.title)}</span><span>${group.contains_post ? "Đã thêm" : "Thêm"}</span></button></li>`,
        )
        .join("")
    : "<li>Bạn chưa có bộ sưu tập.</li>";
}

async function openCollectionPicker(postId) {
  const dialog = document.createElement("dialog");
  dialog.className = "surface collection-picker";
  dialog.dataset.postId = postId;
  dialog.setAttribute("aria-labelledby", "collection-picker-title");
  dialog.innerHTML = `<header><h2 id="collection-picker-title">Thêm vào bộ sưu tập</h2><button class="btn light" type="button" data-collection-close aria-label="Đóng">×</button></header>
    <ul class="collection-picker-list"><li>Đang tải bộ sưu tập…</li></ul><p class="muted" data-picker-status role="status"></p>
    <form id="collection-picker-create"><label>Tên bộ mới<input name="title" maxlength="80" required></label><button class="btn dark" type="submit">Tạo và thêm</button><p class="muted" role="status"></p></form>`;
  app.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  try {
    await refreshCollectionPicker(dialog);
  } catch (error) {
    dialog.querySelector(".collection-picker-list").replaceChildren();
    dialog.querySelector("[data-picker-status]").textContent = error.message;
  }
}

  return { groupPage, refreshCollectionPicker, openCollectionPicker };
}
