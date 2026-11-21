export const money = (value) => Number(value).toLocaleString("vi-VN") + " ₫";
const date = (value) => value ? new Date(value).toLocaleString("vi-VN", {
  dateStyle: "short", timeStyle: "short",
}) : "—";

export function avatar({ id, alias, avatarVersion }, esc) {
  const initial = Array.from(String(alias || "P").trim())[0] || "P";
  return `<span class="user-avatar" aria-hidden="true"><span>${esc(initial.toLocaleUpperCase("vi"))}</span>
    ${id && avatarVersion ? `<img src="/api/demo/avatar/${encodeURIComponent(id)}?v=${encodeURIComponent(avatarVersion)}" alt="" loading="lazy">` : ""}</span>`;
}

export function profilePage(profile, esc, accountActions) {
  return `<form id="profile-form" class="surface edit-form profile-editor">
    <div class="profile-avatar-line">${avatar(profile, esc)}
      <div><strong>${esc(profile.alias)}</strong><p class="muted">Ảnh đại diện hiển thị trên tác phẩm và bình luận.</p></div>
    </div>
    <label>Đổi ảnh đại diện<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"></label>
    ${profile.avatarVersion ? '<label class="check"><input type="checkbox" name="removeAvatar"> Bỏ ảnh đại diện</label>' : ""}
    <label>Tên hiển thị<input name="displayName" maxlength="80" required value="${esc(profile.alias)}"></label>
    <label>Giới thiệu<textarea name="bio" maxlength="240" rows="3">${esc(profile.bio)}</textarea></label>
    <div class="button-row"><button class="btn dark" type="submit">Lưu hồ sơ</button>${accountActions}</div>
    <p role="status" class="muted"></p>
  </form>`;
}

export async function avatarPayload(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error("Chọn ảnh JPG, PNG hoặc WebP tối đa 8 MiB.");
  }
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("Không đọc được ảnh đã chọn."); }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const side = Math.min(bitmap.width, bitmap.height);
    const paint = canvas.getContext("2d", { alpha: false });
    paint.fillStyle = "#ffffff";
    paint.fillRect(0, 0, 256, 256);
    paint.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 256, 256);
    const jpg = canvas.toDataURL("image/jpeg", .82).split(",")[1];
    if (!jpg || jpg.length > 131072) throw new Error("Ảnh đã chọn không thể thu nhỏ đủ. Hãy thử ảnh khác.");
    return jpg;
  } finally { bitmap.close(); }
}

export function walletPage(wallet, esc, returnPost) {
  const ledger = wallet.history.map(entry => {
    const credit = entry.kind === "TOP_UP";
    return `<li><div><strong>${credit ? "Nạp thử" : "Mua tác phẩm"}</strong><span>${esc(date(entry.created_at))}</span></div>
      <div><strong class="${credit ? "wallet-credit" : ""}">${credit ? "+" : "−"}${money(Math.abs(Number(entry.amount_vnd)))}</strong>
      <span>Còn ${money(entry.balance_after_vnd)}</span></div></li>`;
  }).join("");
  return `<div class="surface wallet-panel">
    <div><h2>Số dư demo</h2><strong class="wallet-amount">${money(wallet.balanceVnd)}</strong>
      <p class="muted">Chỉ dùng để mua thử trên PCK.</p></div>
    <form id="wallet-topup-form" class="wallet-topup">
      <label>Mức nạp thử<select name="amount">${[50000,100000,200000].map(value =>
        `<option value="${value}">${money(value)}</option>`).join("")}</select></label>
      <button type="submit" class="btn dark">Nạp thử</button><p role="status" class="muted"></p>
    </form>
    ${returnPost ? `<a href="#post/${encodeURIComponent(returnPost)}">Quay lại tác phẩm</a>` : ""}
  </div><section class="surface wallet-history"><h2>Lịch sử giao dịch</h2>
    ${ledger ? `<ul>${ledger}</ul>` : '<p class="muted">Chưa có giao dịch số dư.</p>'}</section>`;
}

const downloadLabels = { READY:"Có thể tải", PARTIAL:"Một số tệp không khả dụng", UNAVAILABLE:"Không khả dụng" };
const searchText = value => String(value).normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLocaleLowerCase("vi").trim();

export function purchaseLibrary(posts, esc, postLink) {
  if (!posts.length) return '<p class="empty">Bạn chưa mua tác phẩm nào.</p>';
  const items = posts.map(post => {
    const purchase = post.purchase;
    const cover = purchase.canOpen && post.cover_id
      ? `<img src="/api/demo/media/${encodeURIComponent(post.cover_id)}?thumbnail=1" alt="" loading="lazy">` : "";
    return `<li class="purchase-row" data-purchase-title="${esc(searchText(post.title))}" data-download-state="${esc(purchase.downloadState)}" data-purchased-at="${new Date(purchase.purchasedAt).getTime()}" data-purchase-amount="${Number(purchase.amountVnd)}">
      <div class="purchase-cover"><span>Tác phẩm</span>${cover}</div><div>
      <strong>${esc(post.title)}</strong><span class="purchase-state">${esc(downloadLabels[purchase.downloadState])}</span></div>
      <div><span>${esc(date(purchase.purchasedAt))}</span><strong>${money(purchase.amountVnd)}</strong></div>
      ${purchase.canOpen ? `<a class="btn light" href="${esc(postLink(post))}">${purchase.downloadState === "UNAVAILABLE" ? "Xem chi tiết" : "Mở và tải"}</a>` : ""}
    </li>`;
  }).join("");
  return `<section class="purchase-library"><form id="purchase-filter" role="search" aria-label="Tìm trong Đã mua">
    <input type="search" name="q" aria-label="Tìm trong Đã mua" placeholder="Tìm theo tên tác phẩm…" maxlength="100">
    <select name="availability" aria-label="Trạng thái tải"><option value="">Mọi trạng thái tải</option>
    ${Object.entries(downloadLabels).map(([key,label]) => `<option value="${key}">${label}</option>`).join("")}</select>
    <select name="sort" aria-label="Sắp xếp"><option value="new">Mua gần đây</option><option value="old">Mua lâu nhất</option>
    <option value="high">Giá cao đến thấp</option><option value="low">Giá thấp đến cao</option></select>
  </form><p class="muted" data-purchase-count role="status">${posts.length} tác phẩm đã mua.</p>
  <ul class="surface purchase-list">${items}</ul><p class="empty" data-no-purchases hidden>Không tìm thấy tác phẩm phù hợp.</p></section>`;
}

export function filterPurchases(form) {
  const text = searchText(form.elements.q.value);
  const state = form.elements.availability.value;
  const section = form.closest(".purchase-library");
  const list = section.querySelector(".purchase-list");
  const items = Array.from(list.children);
  const sort = form.elements.sort.value;
  const byDate = (a, b) => Number(b.dataset.purchasedAt) - Number(a.dataset.purchasedAt);
  const byAmount = (a, b) => Number(b.dataset.purchaseAmount) - Number(a.dataset.purchaseAmount);
  const compare = {
    new: byDate, old: (a, b) => byDate(b, a),
    high: (a, b) => byAmount(a, b) || byDate(a, b),
    low: (a, b) => byAmount(b, a) || byDate(a, b),
  };
  if (list.dataset.sort !== sort) {
    list.append(...items.sort(compare[sort]));
    list.dataset.sort = sort;
  }
  let total = 0;
  for (const item of items) {
    const visible = item.dataset.purchaseTitle.includes(text) && (!state || state === item.dataset.downloadState);
    item.hidden = !visible;
    if (visible) total += 1;
  }
  list.hidden = !total;
  section.querySelector("[data-no-purchases]").hidden = Boolean(total);
  section.querySelector("[data-purchase-count]").textContent = `Hiển thị ${total} tác phẩm.`;
}
