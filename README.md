# PCK — PostgreSQL Connection Check

Trang web local để kiểm tra riêng từng kết nối PostgreSQL của Identity, Content, Commerce và Community.

## Chạy trên máy

Cần Node.js 22 trở lên. Mở terminal trong thư mục repo rồi chạy:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Mở [http://127.0.0.1:3100](http://127.0.0.1:3100) và chọn **Kiểm tra** hoặc **Kiểm tra tất cả**. Nếu đã có file `.env`, tiếp tục dùng file đó.

Khi có connection string, điền vào dòng tương ứng trong `.env`, giữ nguyên tham số TLS mà nhà cung cấp đưa, rồi khởi động lại web. Có thể cấu hình từng DB độc lập. Git bỏ qua `.env` và web chỉ hiển thị trạng thái, thông báo ngắn và thời gian kiểm tra.

Kiểm tra thành công xác nhận đăng nhập được vào PostgreSQL và chạy được `SELECT 1`. Phép thử này không kiểm tra schema, migration hoặc quyền ghi bảng.

## Tài khoản và upload demo

Chạy `node --env-file=.env seed-demo.mjs` để tạo `user1`, `user2`, `user3` và `admin`. Mật khẩu ngẫu nhiên nằm trong `.pck-demo/accounts.json`, thư mục đã được Git bỏ qua. Các ô email trong file để trống. Identity dùng địa chỉ `@pck.invalid` giữ chỗ vì DB bắt buộc email. Để đổi email, điền vào file và chạy lại seed. Bốn tài khoản được kích hoạt sẵn để thử, không gửi OTP.

Sau khi khởi động lại server, mở [PCK demo](http://127.0.0.1:3100/demo) hoặc [trang kiểm tra DB](http://127.0.0.1:3100/db-check). Demo mở thẳng ở chế độ Khách, dùng giao diện concept. Chọn **Đăng tác phẩm**, đăng nhập bằng alias và mật khẩu, nhập tiêu đề rồi chọn các tệp JPG, PNG hoặc MP4. Content ghi bài nháp và asset trong cùng transaction. **Tài khoản → Bài của tôi** đọc bài trực tiếp từ Content DB theo người đang đăng nhập.

Mở bài từ **Bài của tôi** và chọn **Phát hành** để khách có thể tìm và xem bài trong Khám phá. Tệp nằm ở `.pck-demo/uploads/` trên máy chạy server, vì vậy cần dùng máy đã upload để xem những tệp đó. Trang này dành cho localhost.

Trang demo đọc dữ liệu từ PostgreSQL. Content cấp danh mục, bài, thể loại, bộ sưu tập và sự kiện. Community lưu thích, bình luận, báo cáo và Xem sau. Commerce cung cấp danh sách quyền mua và số đơn đã trả. Khu quản trị yêu cầu role ADMIN.

## Gallery và mua thử

Chạy `node --env-file=.env migrate-gallery.mjs` một lần để thêm cấu hình tự chuyển ảnh vào Content DB. Bài đã tồn tại mặc định tắt tự chuyển.

Mỗi bài mới nhận tối đa 8 tệp, 10 MiB mỗi tệp và 40 MiB tổng cộng. Có thể thêm tệp qua nhiều lượt hoặc kéo thả. Chọn tệp đại diện và bật Premium riêng cho từng ảnh hoặc video. Tệp đại diện đứng đầu gallery và luôn công khai. Bài có tệp Premium cần ảnh đại diện và một mức giá VND để mở toàn bộ tệp đã đánh dấu. Tác giả có thể bật tự chuyển mặc định. Người xem có thể bật hoặc tắt ngay trong gallery.

Tài khoản khác chọn **Mua thử** để ghi đơn và mở quyền xem. Commerce ghi đơn `PCK_TEST`, sự kiện và quyền mua trong một transaction. Gửi lặp trả về đơn đã có. Tính năng local này không thu tiền và không kết nối sandbox.

## Sửa và gỡ bài

Chạy `node --env-file=.env migrate-post-management.mjs` một lần. Trong **Tài khoản → Bài của tôi**, chủ bài có thể sửa hoặc xóa bản nháp, kể cả thêm/xóa tệp, chọn ảnh đại diện, Premium và giá. Bài đã phát hành cho phép sửa tiêu đề, mô tả, thể loại, ảnh đại diện công khai và tự chuyển ảnh. Tệp, giá và trạng thái Premium giữ nguyên sau khi phát hành.

**Gỡ bài** loại bài đã phát hành khỏi Khám phá và dừng nhận lượt mua mới. Chủ bài và những tài khoản đã mua vẫn xem được bài. Xóa bản nháp sẽ xóa bản ghi nháp và các tệp local thuộc bản nháp đó.

## Asset giao diện

Đặt ảnh trong thư mục public/assets/hero/. Trang chủ sẽ tự chuyển ảnh mỗi 7 giây. Xem thêm [hướng dẫn asset](public/assets/README.md).

## Kiểm tra schema

```powershell
node --env-file=.env migrate.mjs
```

Lệnh trên chỉ đọc danh sách bảng trong bốn schema `public` và đối chiếu với SQL trong `migrations/`. Khi cần khởi tạo các DB trống, thêm `--apply`. Công cụ bỏ qua DB đã có đủ tên bảng, dừng nếu phát hiện schema đã có đối tượng nhưng thiếu bảng, và áp dụng từng DB trong transaction riêng. Nếu lệnh dừng giữa chừng, các DB đã commit vẫn giữ schema. Việc đủ tên bảng chưa xác nhận các cột, khóa và index khớp với SQL.

