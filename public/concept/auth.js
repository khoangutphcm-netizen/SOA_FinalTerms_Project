export function welcome({ link }) {
  return `<section class="welcome-screen"><div class="welcome-copy">
  <h1><span>PCK.</span><br>Kho ảnh<br>và video.</h1>
  <p>Khám phá góc nhìn mới, đăng tác phẩm của bạn và tìm nội dung phù hợp cho dự án tiếp theo.</p>
  <div class="button-row">${link("Đăng nhập", "#login")}${link("Đăng ký", "#register", "dark")}</div>
 </div><div class="welcome-art" aria-hidden="true">
  <div class="welcome-photo"></div>
 </div></section>
 <section class="welcome-guide" aria-labelledby="welcome-guide-title">
  <header><h2 id="welcome-guide-title">Khám phá và chia sẻ tác phẩm</h2>
   <p>Tìm ảnh, video và bộ sưu tập theo chủ đề, hoặc đăng tác phẩm của riêng bạn.</p>
  </header>
  <div class="welcome-topics">
   <article><h3>Ảnh, video và bộ sưu tập</h3><p>Duyệt theo định dạng và thể loại. Bạn có thể xem các bài công khai khi chưa đăng nhập.</p><a href="#browse">Vào Khám phá <span aria-hidden="true">→</span></a></article>
   <article><h3>Nội dung Premium</h3><p>Xem trước ảnh hoặc một đoạn video. Sau khi mua, bạn có thể tìm và tải bản đầy đủ trong mục Đã mua.</p></article>
   <article><h3>Dành cho người sáng tạo</h3><p>Đăng nhiều ảnh và video trong một bài, chọn tệp đại diện và đặt giá cho phần Premium.</p><a href="#upload">Đăng tác phẩm <span aria-hidden="true">→</span></a></article>
  </div>
 </section>`;
}
export function authForm({ user, heading, link }, register = false) {
  if (user)
    return heading(
      "Bạn đã đăng nhập",
      user.alias,
      link("Tài khoản", "#account"),
    );
  const label = register ? "Tạo tài khoản" : "Đăng nhập";
  return `<section class="auth-screen">${heading(label)}<form id="${register ? "register" : "login"}-form" class="surface edit-form">
 ${register ? '<label>Tên hiển thị<input name="displayName" required maxlength="80" autocomplete="nickname"></label>' : ""}
 ${register ? '<label>Email<input name="email" type="email" required maxlength="254" autocomplete="username"></label>' : '<label>Tên đăng nhập hoặc email<input name="identifier" type="text" required maxlength="254" autocapitalize="none" autocomplete="username" placeholder="Ví dụ: user1"></label>'}
 <label>Mật khẩu<input name="password" type="password" required ${register ? 'minlength="8"' : ""} maxlength="128" autocomplete="${register ? "new-password" : "current-password"}"></label>
 <div class="button-row"><button class="btn dark">${label}</button>${register ? link("Đã có tài khoản", "#login") : link("Tạo tài khoản", "#register")}</div>
 <a href="#verify">Xác minh email hoặc gửi lại mã</a>
 <p role="status" class="muted"></p>
 <a href="#home">Tiếp tục với vai trò khách</a>
 </form></section>`;
}
export function verifyForm({ heading, esc, verificationEmail }) {
  return `<section class="auth-screen">${heading("Xác minh email")}<form id="verify-form" class="surface edit-form">
 <label>Email<input name="email" type="email" required maxlength="254" autocomplete="email" value="${esc(verificationEmail)}"></label>
 <label>Mã xác minh<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>
 <div class="button-row"><button class="btn dark" name="operation" value="verify">Xác minh</button><button class="btn" name="operation" value="resend" type="submit" formnovalidate>Gửi lại mã</button></div>
 <p role="status" class="muted"></p><a href="#login">Đăng nhập</a></form></section>`;
}
