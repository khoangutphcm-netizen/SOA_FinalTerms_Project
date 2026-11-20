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

Content gọi các service khác qua HTTP nội bộ. Người dùng đăng ký bằng email và phải xác minh OTP trước khi đăng nhập. Phiên lưu trong bộ nhớ và mua thử dùng `PCK_TEST`. Thanh toán QR sandbox và kho tệp dùng chung chưa được tích hợp. Tệp tải lên nằm trong `.pck-demo/uploads/` của máy chạy Content.

## Việc cần làm theo ưu tiên

- **P1: Nghiệp vụ và demo**: Tích hợp thanh toán sandbox; cấu hình DB và SMTP để kiểm thử OTP, đăng nhập, đăng bài và mua hàng từ giao diện. Hiện chưa có `.env` tại máy audit; test tự động dùng mock.
- **P1: Dữ liệu và giao diện**: Danh sách Xem sau và Đã mua chỉ lấy 50 bài gần nhất. Cần phân trang và sửa trạng thái nút lưu trong trang khám phá khi có hơn 50 bài đã lưu.
- **P1: Bảo vệ xác thực**: Giới hạn đăng nhập và đăng ký hiện dùng chung theo đường dẫn cho mọi người dùng. Cần giới hạn theo nguồn hoặc tài khoản để một người không chặn người khác.
- **P2: Tiêu chí triển khai và giám sát**: Bổ sung Docker Compose, Prometheus và dashboard Grafana cho các service. Docker đang để làm sau theo kế hoạch hiện tại. Kiểm thử ngrok khi có môi trường chạy.
- **P2: Độ ổn định**: Phiên đăng nhập mất khi khởi động lại; tệp upload lưu trên máy Content; một tiến trình dừng sẽ làm launcher dừng toàn bộ hệ thống. Cần cân nhắc lưu phiên và tệp bền vững, cùng cơ chế phục hồi service.
- **P2: Kiểm thử giao diện**: Kiểm tra luồng thực tế, màn hình nhỏ, trạng thái tải và lỗi của từng chức năng. Chưa có kết quả kiểm thử trình duyệt với DB và SMTP thật.
- **P3: Dọn giao diện cũ**: `public/concept/index.html` là giao diện chính, `public/index.html` kiểm tra DB; `public/demo.html` là trang demo cũ không được khai báo route. Xác nhận còn cần trước khi xóa.

## Cách chạy

1. Cài Node.js 22 trở lên. Mở terminal trong thư mục repo và chạy `npm install`.
2. Nếu chưa có `.env`, chạy `Copy-Item .env.example .env` trong PowerShell. Điền bốn kết nối Neon nhóm cấp vào `IDENTITY_DATABASE_URL`, `CONTENT_DATABASE_URL`, `COMMERCE_DATABASE_URL`, `COMMUNITY_DATABASE_URL`. Giữ `.env` ngoài Git.
3. Nếu dùng DB trống riêng, chạy `node --env-file=.env migrate.mjs --apply`, rồi `node --env-file=.env migrate-gallery.mjs`. Nếu dùng branch cũ thiếu bảng kiểm duyệt, áp dụng [migration kiểm duyệt](migrations/07_content_moderation.sql) trên Content DB.
4. Tạo tài khoản trên màn chào. Nếu cần tài khoản admin demo trên DB riêng, chạy `node --env-file=.env seed-demo.mjs` rồi lấy thông tin ở `.pck-demo/accounts.json`.
5. Chạy `npm start`. Mở [PCK](http://127.0.0.1:3100/demo) hoặc [Kiểm tra kết nối DB](http://127.0.0.1:3100/db-check). Dừng bằng Ctrl+C. Nếu cần đổi cổng, dùng `PORT` cho web hoặc `COMMERCE_PORT`, `CONTENT_PORT`, `IDENTITY_PORT`, `COMMUNITY_PORT` cho từng service.

### Xác minh email

Điền `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` trong `.env`. Dùng `SMTP_SECURE=1` với SMTP TLS trực tiếp (thường cổng 465), hoặc `0` với STARTTLS (thường cổng 587). Đặt `PCK_OTP_SECRET` thành chuỗi ngẫu nhiên ít nhất 32 ký tự và giữ bí mật, ổn định giữa các lần chạy. Tạo chuỗi bằng `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Không đưa các giá trị này lên Git.

Mã gồm 6 chữ số, hết hạn sau 10 phút và bị khóa sau 5 lần nhập sai. Có thể gửi mã mới sau 60 giây. Tài khoản cũ đang chờ xác minh dùng liên kết xác minh trên màn đăng nhập để yêu cầu mã. Nếu gửi email thất bại, kiểm tra cấu hình SMTP rồi thử lại.

### Preview Premium

Với Content DB đã có dữ liệu, chạy `08_content_preview.sql` trong thư mục `migrations/` trên Neon Content. DB tạo mới từ SQL khởi tạo đã có cột này. Cài FFmpeg hỗ trợ `drawtext` và `libx264` trên máy chạy Content, rồi đưa FFmpeg vào PATH hoặc đặt `PCK_FFMPEG_PATH` bằng đường dẫn tuyệt đối tới executable. Mặc định dùng Arial trong thư mục Fonts của Windows hoặc DejaVu Sans trên Linux. Nếu cần đổi font, đặt `PCK_PREVIEW_FONT_DIR` (thư mục tuyệt đối) và `PCK_PREVIEW_FONT_FILE` (tên file font).

Khi lưu nháp, Content tạo ảnh preview tối đa 640 px hoặc video không tiếng tối đa 480 px và 10 giây, có watermark PCK. Chọn giây bắt đầu riêng cho mỗi video Premium. Bài đã đăng từ trước giữ thẻ khóa nếu chưa có preview.

### Chia sẻ bản chạy qua Internet

Trên máy chạy PCK, đặt `PCK_SECURE_COOKIE=1` trong `.env` nếu dùng HTTPS qua tunnel, rồi chạy `npm start`. Trong terminal khác, cấu hình token ngrok bằng `ngrok config add-authtoken <TOKEN>` một lần, rồi chạy `ngrok http 3100`. Mở URL HTTPS ngrok trả về. Giữ máy và cả hai terminal hoạt động trong thời gian demo. Khi quay lại chạy HTTP local, bỏ cấu hình `PCK_SECURE_COOKIE=1` nếu trình duyệt không lưu cookie.
