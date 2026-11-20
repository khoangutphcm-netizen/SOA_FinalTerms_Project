# PCK — Website chia sẻ và mua bán nội dung số

PCK là đồ án cuối kỳ SOA. Khách duyệt ảnh và video, tác giả đăng bài nhiều tệp và chọn tệp Premium, người mua xem lại nội dung trong mục Đã mua. Admin có thể ẩn tạm hoặc gỡ bài do vi phạm. Xem sau cho phép lưu và bỏ lưu bài ngay trong tài khoản.

## Trạng thái hiện tại

Web nhận yêu cầu tại cổng 3100 và chuyển API ứng dụng tới Content. Bốn service chạy ở bốn tiến trình riêng và mỗi service dùng kết nối Neon của mình.

| Service | Cổng mặc định | Phụ trách |
|---|---:|---|
| Commerce | 3101 | Mua thử, đơn hàng và quyền xem Premium |
| Content | 3102 | Bài đăng, tệp, tìm kiếm và kiểm duyệt |
| Identity | 3103 | Xác thực tài khoản demo và thông tin người dùng |
| Community | 3104 | Thích, bình luận, báo cáo và Xem sau |

Content gọi các service khác qua HTTP nội bộ. Hiện đăng nhập bằng tài khoản demo, phiên lưu trong bộ nhớ, và mua thử dùng `PCK_TEST`. OTP email, thanh toán QR sandbox và kho tệp dùng chung chưa được tích hợp. Tệp tải lên nằm trong `.pck-demo/uploads/` của máy chạy Content.

## Cách chạy

1. Cài Node.js 22 trở lên. Mở terminal trong thư mục repo và chạy `npm install`.
2. Nếu chưa có `.env`, chạy `Copy-Item .env.example .env` trong PowerShell. Điền bốn kết nối Neon nhóm cấp vào `IDENTITY_DATABASE_URL`, `CONTENT_DATABASE_URL`, `COMMERCE_DATABASE_URL`, `COMMUNITY_DATABASE_URL`. Giữ `.env` ngoài Git.
3. Nếu dùng DB trống riêng, chạy `node --env-file=.env migrate.mjs --apply`, rồi `node --env-file=.env migrate-gallery.mjs`. Nếu dùng branch cũ thiếu bảng kiểm duyệt, áp dụng [migration kiểm duyệt](migrations/07_content_moderation.sql) trên Content DB.
4. Dùng tài khoản demo nhóm cấp. Với DB riêng, có thể chạy `node --env-file=.env seed-demo.mjs` rồi lấy thông tin ở `.pck-demo/accounts.json`.
5. Chạy `npm start`. Mở [PCK](http://127.0.0.1:3100/demo) hoặc [Kiểm tra kết nối DB](http://127.0.0.1:3100/db-check). Dừng bằng Ctrl+C. Nếu cần đổi cổng, dùng `PORT` cho web hoặc `COMMERCE_PORT`, `CONTENT_PORT`, `IDENTITY_PORT`, `COMMUNITY_PORT` cho từng service.
