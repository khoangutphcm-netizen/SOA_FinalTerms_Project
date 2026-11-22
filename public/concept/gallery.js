export const galleryInterval = 10_000;

export function galleryCycleItems(media) {
  return media.flatMap((file, index) =>
    ["IMAGE", "VIDEO"].includes(file.kind) && (file.url || file.previewUrl)
      ? [index]
      : [],
  );
}

export function galleryFrame(media, i, { empty, esc, kindNames }) {
  if (!media.length) return empty("Chưa có tệp để hiển thị.");
  const m = media[i];
  let view = "<span>Tệp hiện không khả dụng</span>";
  const source = m.url || m.previewUrl;
  if (source && m.kind === "VIDEO")
    view = `<video src="${esc(source)}" controls ${m.locked ? 'controlslist="nodownload"' : ""} playsinline preload="metadata"></video>`;
  else if (source && m.kind === "IMAGE") {
    const image = `<img src="${esc(source)}" alt="${esc(m.filename)}">`;
    view = m.locked
      ? `<div class="premium-preview-photo">${image}<div class="premium-preview-corner"><img src="${esc(source)}" alt="" aria-hidden="true"><span>PCK Xem trước</span></div></div>`
      : image;
  } else if (m.locked && m.originalAvailable)
    view = "<strong>Chưa có bản xem trước cho tệp Premium</strong>";
  const state = !m.originalAvailable
    ? "Tệp gốc hiện không khả dụng"
    : m.locked
      ? m.previewUrl
        ? "Bản xem trước Premium"
        : "Tệp Premium chưa mở"
      : m.premium
        ? "Premium | Đã mở quyền"
        : "Tệp công khai";
  const downloadStyle = media.some((file) => file.locked) ? "light" : "primary";
  const arrows =
    media.length > 1
      ? [
          ["back", "Tệp trước", "m15 6-6 6 6 6"],
          ["forward", "Tệp tiếp theo", "m9 6 6 6-6 6"],
        ]
          .map(
            ([direction, label, path]) =>
              `<button type="button" class="gallery-arrow gallery-arrow-${direction}" data-gallery-step="${direction}" aria-label="${label}" title="${label}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg></button>`,
          )
          .join("")
      : "";
  return `<div class="gallery-player"><div class="preview media-stage">${view}</div>${arrows}</div><div class="detail-file"><div><span>Tệp ${i + 1}/${media.length} | ${kindNames[m.kind] || "Tệp"}</span><strong>${esc(m.filename)}</strong><span>${state}</span></div>${m.url ? `<a class="btn ${downloadStyle}" href="${esc(m.url)}" download="${esc(m.filename)}">Tải bản gốc</a>` : ""}</div>`;
}

export function galleryStrip(media, selected, { esc, kindNames, autoCycle }) {
  const cycleButton =
    galleryCycleItems(media).length > 1
      ? `<button type="button" class="btn light" data-action="cycle" aria-pressed="${autoCycle}">${autoCycle ? "Dừng tự chuyển" : "Tự chuyển mỗi 10 giây"}</button>`
      : "";
  const thumbnails = media
    .map((file, index) => {
      const kind = kindNames[file.kind] || "Tệp";
      const video = file.kind === "VIDEO";
      const clip = video ? file.clipUrl || file.previewUrl : null;
      const source = file.previewUrl || clip || file.url;
      const label = `${kind} ${index + 1}: ${file.filename}${file.locked ? " | Premium" : ""}`;
      return `<button type="button" class="gallery-thumb" data-media="${index}" ${clip ? `data-clip="${esc(clip)}"` : ""} aria-pressed="${index === selected}" aria-label="${esc(label)}" title="${esc(label)}">
      <span class="gallery-thumb-empty" aria-hidden="true">${source ? kind : "Chưa có bản xem trước"}</span>
      ${source ? `<img class="gallery-thumb-poster" src="${esc(source + "?thumbnail=1")}" ${file.kind === "IMAGE" ? `data-fallback="${esc(source)}"` : ""} alt="" loading="lazy">` : ""}
      ${video ? '<span class="gallery-thumb-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>' : ""}
      ${file.locked ? '<span class="gallery-thumb-tier" aria-hidden="true">Premium</span>' : ""}
    </button>`;
    })
    .join("");
  return `<div class="gallery-strip-heading"><strong>Tệp trong tác phẩm</strong>${cycleButton}</div>
    <div class="media-thumbs" role="group" aria-label="Chọn tệp trong tác phẩm">${thumbnails}</div>`;
}
