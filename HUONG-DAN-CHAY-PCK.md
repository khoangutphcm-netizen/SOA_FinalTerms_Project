# Chạy PCK bằng Docker hoặc ngrok

Mở PowerShell trong thư mục `SOA_FinalTerms_Project`. Chuẩn bị file `.env` với bốn biến `IDENTITY_DATABASE_URL`, `CONTENT_DATABASE_URL`, `COMMERCE_DATABASE_URL` và `COMMUNITY_DATABASE_URL`. Nếu đã có `.env`, giữ file hiện tại. Máy mới có thể sao chép `.env.example` rồi điền cấu hình của nhóm. Giữ khóa và mật khẩu trong `.env` trên máy.

## 1. Chọn một cách chạy

### Docker trên máy local

Mở Docker Desktop, đợi Docker Engine chạy, rồi nhập:

```powershell
docker compose up --build --menu=false
```

Mở [PCK local](http://127.0.0.1:3100). Lần đầu Docker cần tải và build image. Image đã có Node.js, dependencies và FFmpeg.

### Ngrok để người khác truy cập qua Internet

Máy cần Node.js, dependencies của dự án và ngrok. Trên máy mới, chạy `npm ci` một lần. Nếu ngrok chưa có authtoken, cấu hình `ngrok config add-authtoken <TOKEN>` một lần.

```powershell
npm run ngrok
```

Mở URL HTTPS được in sau dòng `PCK ngrok`. Lệnh này chạy cả PCK lẫn tunnel. PCK tự dùng URL đó làm địa chỉ quay về từ Stripe.

**Dừng bằng Ctrl+C** tại terminal đã chạy Docker hoặc ngrok. Nếu cổng 3100 đang bận, dừng phiên PCK cũ trước khi đổi chế độ.

## 2. Bật Stripe Sandbox trước khi thử nạp

**Thứ tự dùng Stripe CLI: listener → lưu khóa webhook → chạy PCK → nạp test.** Cách này dùng được với cả Docker và ngrok.

1. **Chọn đúng sandbox Stripe.** Lấy test secret key bắt đầu bằng `sk_test_` hoặc restricted key bắt đầu bằng `rk_test_` có quyền tạo Checkout Session. Lưu vào `STRIPE_SECRET_KEY` trong `.env`.
2. **Terminal 1 — bật webhook.** Cài Stripe CLI nếu máy chưa có. Chạy `stripe login` lần đầu và chọn cùng sandbox ở bước 1. Sau khi thấy đã đăng nhập thành công, chạy lệnh sau:

   ```powershell
   stripe listen --events "checkout.session.completed,checkout.session.async_payment_succeeded" --forward-to http://127.0.0.1:3100/api/stripe/webhook
   ```

   Đợi dòng **Ready**, rồi điền `STRIPE_WEBHOOK_SECRET=whsec_...` bằng khóa mà listener vừa in ra. Giữ terminal này mở. Giá trị bắt đầu bằng `acct_` là ID tài khoản Stripe.
3. **Terminal 2 — chạy PCK.** Dùng một trong hai lệnh ở mục 1. Nếu PCK đã mở trước khi bạn lưu khóa webhook, dừng bằng **Ctrl+C** rồi chạy lại. Nếu đã đổi `PORT` trong `.env`, đổi cổng trong `--forward-to` cho khớp.
4. **Thử nạp.** Vào **Tài khoản → Số dư**, nhập số tiền rồi chọn **Nạp qua Stripe test**. Dùng thẻ test `4242 4242 4242 4242`, ngày hết hạn trong tương lai và CVC `123`.
5. **Kiểm tra kết quả.** Terminal Stripe cần hiện `checkout.session.completed` trả **HTTP 200**. Tải lại trang Số dư để kiểm tra số tiền đã tăng và có dòng giao dịch trong lịch sử.

Khi xong, dùng **Ctrl+C** ở cả hai terminal. Nếu chỉ dùng nút **Nạp thử**, chỉ cần chạy PCK.

### Ngrok với webhook đăng ký trên Stripe Dashboard

Nếu nhóm đã có một URL ngrok ổn định, có thể cho Stripe gửi webhook thẳng tới URL HTTPS của PCK. Chạy ngrok để xác nhận URL rồi đăng ký endpoint `https://<tên-miền-ngrok>/api/stripe/webhook` trong **Stripe Sandbox** với hai sự kiện ở trên. Lưu signing secret của chính endpoint đó vào `STRIPE_WEBHOOK_SECRET`, rồi khởi động lại `npm run ngrok` và kiểm tra URL còn khớp. Với cách này chỉ cần terminal PCK để chạy demo.

### Stripe báo thành công nhưng số dư chưa đổi

- Kiểm tra listener còn chạy và `--forward-to` trỏ tới đúng cổng PCK.
- Nếu webhook báo lỗi chữ ký, kiểm tra khóa `whsec_...` có thuộc đúng listener hoặc endpoint đang gửi không, rồi khởi động lại PCK sau khi sửa.
- Nếu thanh toán diễn ra trước khi webhook sẵn sàng, khoản đó cần được gửi lại qua webhook hoặc đối soát riêng. Bật listener sau đó chỉ nhận các sự kiện mới.
