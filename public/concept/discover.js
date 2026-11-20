export async function discover({
  filters,
  browseSearch,
  api,
  user,
  setSaved,
  heading,
  esc,
  browseResults,
}) {
  const { include, exclude } = filters;
  const [catalog, genreList, saved] = await Promise.allSettled([
    browseSearch(),
    api("genres"),
    user ? api("saved") : null,
  ]);
  setSaved(new Set((saved.value?.posts ?? []).map((post) => post.id)));
  const genres = genreList.value?.genres ?? [];
  const option = (key, label, current) =>
    `<option value="${key}" ${key === current ? "selected" : ""}>${label}</option>`;
  const formats = [
    ["", "Tất cả"],
    ["IMAGE", "Ảnh"],
    ["VIDEO", "Video"],
    ["MIXED", "Hỗn hợp"],
  ];
  return (
    '<div class="catalog-page catalog-discover">' +
    heading("Khám phá") +
    `<form id="browse-form" class="browse-controls">
  <div class="catalog-search browse-search">
   <input name="q" type="search" aria-label="Từ khóa" placeholder="Tìm tên, mô tả hoặc thể loại" maxlength="100" value="${esc(filters.q)}">
   <button type="submit" class="btn dark">Tìm kiếm</button>
  </div>
  <input type="hidden" name="kind" value="${esc(filters.kind)}">
  <div class="browse-formats" role="group" aria-label="Định dạng">${formats.map(([value, label]) => `<button type="button" data-format="${value}" aria-pressed="${filters.kind === value}">${label}</button>`).join("")}</div>
  ${
    genres.length
      ? `<div class="browse-topics" role="group" aria-label="Chủ đề nhanh">${genres
          .slice(0, 6)
          .map(
            (g) =>
              `<button type="button" data-topic="${esc(g.id)}" aria-pressed="${include.includes(g.id)}">${esc(g.name)}</button>`,
          )
          .join("")}</div>`
      : ""
  }
  <div class="browse-filter-row"><details class="browse-filter"><summary>Bộ lọc<span data-filter-count>${include.length + exclude.length + Number(Boolean(filters.pay)) + Number(Boolean(filters.days)) + Number(filters.sort !== "new") ? ` (${include.length + exclude.length + Number(Boolean(filters.pay)) + Number(Boolean(filters.days)) + Number(filters.sort !== "new")})` : ""}</span></summary>
  <div class="browse-options">
  <select name="sort" aria-label="Sắp xếp">${option("new", "Mới nhất", filters.sort)}${option("old", "Cũ nhất", filters.sort)}</select>
  <select name="pay" aria-label="Mức giá">${option("", "Mọi mức giá", filters.pay)}${option("free", "Miễn phí", filters.pay)}${option("premium", "Trả phí", filters.pay)}</select>
  <select name="days" aria-label="Thời gian đăng">${option("", "Mọi thời gian", filters.days)}${option("7", "7 ngày qua", filters.days)}${option("30", "30 ngày qua", filters.days)}${option("older", "Cũ hơn 30 ngày", filters.days)}</select>
  ${
    genres.length
      ? `<details class="genre-box" ${include.length || exclude.length ? "open" : ""}><summary>Thể loại</summary>
   ${genres
     .map((g) => {
       const selected = include.includes(g.id)
         ? "yes"
         : exclude.includes(g.id)
           ? "no"
           : "";
       return `<label>${esc(g.name)}<select name="genre:${esc(g.id)}">${option("", "Bỏ qua", selected)}${option("yes", "Có", selected)}${option("no", "Không", selected)}</select></label>`;
     })
     .join("")}</details>`
      : ""
  }
  </div></details><button type="button" class="browse-reset" data-browse-reset>Xóa bộ lọc</button>
  <p class="muted browse-status" role="status">${catalog.status === "rejected" ? "Chưa tải được kết quả. Nhấn Tìm kiếm để thử lại." : catalog.value.posts.length ? `Hiển thị ${catalog.value.posts.length} tác phẩm.` : "Không có kết quả."}</p></div>
  </form><div id="browse-results">${catalog.value ? browseResults(catalog.value.posts) : ""}</div></div>`
  );
}
