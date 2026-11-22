export function createUploadTools(uploadState, esc) {
  function clearUploadFiles() {
    for (const entry of uploadState.files)
      if (!entry.id) URL.revokeObjectURL(entry.preview);
    uploadState.files.length = 0;
    uploadState.cover = null;
  }

  const fileSize = (bytes) =>
    bytes < 1024 * 1024
      ? Math.max(1, Math.round(bytes / 1024)) + " KiB"
      : (bytes / (1024 * 1024)).toFixed(1) + " MiB";

  const hasDuration = (seconds) => Number.isFinite(seconds) && seconds > 0;
  const maxPreviewStart = (seconds) =>
    hasDuration(seconds) ? Math.min(86400, Math.ceil(seconds) - 1) : 86400;
  const videoTime = (seconds) =>
    Math.floor(seconds / 60) +
    ":" +
    String(Math.floor(seconds % 60)).padStart(2, "0");

  function rememberUploadTime(video) {
    const entry = uploadState.files[Number(video.dataset.uploadVideo)];
    if (entry && Number.isFinite(video.currentTime))
      entry.playhead = video.currentTime;
  }

  function syncUploadVideo(video) {
    const entry = uploadState.files[Number(video.dataset.uploadVideo)];
    if (!entry || !hasDuration(video.duration)) return;
    entry.duration = video.duration;
    const card = video.closest(".upload-file");
    card.querySelector("[data-video-duration]").textContent =
      video.duration < 1
        ? "Dưới 1 giây"
        : "Thời lượng " + videoTime(video.duration);
    const input = card.querySelector("[data-preview-start]");
    if (input) {
      input.max = maxPreviewStart(video.duration);
      card.querySelector('[data-upload-action="preview-time"]').disabled =
        false;
    }
    if (entry.playhead > 0 && entry.playhead < video.duration) {
      video.currentTime = entry.playhead;
    }
  }

  function useCurrentPreviewTime(control) {
    const card = control.closest(".upload-file");
    const video = card.querySelector("[data-upload-video]");
    const input = card.querySelector("[data-preview-start]");
    const entry = uploadState.files[Number(control.dataset.index)];
    if (!entry?.premium || !video || !input || !hasDuration(video.duration))
      return;
    const second = Math.min(
      maxPreviewStart(video.duration),
      Math.floor(video.currentTime),
    );
    input.value = String(second);
    entry.previewStart = second;
    card.querySelector("[data-preview-feedback]").textContent =
      "Đã chọn mốc " + videoTime(second) + ".";
  }

  function uploadPriceSummary(form) {
    const count = uploadState.files.filter((entry) => entry.premium).length;
    const price = form.elements.price;
    form.querySelector("#upload-price").hidden = !count;
    price.disabled = !count;
    price.required = Boolean(count);
    form.querySelector("#upload-price-label").textContent =
      "Giá mua một lần cho " + count + " tệp Premium";
    form.querySelector("#upload-price-preview").textContent =
      price.value && Number(price.value) > 0
        ? Number(price.value).toLocaleString("vi-VN") + " ₫"
        : "";
  }

  function renderUploadFiles(form) {
    const container = form.querySelector("#upload-files");
    const total = uploadState.files.reduce(
      (sum, entry) => sum + entry.file.size,
      0,
    );
    form.querySelector("#upload-count").textContent =
      uploadState.files.length +
      "/8 tệp" +
      (total ? " | " + fileSize(total) : "");
    form.querySelector("#upload-add").disabled = uploadState.files.length >= 8;
    container.innerHTML = uploadState.files
      .map((entry, index) => {
        const cover = entry === uploadState.cover,
          name = esc(entry.file.name);
        const preview = !entry.preview
          ? "<span>Tệp không có bản xem trước</span>"
          : entry.video
            ? `<video src="${esc(entry.preview)}" data-upload-video="${index}" controls playsinline preload="metadata" aria-label="${name}"></video>`
            : `<img src="${esc(entry.preview)}" alt="${name}">`;
        return `<article class="upload-file">
   <div class="upload-preview">${preview}<span class="upload-chip">${cover ? "Đại diện" : entry.premium ? "Premium" : "Công khai"}</span></div>
   <div class="upload-file-meta"><strong title="${name}">${name}</strong><small>${entry.video ? "Video" : "Ảnh"} | ${fileSize(entry.file.size)}</small>${entry.video ? `<small data-video-duration>${hasDuration(entry.duration) ? "Thời lượng " + videoTime(entry.duration) : ""}</small>` : ""}</div>
   <div class="upload-file-actions">
    <button type="button" class="btn light" data-upload-action="cover" data-index="${index}" aria-label="Chọn ${name} làm đại diện" aria-pressed="${cover}">${cover ? "✓ Đại diện" : "Đặt đại diện"}</button>
    <button type="button" class="btn light" data-upload-action="remove" data-index="${index}" aria-label="Xóa ${name}">Xóa</button>
   </div>
   <label class="upload-switch"><input type="checkbox" role="switch" data-upload-premium="${index}" aria-label="Premium cho ${name}" ${entry.premium ? "checked" : ""} ${cover ? "disabled" : ""}>
   Premium ${cover ? "<small>Ảnh bìa công khai</small>" : ""}</label>
   ${
     entry.video && entry.premium
       ? `<div class="preview-time-controls"><label>Bắt đầu bản xem trước (giây)
    <input type="number" min="0" max="${maxPreviewStart(entry.duration)}" step="1" required name="previewStart:${index}" data-preview-start="${index}" value="${esc(entry.previewStart ?? 0)}">
    </label>
    <button type="button" class="btn light" data-upload-action="preview-time" data-index="${index}" disabled>Dùng mốc đang phát</button>
    <small>Tối đa 10 giây từ mốc đã chọn.</small><small data-preview-feedback aria-live="polite"></small></div>`
       : ""
   }
  </article>`;
      })
      .join("");
    uploadPriceSummary(form);
  }

  function addUploadFiles(form, selected) {
    if (uploadState.busy) return;
    const issues = new Set();
    let total = uploadState.files.reduce(
      (sum, entry) => sum + entry.file.size,
      0,
    );
    for (const file of selected) {
      if (!/\.(jpe?g|png|mp4)$/i.test(file.name) || !file.size) {
        issues.add("Chỉ nhận tệp JPG, PNG hoặc MP4 có dữ liệu.");
        continue;
      }
      if (
        uploadState.files.some(
          ({ file: old }) =>
            old.name === file.name &&
            old.size === file.size &&
            old.lastModified === file.lastModified,
        )
      ) {
        issues.add("Tệp đã có trong danh sách được bỏ qua.");
        continue;
      }
      if (uploadState.files.length >= 8) {
        issues.add("Chỉ thêm được tối đa 8 tệp.");
        break;
      }
      if (
        file.size > 10 * 1024 * 1024 ||
        total + file.size > 40 * 1024 * 1024
      ) {
        issues.add("Tối đa 10 MiB mỗi tệp và 40 MiB tổng cộng.");
        continue;
      }
      const entry = {
        file,
        preview: URL.createObjectURL(file),
        video: /\.mp4$/i.test(file.name),
        premium: false,
      };
      uploadState.files.push(entry);
      total += file.size;
      if (!uploadState.cover) uploadState.cover = entry;
    }
    form.querySelector("#upload-feedback").textContent = [...issues].join(" ");
    form.querySelector("[role=status][data-submit-result]").textContent = "";
    renderUploadFiles(form);
  }

  function buildUploadPayload(form) {
    if (!uploadState.files.length)
      throw new Error("Thêm ít nhất một ảnh hoặc video.");
    const marked = uploadState.files.flatMap((entry, index) =>
      entry.premium ? [index] : [],
    );
    const data = new FormData(form);
    data.set("cover", String(uploadState.files.indexOf(uploadState.cover)));
    let upload = 0;
    const entries = uploadState.files.map((entry) => {
      if (entry.id) return { id: entry.id };
      data.append("file", entry.file);
      return { upload: upload++ };
    });
    if (form.dataset.postId) data.set("entries", JSON.stringify(entries));
    for (const index of marked) data.append("premiumIndex", String(index));
    return data;
  }

  return {
    clearUploadFiles,
    uploadPriceSummary,
    renderUploadFiles,
    addUploadFiles,
    buildUploadPayload,
    syncUploadVideo,
    rememberUploadTime,
    useCurrentPreviewTime,
  };
}

export async function upload(
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
) {
  if (!user) return loginRequired("Đăng nhập để tải tệp lên.");
  const { genres } = await api("genres");
  const draft = id ? await api("manage-post/" + encodeURIComponent(id)) : null;
  if (draft?.post.status === "PUBLISHED") return publishedEditor(draft, genres);
  const post = draft?.post;
  const html =
    heading(
      post ? "Sửa bản nháp" : "Đăng tác phẩm",
      "Thêm ảnh hoặc video, chọn ảnh bìa và quyết định tệp nào cần trả phí.",
      post ? link("Hủy", postLink(post)) : "",
    ) +
    `<form id="upload-form" class="surface edit-form upload-form" ${post ? `data-post-id="${esc(post.id)}"` : ""}>
 <fieldset class="upload-fields">
 <input name="revision" type="hidden" value="${esc(post?.revision)}">
 <label>Tiêu đề<input name="title" maxlength="100" required value="${esc(post?.title)}"></label><label>Mô tả<textarea name="description" maxlength="1000" rows="3">${esc(post?.description)}</textarea></label>
 <label>Thể loại<select name="genre">${genreOptions(genres, draft?.genres)}</select></label>
 <section id="upload-drop" class="upload-drop" aria-label="Kéo thả tệp">
  <input id="upload-picker" type="file" multiple accept=".jpg,.jpeg,.png,.mp4" hidden>
  <button type="button" id="upload-add" class="btn dark" data-upload-action="add">+ Thêm ảnh/video</button>
  <span>Kéo và thả vào đây hoặc thêm tệp qua nhiều lượt</span>
  <small>JPG, PNG, MP4 | 8 tệp | 10 MiB/tệp | 40 MiB/bài</small>
 </section>
 <div class="upload-list-head"><strong>Tệp trong tác phẩm</strong><span id="upload-count" aria-live="polite">0/8 tệp</span></div>
 <p id="upload-feedback" class="upload-feedback" aria-live="polite"></p>
 <div id="upload-files" class="upload-files"></div>
 <label class="check"><input name="autoCycle" type="checkbox" ${post?.auto_cycle ? "checked" : ""}> Tự chuyển ảnh mỗi 7 giây khi mở tác phẩm</label>
 <section id="upload-price" class="upload-price" hidden><label><span id="upload-price-label"></span>
 <input name="price" type="number" min="1" max="100000000" step="1" inputmode="numeric" placeholder="Ví dụ: 39000" value="${Number(post?.price_vnd) || ""}" disabled></label>
 <output id="upload-price-preview" aria-live="polite"></output><small>Một mức giá bằng VND để mở toàn bộ tệp được bật Premium. Các tệp khác vẫn xem miễn phí.</small></section>
 <button type="submit" class="btn dark">${post ? "Lưu bản nháp" : "Tải lên và lưu nháp"}</button><p data-submit-result role="status" class="muted"></p>
 </fieldset></form>`;
  return { html, draft };
}
