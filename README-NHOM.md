# PCK — Hướng dẫn chạy demo và kế hoạch nhóm

PCK là website chia sẻ và mua nội dung số. Mỗi bài có thể chứa nhiều ảnh hoặc video. Tác giả chọn ảnh đại diện công khai, đánh dấu từng tệp Premium và đặt một giá để mở toàn bộ tệp Premium của bài.

## Chạy demo trên máy

1. Mở terminal trong thư mục repo. Cài Node.js 22 trở lên rồi chạy `npm install`.
2. Nếu chưa có `.env`, chạy `Copy-Item .env.example .env` trong PowerShell. Điền bốn biến `IDENTITY_DATABASE_URL`, `CONTENT_DATABASE_URL`, `COMMERCE_DATABASE_URL`, `COMMUNITY_DATABASE_URL` theo kết nối Neon nhóm cấp. Giữ file này trên máy, tránh đưa lên Git.
3. Với bốn DB trống của môi trường riêng, chạy `node --env-file=.env migrate.mjs --apply`, rồi chạy `node --env-file=.env migrate-gallery.mjs` để thêm cấu hình gallery. Với DB nhóm đã chuẩn bị, dùng schema đã có. Nếu thiếu cấu trúc trên một DB đang dùng, báo người giữ DB để áp dụng đúng migration.
4. Nếu môi trường chưa có tài khoản demo và nhóm giao bạn chuẩn bị dữ liệu, chạy `node --env-file=.env seed-demo.mjs`. Trên môi trường dùng chung, lấy tài khoản từ người giữ DB. File tài khoản khi seed nằm trong `.pck-demo/accounts.json`.
5. Chạy `npm start`. Mở [demo](http://127.0.0.1:3100/demo) hoặc [trang kiểm tra kết nối](http://127.0.0.1:3100/db-check). Kết nối xanh xác nhận DB phản hồi, chưa xác nhận đầy đủ schema.

Tệp upload nằm trong `.pck-demo/uploads/` trên máy chạy web. Hai máy dùng chung Neon vẫn có thể thấy cùng bản ghi bài và chỉ máy giữ tệp mới mở được media đó. Để demo nhóm, dùng chung một máy chạy web hoặc upload bài mới trên máy đang trình bày.

## Các phần đang có

| Phần | Trạng thái |
|---|---|
| Identity | Có phiên đăng nhập với tài khoản demo và vai trò USER/ADMIN. Đăng ký thật và OTP email còn mở. |
| Content | Khách duyệt và xem nội dung công khai. Tác giả tạo, sửa, xóa nháp, upload nhiều tệp, chọn bìa và Premium, phát hành hoặc gỡ bài. |
| Commerce | Mua thử `PCK_TEST` ghi đơn và cấp quyền mở tệp. Tác giả gỡ bài thì người đã mua vẫn xem được. Thanh toán qua cổng và hoàn tiền còn ngoài demo. |
| Community và Admin | Có thích, bình luận, báo cáo, Xem sau và khu quản trị. Admin có thể ẩn tạm, gỡ do vi phạm và phục hồi quyền xem. |
| Kiến trúc chạy | Một tiến trình Node.js chạy các luồng demo với bốn kết nối DB. Việc tách thành các service chạy riêng và trao đổi qua API vẫn cần triển khai nếu môn yêu cầu. |

## Thứ tự làm tiếp

1. **Content + Admin.** Đã nối API và giao diện kiểm duyệt. Content ghi trạng thái và lịch sử cùng transaction. Neon Content của nhóm đã có migration. Với DB Content cũ trên branch khác, chạy [07_content_moderation.sql](migrations/07_content_moderation.sql) trong SQL Editor của branch đó trước khi khởi động bản mới.
2. **Kiến trúc SOA và Commerce.** Chốt tiêu chí của môn về service chạy riêng. Ưu tiên trình diễn Content hỏi Commerce về quyền mua qua API, với mỗi service chỉ truy cập DB của mình. Hoàn thiện mục Đã mua và thông báo khi quyền không kiểm tra được hoặc tệp không còn khả dụng. Giữ luồng mua thử cho buổi demo.
3. **Identity.** Triển khai đăng ký và xác minh OTP qua email theo đặc tả nếu nằm trong bản nộp. Bộ tài khoản demo vẫn dùng để trình diễn các luồng khác trong lúc phát triển.
4. **Chuẩn bị bàn giao.** Đồng bộ UC04, UC06, UC07, UC10, ERD và sơ đồ trao đổi service với hành vi cuối cùng. Thanh toán sandbox, kho tệp dùng chung và định dạng mở rộng làm sau khi luồng chính ổn.

## Kịch bản trình diễn

Tác giả tạo nháp với một ảnh bìa và hai tệp Premium, sửa nháp rồi phát hành. Khách thấy bài và bản xem trước. Người mua đăng nhập, mua thử và tìm lại bài trong Đã mua. Admin ẩn tạm thì dừng bán và người mua cũ vẫn mở được. Admin gỡ do vi phạm thì chặn cả tệp và đường dẫn trực tiếp. Đơn vẫn hiện trong Đã mua. Chọn **Gỡ chặn** để phục hồi quyền xem cho người mua, rồi chọn **Bỏ ẩn** nếu muốn mở bán lại. Nếu tác giả đã tự gỡ thì bài vẫn ngừng bán.
