export function createCollectionBuilder({ getUser, loginRequired, heading, esc, kindNames, api }) {
function newCollection() {
  if (!getUser()) return loginRequired("Đăng nhập để tạo bộ sưu tập.");
  return (
    heading("Tạo bộ sưu tập") +
    `<form id="collection-form" class="surface edit-form collection-builder">
      <label>Tên bộ sưu tập<input name="title" required maxlength="80"></label>
      <label>Mô tả<textarea name="description" maxlength="240" rows="2"></textarea></label>
      <fieldset class="collection-builder-picker">
        <legend>Chọn tác phẩm</legend>
        <div class="collection-builder-search">
          <label>Tìm tác phẩm<input data-collection-search type="search" maxlength="100" placeholder="Tìm theo tên, mô tả hoặc thể loại"></label>
          <p class="muted" data-collection-count aria-live="polite">Đã chọn 0/25</p>
        </div>
        <ul class="collection-builder-selected" aria-label="Tác phẩm đã chọn" hidden></ul>
        <p class="muted" data-collection-results-status aria-live="polite"></p>
        <div class="collection-builder-grid" data-collection-results></div>
        <button class="btn light" data-collection-more type="button" hidden>Xem thêm</button>
      </fieldset>
      <button class="btn dark" type="submit" disabled>Tạo bộ sưu tập</button><p role="status"></p>
    </form>`
  );
}

function wireCollectionBuilder(form) {
  const pageSize = 25;
  const maxSelected = 25;
  const search = form.querySelector("[data-collection-search]");
  const results = form.querySelector("[data-collection-results]");
  const feedback = form.querySelector("[data-collection-results-status]");
  const count = form.querySelector("[data-collection-count]");
  const selectedList = form.querySelector(".collection-builder-selected");
  const more = form.querySelector("[data-collection-more]");
  const submit = form.querySelector("[type=submit]");
  const selected = new Map();
  const visible = new Map();
  let nextOffset = 0;
  let timer, request;

  function syncChoices() {
    for (const checkbox of results.querySelectorAll(
      "[data-collection-choice]",
    )) {
      checkbox.checked = selected.has(checkbox.value);
      checkbox.disabled = !checkbox.checked && selected.size >= maxSelected;
    }
  }

  function updateSelection() {
    count.textContent = `Đã chọn ${selected.size}/${maxSelected}`;
    selectedList.hidden = !selected.size;
    selectedList.innerHTML = [...selected.values()]
      .map(
        (post) => `<li>
      <input type="hidden" name="posts" value="${esc(post.id)}">
      <button type="button" data-remove-choice="${esc(post.id)}" aria-label="Bỏ chọn ${esc(post.title)}">
        <span>${esc(post.title)}</span><span aria-hidden="true">×</span>
      </button></li>`,
      )
      .join("");
    syncChoices();
    submit.disabled = !selected.size;
  }

  function tile(post) {
    const media = post.cover_id
      ? "/api/demo/media/" + encodeURIComponent(post.cover_id)
      : "";
    const cover =
      media && post.cover_kind === "VIDEO" ? media + "?thumbnail=1" : media;
    const kinds = post.kinds ?? [];
    const type =
      kinds.includes("IMAGE") && kinds.includes("VIDEO")
        ? "Hỗn hợp"
        : kindNames[kinds[0]] || kindNames[post.cover_kind] || "";
    const meta = [type, post.genres?.[0]].filter(Boolean).join(" · ");
    return `<label class="collection-builder-tile">
      <span class="collection-builder-preview"><span>${post.cover_kind === "VIDEO" ? "Video" : "Chưa có ảnh xem trước"}</span>
        ${cover ? `<img src="${esc(cover)}" ${post.cover_kind === "VIDEO" ? `data-video-cover="${esc(media)}"` : ""} alt="" loading="lazy">` : ""}
      </span>
      <span class="collection-builder-caption">
        <input type="checkbox" data-collection-choice value="${esc(post.id)}" aria-label="${esc(post.title)}">
        <span><strong>${esc(post.title)}</strong>${meta ? `<small>${esc(meta)}</small>` : ""}</span>
      </span>
    </label>`;
  }

  async function load(append = false) {
    if (!form.isConnected) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const q = search.value.trim();
    const offset = append ? nextOffset : 0;
    more.hidden = true;
    results.setAttribute("aria-busy", "true");
    feedback.textContent = q ? "Đang tìm tác phẩm…" : "Đang tải tác phẩm…";
    try {
      const { posts } = await api(
        "catalog?" + new URLSearchParams({ q, offset }),
        { signal: controller.signal },
      );
      if (
        !form.isConnected ||
        request !== controller ||
        controller.signal.aborted
      )
        return;
      if (!append) {
        visible.clear();
        results.replaceChildren();
      }
      const fresh = posts.filter((post) => !visible.has(post.id));
      for (const post of fresh) visible.set(post.id, post);
      results.insertAdjacentHTML("beforeend", fresh.map(tile).join(""));
      syncChoices();
      feedback.textContent = !visible.size
        ? q
          ? "Không tìm thấy tác phẩm phù hợp."
          : "Chưa có tác phẩm đã phát hành."
        : append && !fresh.length
          ? "Đã xem hết kết quả."
          : "";
      nextOffset = offset + pageSize;
      more.textContent = "Xem thêm";
      more.onclick = () => load(true);
      more.hidden = posts.length < pageSize || nextOffset > 3000;
    } catch (error) {
      if (
        !form.isConnected ||
        request !== controller ||
        controller.signal.aborted
      )
        return;
      feedback.textContent = error.message;
      more.textContent = "Thử lại";
      more.onclick = () => load(append);
      more.hidden = false;
    } finally {
      if (request === controller && !controller.signal.aborted)
        results.removeAttribute("aria-busy");
    }
  }

  search.addEventListener("input", () => {
    clearTimeout(timer);
    request?.abort();
    more.hidden = true;
    feedback.textContent = "Đang tìm tác phẩm…";
    timer = setTimeout(() => load(), 250);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    clearTimeout(timer);
    load();
  });
  results.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!checkbox.matches("[data-collection-choice]")) return;
    if (checkbox.checked && selected.size < maxSelected)
      selected.set(checkbox.value, visible.get(checkbox.value));
    else if (!checkbox.checked) selected.delete(checkbox.value);
    updateSelection();
  });
  results.addEventListener(
    "error",
    (event) => {
      const media = event.target;
      if (media.matches?.("img[data-video-cover]")) {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.setAttribute("aria-hidden", "true");
        video.src = media.dataset.videoCover + "#t=0.1";
        media.replaceWith(video);
      } else if (media.matches?.("img, video")) media.hidden = true;
    },
    true,
  );
  selectedList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-choice]");
    if (!remove) return;
    selected.delete(remove.dataset.removeChoice);
    updateSelection();
    (selectedList.querySelector("button") || search).focus();
  });
  load();
}

  return { newCollection, wireCollectionBuilder };
}
