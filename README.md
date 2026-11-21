# PCK — Website chia sẻ và mua bán nội dung số

PCK là đồ án cuối kỳ SOA. Khách duyệt ảnh và video, tác giả đăng bài nhiều tệp và chọn tệp Premium, người mua xem lại nội dung trong mục Đã mua. Admin có thể ẩn tạm hoặc gỡ bài do vi phạm. Xem sau cho phép lưu và bỏ lưu bài ngay trong tài khoản.

## Trạng thái hiện tại

Web nhận yêu cầu tại cổng 3100 và chuyển API ứng dụng tới Content. Bốn service chạy ở bốn tiến trình riêng và mỗi service dùng kết nối Neon của mình.

| Service   | Cổng mặc định | Phụ trách                                       |
| --------- | ------------: | ----------------------------------------------- |
| Commerce  |          3101 | Mua thử, đơn hàng và quyền xem Premium          |
| Content   |          3102 | Bài đăng, tệp, tìm kiếm và kiểm duyệt           |
| Identity  |          3103 | Xác thực tài khoản demo và thông tin người dùng |
| Community |          3104 | Thích, bình luận, báo cáo và Xem sau            |

Content gọi các service khác qua HTTP nội bộ. Người dùng đăng ký bằng email và xác minh OTP trước khi đăng nhập. Identity giữ tên hiển thị, giới thiệu và ảnh đại diện. Commerce giữ số dư và lịch sử ví demo. Mua bằng ví ghi đơn `PCK_WALLET_TEST` và cấp quyền xem, tải bản gốc. Mục **Tài khoản → Đã mua** tra cứu đơn theo tên, ngày, giá và trạng thái tải. **Bộ của tôi** quản lý các bộ sưu tập của tài khoản. Tệp gốc, preview và ảnh thu nhỏ được lưu trong `asset_blobs` trên Content DB Neon.

## Việc cần làm theo ưu tiên

- **P1: Nghiệp vụ và demo**: Kiểm thử Stripe Checkout sandbox từ giao diện đến webhook và ví, cùng các luồng OTP, đăng nhập, đăng bài, mua và tải. Phương thức thanh toán phụ thuộc cấu hình tài khoản Stripe; chưa tích hợp QR riêng.
- **P1: Khởi tạo DB**: `migrate.mjs` chưa nhận dạng được `CREATE TABLE` xuống dòng trong các file Identity, Commerce và Community. Sửa bộ nhận dạng và kiểm thử với bốn DB trống trước khi dùng script; hiện có hướng dẫn chạy SQL thủ công bên dưới.
- **P1: Dữ liệu và giao diện**: Xem sau lấy 50 bài gần nhất. Đã mua hiển thị toàn bộ quyền mua. Bổ sung phân trang khi thư viện có nhiều tác phẩm.
- **P1: Bảo vệ xác thực**: `server.mjs` giới hạn đăng nhập, đăng ký, xác minh và gửi lại mã theo đường dẫn chung. Giới hạn thêm theo nguồn hoặc tài khoản để một người không chặn tất cả người khác. `identity-handlers.mjs` trả 429 khi email đang chờ xác minh gửi lại quá sớm, nhưng trả 200 cho email không tồn tại hoặc đã kích hoạt; cần thống nhất phản hồi để tránh lộ trạng thái tài khoản.
- **P2: Tiêu chí triển khai và giám sát**: Bổ sung Docker Compose, Prometheus và dashboard Grafana cho các service. Docker đang để làm sau theo kế hoạch hiện tại. Khi làm Compose, xử lý địa chỉ `127.0.0.1` giữa các container và chia sẻ `PCK_INTERNAL_TOKEN` giữa các service. Kiểm thử ngrok khi có môi trường chạy.
- **P2: Độ ổn định**: Phiên đăng nhập mất khi khởi động lại. Một tiến trình dừng sẽ làm launcher dừng toàn bộ hệ thống. Cần cân nhắc lưu phiên bền vững và cơ chế phục hồi service.
- **P2: Kiểm thử giao diện**: Kiểm tra luồng thực tế, màn hình nhỏ, trạng thái tải và lỗi của từng chức năng. Chưa có kết quả kiểm thử trình duyệt với DB và SMTP thật.
- **P3: Dọn giao diện cũ**: `public/concept/index.html` là giao diện chính, `public/index.html` kiểm tra DB; `public/demo.html` là trang demo cũ không được khai báo route. Xác nhận còn cần trước khi xóa.

### Bàn giao kiểm thử

- Lần audit gần nhất: `node --test test/*.test.mjs` đạt 8/8; `node --check` đạt 31 tệp JavaScript. Test hiện tại dùng mock, chưa chứng minh tích hợp thật.
- Máy audit chưa có `.env`; không tìm thấy FFmpeg trong PATH. Cần cấu hình bốn DB, SMTP, `PCK_OTP_SECRET` và FFmpeg trước khi chạy các luồng cần chúng. Có thể đặt `PCK_FFMPEG_PATH` nếu FFmpeg nằm ngoài PATH.
- Dùng hai tài khoản để thử đăng ký, OTP sai/hết hạn/gửi lại, đăng bài có ảnh và video Premium, xem preview, mua thử và tải. Kiểm tra cả tài khoản chưa mua và khách không tải được tệp Premium.
- Thử mất kết nối SMTP hoặc service, thiếu tệp Premium, phản hồi mua bị gián đoạn, hơn 50 bài đã lưu hoặc đã mua, cùng giao diện trên màn hình nhỏ. Ghi lại kết quả thực tế và lỗi trước khi demo.

## Cài đặt và chạy

Các lệnh dưới đây dùng PowerShell tại thư mục dự án.

1. Cài Node.js 22 trở lên, kiểm tra `node --version` và `npm --version`, sau đó cài dependencies:

   ```powershell
   npm install
   Copy-Item .env.example .env
   ```

   Nếu đã có `.env`, giữ file hiện tại và bỏ qua lệnh sao chép.

2. Mở `.env`, điền bốn connection string PostgreSQL vào `IDENTITY_DATABASE_URL`, `CONTENT_DATABASE_URL`, `COMMERCE_DATABASE_URL`, `COMMUNITY_DATABASE_URL`. Mỗi service cần một DB riêng; giữ nguyên tùy chọn TLS trong connection string. Điền thêm SMTP và `PCK_OTP_SECRET` theo phần xác minh email bên dưới. Không đưa `.env` lên Git.

3. Với bốn DB trống riêng, dùng SQL Editor của từng DB để chạy đúng file tương ứng: [Identity](migrations/01_identity.sql), [Content](migrations/02_content.sql), [Commerce](migrations/03_commerce.sql), [Community](migrations/04_community.sql). Sau đó chạy lệnh sau để thêm cấu hình gallery cho Content:

   ```powershell
   node --env-file=.env migrate-gallery.mjs
   ```

   `migrate.mjs` hiện có lỗi nhận dạng SQL như ghi ở phần việc cần làm. Với DB đã có dữ liệu, áp dụng riêng các migration còn thiếu. Chạy [10_identity_profile.sql](migrations/10_identity_profile.sql) trên Identity và [11_commerce_wallet.sql](migrations/11_commerce_wallet.sql) trên Commerce. Content có các migration riêng cho [kiểm duyệt](migrations/07_content_moderation.sql) và [preview](migrations/08_content_preview.sql).

4. Cài FFmpeg nếu cần tạo preview Premium, theo phần bên dưới. Nếu cần tài khoản admin demo trên DB riêng, chạy `node --env-file=.env seed-demo.mjs` rồi lấy thông tin tại `.pck-demo/accounts.json`.

5. Chạy `npm start`. Mở [PCK](http://127.0.0.1:3100/demo) hoặc [Kiểm tra kết nối DB](http://127.0.0.1:3100/db-check). Tạo tài khoản và xác minh email để đăng nhập. Dừng bằng Ctrl+C. Nếu cần đổi cổng, dùng `PORT` cho web hoặc `COMMERCE_PORT`, `CONTENT_PORT`, `IDENTITY_PORT`, `COMMUNITY_PORT` cho từng service.

Chạy test tự động bằng `node --test test/*.test.mjs`. Test dùng mock; cần kiểm thử thêm với DB và SMTP thật.

### Xác minh email

Điền `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` trong `.env`. Dùng `SMTP_SECURE=1` với SMTP TLS trực tiếp (thường cổng 465), hoặc `0` với STARTTLS (thường cổng 587). Đặt `PCK_OTP_SECRET` thành chuỗi ngẫu nhiên ít nhất 32 ký tự và giữ bí mật, ổn định giữa các lần chạy. Tạo chuỗi bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Không đưa các giá trị này lên Git.

Mã gồm 6 chữ số, hết hạn sau 10 phút và bị khóa sau 5 lần nhập sai. Có thể gửi mã mới sau 60 giây. Tài khoản cũ đang chờ xác minh dùng liên kết xác minh trên màn đăng nhập để yêu cầu mã. Nếu gửi email thất bại, kiểm tra cấu hình SMTP rồi thử lại.

### Nạp ví qua Stripe sandbox

1. Tạo hoặc chọn sandbox trên Stripe Dashboard, mở mục API keys và lấy secret key bắt đầu bằng `sk_test_`. Điền vào `STRIPE_SECRET_KEY` trong `.env`. Không đưa khóa lên Git hoặc gửi qua chat. `PCK_PUBLIC_URL` mặc định là `http://127.0.0.1:3100`; nếu demo qua tunnel HTTPS, đặt giá trị này thành URL gốc của tunnel.
2. Cài [Stripe CLI](https://docs.stripe.com/cli/install). Mở PowerShell mới và chạy `stripe login`, sau đó hoàn tất đăng nhập trong trình duyệt. Chọn cùng sandbox với test key ở bước 1.
3. Chạy lệnh sau trong PowerShell và giữ terminal này mở để chuyển webhook về máy local:

   ```powershell
   stripe listen '--events=checkout.session.completed,checkout.session.async_payment_succeeded' --forward-to http://127.0.0.1:3100/api/stripe/webhook
   ```

4. Điền `STRIPE_WEBHOOK_SECRET` bằng signing secret `whsec_...` do lệnh trên cung cấp. Đây là secret của CLI, không phải API key. Trong terminal khác, chạy hoặc khởi động lại ứng dụng bằng `npm start` sau khi sửa `.env`.
5. Đăng nhập PCK, vào **Tài khoản > Số dư**, chọn **Nạp qua Stripe test**. Trên Stripe Checkout, dùng [thẻ Visa test](https://docs.stripe.com/testing):
   - Số thẻ: `4242 4242 4242 4242`.
   - Ngày hết hạn: ngày bất kỳ trong tương lai, ví dụ `12/34`.
   - CVC: ba chữ số bất kỳ, ví dụ `123`. Các ô thông tin khác có thể điền tùy ý.

   Số dư chỉ được cộng khi webhook hợp lệ xác nhận thanh toán thành công. Nếu vừa quay về mà số dư chưa đổi, đợi webhook và tải lại trang. Trong terminal Stripe CLI, kiểm tra event `checkout.session.completed` trả HTTP 200.

Đây là thẻ và giao dịch test, không chuyển tiền thật. Không nhập thông tin thẻ thật hoặc dùng khóa live. Nút **Nạp thử** vẫn hoạt động riêng để demo. Với endpoint HTTPS công khai, cấu hình webhook `/api/stripe/webhook` trong Stripe Dashboard test mode và dùng signing secret tương ứng. Giao dịch hoàn tất khi webhook chưa hoạt động cần được đối soát riêng, không tự cộng khi bật webhook sau đó.

### Preview Premium

Với Content DB từ phiên bản lưu local, dừng bản app cũ rồi chạy `node --env-file=.env migrate-content-media.mjs` trên máy còn tệp gốc. Lệnh tạo bảng trên Content DB, chuyển file và báo số file còn thiếu. Chạy lại được nếu trước đó chuyển chưa xong. Bản app mới đọc tệp qua kết nối Content DB.

Với Content DB đã có dữ liệu, chạy `08_content_preview.sql` trong thư mục `migrations/` trên Neon Content. DB tạo mới từ SQL khởi tạo đã có cột này. Cài FFmpeg hỗ trợ `drawtext` và `libx264` trên máy chạy Content, rồi đưa FFmpeg vào PATH hoặc đặt `PCK_FFMPEG_PATH` bằng đường dẫn tuyệt đối tới executable. Mặc định dùng Arial trong thư mục Fonts của Windows hoặc DejaVu Sans trên Linux. Nếu cần đổi font, đặt `PCK_PREVIEW_FONT_DIR` (thư mục tuyệt đối) và `PCK_PREVIEW_FONT_FILE` (tên file font).

Sau khi cài, mở terminal mới và kiểm tra `ffmpeg -version`, `ffmpeg -filters` để tìm `drawtext`, và `ffmpeg -encoders` để tìm `libx264`. Nếu đặt `PCK_FFMPEG_PATH` thay cho PATH, gọi executable tại đường dẫn đó để kiểm tra.

Khi lưu nháp, Content tạo ảnh preview tối đa 640 px hoặc video không tiếng tối đa 480 px và 10 giây, có watermark PCK. Chọn giây bắt đầu riêng cho mỗi video Premium. Bài đã đăng từ trước giữ thẻ khóa nếu chưa có preview.

### Chia sẻ bản chạy qua Internet

Trên máy chạy PCK, đặt `PCK_SECURE_COOKIE=1` trong `.env` nếu dùng HTTPS qua tunnel, rồi chạy `npm start`. Trong terminal khác, cấu hình token ngrok bằng `ngrok config add-authtoken <TOKEN>` một lần, rồi chạy `ngrok http 3100`. Mở URL HTTPS ngrok trả về. Giữ máy và cả hai terminal hoạt động trong thời gian demo. Khi quay lại chạy HTTP local, bỏ cấu hình `PCK_SECURE_COOKIE=1` nếu trình duyệt không lưu cookie.
