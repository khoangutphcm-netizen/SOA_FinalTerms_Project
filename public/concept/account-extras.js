export const money = (value) =>
  (typeof value === "string" && /^-?\d+$/.test(value)
    ? BigInt(value)
    : Number(value)
  ).toLocaleString("vi-VN") + " ₫";
const date = (value) =>
  value
    ? new Date(value).toLocaleString("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "-";

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
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    throw new Error("Chọn ảnh JPG, PNG hoặc WebP tối đa 8 MiB.");
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Không đọc được ảnh đã chọn.");
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const side = Math.min(bitmap.width, bitmap.height);
    const paint = canvas.getContext("2d", { alpha: false });
    paint.fillStyle = "#ffffff";
    paint.fillRect(0, 0, 256, 256);
    paint.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    const jpg = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
    if (!jpg || jpg.length > 131072)
      throw new Error("Ảnh đã chọn không thể thu nhỏ đủ. Hãy thử ảnh khác.");
    return jpg;
  } finally {
    bitmap.close();
  }
}

export function walletPage(wallet, esc, returnPost, stripeStatus) {
  const { min, max } = wallet.topUpLimits ?? { min: 20000, max: 1000000 };
  const ledger = wallet.history
    .map((entry) => {
      const label = {
        TOP_UP: "Nạp thử",
        ADMIN_CREDIT: "Quản trị viên cộng tiền",
        ADMIN_DEBIT: "Quản trị viên giảm số dư",
        PURCHASE: "Mua tác phẩm",
        SALE_EARNING: "Thu từ bán tác phẩm",
      }[entry.kind];
      const credit = Number(entry.amount_vnd) > 0;
      return `<li><div><strong>${esc(label)}</strong>${entry.post_title ? `<span>${esc(entry.post_title)}</span>` : ""}<span>${esc(date(entry.created_at))}</span></div>
      <div><strong class="${credit ? "wallet-credit" : ""}">${credit ? "+" : "−"}${money(Math.abs(Number(entry.amount_vnd)))}</strong>
      <span>Còn ${money(entry.balance_after_vnd)}</span></div></li>`;
    })
    .join("");
  return `<div class="surface wallet-panel">
    <div><h2>Số dư demo</h2><strong class="wallet-amount">${money(wallet.balanceVnd)}</strong>
      <p class="muted">Chỉ dùng để mua thử trên PCK.</p></div>
    <form id="wallet-topup-form" class="wallet-topup">
      <label>Số tiền nạp (₫)<input type="number" name="amount" inputmode="numeric" min="${min}" max="${max}" step="1" placeholder="Ví dụ: 75000" required aria-describedby="wallet-topup-range">
        <small id="wallet-topup-range" class="muted">${money(min)} – ${money(max)}</small></label>
      <div class="button-row"><button type="submit" name="provider" value="demo" class="btn light">Nạp thử</button>
      <button type="submit" name="provider" value="stripe" class="btn dark">Nạp thử qua Stripe</button></div><p role="status" class="muted"></p>
    </form>
    ${stripeStatus === "success" ? '<p class="wallet-stripe-status muted" role="status">Đã quay lại từ Stripe. Số dư cập nhật sau khi PCK nhận được xác nhận thanh toán. Hãy tải lại trang để kiểm tra.</p>' : stripeStatus === "cancel" ? '<p class="wallet-stripe-status muted" role="status">Bạn đã hủy thanh toán Stripe.</p>' : ""}
    ${returnPost ? `<a href="#post/${encodeURIComponent(returnPost)}">Quay lại tác phẩm</a>` : ""}
  </div><section class="surface wallet-history"><h2>Lịch sử giao dịch</h2>
    ${ledger ? `<ul>${ledger}</ul>` : '<p class="muted">Chưa có giao dịch số dư.</p>'}</section>`;
}

const reportDate = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh",
});

export function revenuePage({ period, year, month, sort, q, page, lastPage, summary, posts }, esc, postLink) {
  const options = (choices, selected) => choices.map(([value, label]) =>
    `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("");
  const periodLabel = period === "all" ? "Toàn thời gian" : period === "year"
    ? `Năm ${year}` : `Tháng ${month}/${year}`;
  const pageLink = (target) => "#account/revenue?" + new URLSearchParams({ period, year, month, sort, q, page: target });
  return `<section class="account-revenue" aria-labelledby="seller-sales-title">
    <div class="surface seller-sales-summary">
      <div><h2 id="seller-sales-title">Doanh thu</h2><p class="muted">${periodLabel} · Đơn đã thanh toán${q ? " · Tổng cả kỳ" : ""}</p></div>
      <dl class="seller-sales-totals">
        <div><dt>Tổng doanh thu</dt><dd>${money(summary.revenueVnd)}</dd></div>
        <div><dt>Lượt bán</dt><dd>${summary.paidCount.toLocaleString("vi-VN")}</dd></div>
      </dl>
    </div>
    <form id="revenue-filters" class="revenue-filters" aria-label="Lọc doanh thu">
      <label class="revenue-search">Tìm tác phẩm<input type="search" name="q" maxlength="100" value="${esc(q)}" placeholder="Nhập tên ảnh hoặc video"></label>
      <label>Kỳ báo cáo<select name="period">${options([
        ["month", "Theo tháng"], ["year", "Theo năm"], ["all", "Toàn thời gian"],
      ], period)}</select></label>
      <label${period !== "month" ? " hidden" : ""}>Tháng<select name="month"${period !== "month" ? " disabled" : ""}>${options(
        Array.from({ length: 12 }, (_, i) => [i + 1, `Tháng ${i + 1}`]), month,
      )}</select></label>
      <label${period === "all" ? " hidden" : ""}>Năm<input type="number" name="year" required value="${year}" min="1000" max="9998" inputmode="numeric"${period === "all" ? " disabled" : ""}></label>
      <label>Sắp xếp<select name="sort">${options([
        ["revenue-desc", "Doanh thu cao nhất"], ["revenue-asc", "Doanh thu thấp nhất"],
        ["sold", "Bán nhiều nhất"], ["recent", "Bán gần đây nhất"],
      ], sort)}</select></label>
      <button class="btn dark" type="submit">Áp dụng</button>
    </form>
    ${posts.length ? `<div class="surface revenue-table-wrap">
      <table class="revenue-table" aria-label="Doanh thu theo tác phẩm">
        <thead><tr><th scope="col">Tác phẩm</th><th scope="col">Lượt bán</th>
          <th scope="col">Doanh thu</th><th scope="col" class="revenue-date">Bán gần nhất</th></tr></thead>
        <tbody>${posts.map((post) => {
          const latest = reportDate.format(new Date(post.lastSoldAt));
          const thumb = `<span class="revenue-thumb" aria-hidden="true">
            ${post.cover_id ? `<img src="/api/demo/media/${encodeURIComponent(post.cover_id)}?thumbnail=1" alt="" loading="lazy">` : ""}
            ${post.cover_kind === "VIDEO" ? '<span class="revenue-video">Video</span>' : ""}
          </span>`;
          const title = `<span class="revenue-work-title">${esc(post.title)}</span>`;
          const work = post.canOpen ? `<a class="revenue-work" href="${postLink(post)}">${thumb}${title}</a>`
            : `<span class="revenue-work">${thumb}${title}</span>`;
          return `<tr><th scope="row">${work}<span class="revenue-mobile-date">Bán gần nhất ${latest}</span></th>
            <td>${post.paidCount.toLocaleString("vi-VN")}</td><td>${money(post.revenueVnd)}</td>
            <td class="revenue-date">${latest}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>` : `<p class="surface revenue-empty muted">${q ? "Không tìm thấy tác phẩm đã bán khớp tên trong kỳ này." : "Bạn chưa có giao dịch bán tác phẩm trong kỳ này."}</p>`}
    ${lastPage > 1 ? `<nav class="revenue-pagination" aria-label="Trang báo cáo">
      ${page > 1 ? `<a class="btn light" href="${esc(pageLink(page - 1))}">Trang trước</a>` : ""}
      <span>Trang ${page}/${lastPage}</span>
      ${page < lastPage ? `<a class="btn light" href="${esc(pageLink(page + 1))}">Trang sau</a>` : ""}
    </nav>` : ""}
  </section>`;
}

const downloadLabels = {
  READY: "Có thể tải",
  PARTIAL: "Một số tệp không khả dụng",
  UNAVAILABLE: "Không khả dụng",
};
const searchText = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .trim();

export function purchaseLibrary(posts, esc, postLink) {
  if (!posts.length) return '<p class="empty">Bạn chưa mua tác phẩm nào.</p>';
  const items = posts
    .map((post) => {
      const purchase = post.purchase;
      const cover =
        purchase.canOpen && post.cover_id
          ? `<img src="/api/demo/media/${encodeURIComponent(post.cover_id)}?thumbnail=1" alt="" loading="lazy">`
          : "";
      return `<li class="purchase-row" data-purchase-title="${esc(searchText(post.title))}" data-download-state="${esc(purchase.downloadState)}" data-purchased-at="${new Date(purchase.purchasedAt).getTime()}" data-purchase-amount="${Number(purchase.amountVnd)}">
      <div class="purchase-cover"><span>Tác phẩm</span>${cover}</div><div>
      <strong>${esc(post.title)}</strong><span class="purchase-state">${esc(downloadLabels[purchase.downloadState])}</span></div>
      <div><span>${esc(date(purchase.purchasedAt))}</span><strong>${money(purchase.amountVnd)}</strong></div>
      ${purchase.canOpen ? `<a class="btn light" href="${esc(postLink(post))}">${purchase.downloadState === "UNAVAILABLE" ? "Xem chi tiết" : "Mở và tải"}</a>` : ""}
    </li>`;
    })
    .join("");
  return `<section class="purchase-library"><form id="purchase-filter" role="search" aria-label="Tìm trong Đã mua">
    <input type="search" name="q" aria-label="Tìm trong Đã mua" placeholder="Tìm theo tên tác phẩm…" maxlength="100">
    <select name="availability" aria-label="Trạng thái tải"><option value="">Mọi trạng thái tải</option>
    ${Object.entries(downloadLabels)
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join("")}</select>
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
  const byDate = (a, b) =>
    Number(b.dataset.purchasedAt) - Number(a.dataset.purchasedAt);
  const byAmount = (a, b) =>
    Number(b.dataset.purchaseAmount) - Number(a.dataset.purchaseAmount);
  const compare = {
    new: byDate,
    old: (a, b) => byDate(b, a),
    high: (a, b) => byAmount(a, b) || byDate(a, b),
    low: (a, b) => byAmount(b, a) || byDate(a, b),
  };
  if (list.dataset.sort !== sort) {
    list.append(...items.sort(compare[sort]));
    list.dataset.sort = sort;
  }
  let total = 0;
  for (const item of items) {
    const visible =
      item.dataset.purchaseTitle.includes(text) &&
      (!state || state === item.dataset.downloadState);
    item.hidden = !visible;
    if (visible) total += 1;
  }
  list.hidden = !total;
  section.querySelector("[data-no-purchases]").hidden = Boolean(total);
  section.querySelector("[data-purchase-count]").textContent =
    `Hiển thị ${total} tác phẩm.`;
}
