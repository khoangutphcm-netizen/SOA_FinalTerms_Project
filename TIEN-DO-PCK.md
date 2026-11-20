# Tiến độ PCK

PCK là đồ án SOA về chia sẻ và mua ảnh, video. Bản hiện tại có luồng đăng bài → xem trước → mua thử → tải. Ba lỗi ưu tiên dưới đây đã được xử lý trong source. Luồng trên trình duyệt và Neon cần được chạy lại sau các thay đổi này.

OTP email đã được thêm vào source: cần cấu hình SMTP và `PCK_OTP_SECRET`, sau đó kiểm thử với Neon và email thật. Thanh toán vẫn dùng `PCK_TEST`; chưa tích hợp sandbox của nhà cung cấp.

## Tiến độ theo rubric

| Tiêu chí                        | Tiến độ hiện tại                                                                                                           | Việc còn lại                                                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phân tích và thiết kế (1,5)     | Có đặc tả, Use Case, ERD, SQL và sơ đồ luồng mua.                                                                          | Đồng bộ ERD và Use Case với preview, kiểm duyệt và quyền tải sau khi gỡ bài.                                                                         |
| Microservices (1,5)             | Có gateway và 4 tiến trình riêng. Mỗi service dùng DB Neon của mình. Content gọi Identity, Community và Commerce qua HTTP. | Sửa sơ đồ theo đường gọi thật và ghi lại bằng chứng các service phối hợp trong demo.                                                                 |
| Chức năng và nghiệp vụ (1,5)    | Có đăng ký, đăng nhập, bài nhiều tệp, Khám phá, xem trước, mua thử, Đã mua, Xem sau, bộ sưu tập và quản trị cơ bản.        | Chạy lại luồng chính bằng hai tài khoản. Khép các mục đã cam kết như OTP, QR sandbox và phạm vi quản trị.                                            |
| Giao tiếp và tích hợp (1,0)     | Có API web, API nội bộ và kiểm tra kết nối. Mua thử đã có bước kiểm tra lại kết quả khi phản hồi bị gián đoạn.             | Thử lỗi giữa các service và tích hợp email, QR sandbox sau khi luồng chính ổn.                                                                       |
| Dữ liệu và bảo mật (1,0)        | Có PK/UQ/FK trong từng DB, quyền admin và kiểm tra quyền khi tải.                                                          | Phiên đăng nhập còn lưu trong bộ nhớ. Tệp còn nằm trên máy Content. Cần kiểm tra truy cập trực tiếp URL gốc bằng tài khoản chưa mua.                 |
| Đóng gói và triển khai (1,0)    | Có `npm start` và hướng dẫn ngrok trong README.                                                                            | Làm Docker Compose, cấu hình FFmpeg và lưu tệp cho Content, rồi chứng minh truy cập được từ Internet. Thiếu Compose giới hạn tối đa 7,5 theo rubric. |
| Giám sát (1,0)                  | Có trang kiểm tra kết nối DB.                                                                                              | Thêm Prometheus và Grafana để xem trạng thái, số request, lỗi và độ trễ. Thiếu bộ giám sát giới hạn tối đa 8,0.                                      |
| Kiểm thử và chất lượng mã (0,5) | Có luồng demo và xử lý yêu cầu mua lặp trong Commerce.                                                                     | Lưu ca kiểm thử API và kết quả chạy thật, gồm lỗi thiếu tệp, mua hết thời gian chờ và service phụ mất kết nối.                                       |
| Báo cáo, demo và hỏi đáp (1,0)  | Có README, sơ đồ và bộ đặc tả làm nền.                                                                                     | Đồng bộ báo cáo với bản đóng gói, diễn tập đăng → mua → tải và giải thích các ca lỗi.                                                                |

Điểm trong bảng là trọng số rubric. Mức hoàn thành còn phụ thuộc vào kết quả chạy và bằng chứng demo.

## Trouble cần theo dõi

| Trouble                                                        | Tiến độ                                                                                                                              | Cách kiểm tra hoặc việc còn lại                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Bài hiện nút tải dù mất tệp gốc                                | **Đã sửa trong source.** Content kiểm tra tệp khi mở chi tiết. Nếu tệp Premium bị thiếu, web báo rõ và API tạm dừng nhận mua bài đó. | Thử trên dữ liệu demo có tệp bị thiếu. Xác nhận bài đã mua vẫn còn trong lịch sử. Kho chung vẫn cần nếu đổi máy host.                          |
| Yêu cầu mua hết thời gian chờ nhưng Commerce có thể đã ghi đơn | **Đã sửa trong source.** Web chuyển sang xác nhận và hỏi lại quyền của đúng bài trước khi cho mua thử lại.                           | Chạy thử với Commerce phản hồi chậm. Xác nhận một lần mua chỉ sinh một quyền. Luồng hiện tại chỉ dành cho mua thử.                             |
| Community hoặc Identity lỗi làm mất gallery                    | **Đã sửa trong source.** Trang chi tiết vẫn trả gallery khi không lấy được tương tác hoặc tên tác giả.                               | Thử lỗi ở từng API nội bộ. Nếu cả tiến trình service dừng, launcher hiện tại sẽ dừng cụm. Cần kiểm tra riêng khả năng phục hồi khi triển khai. |
| Chọn mốc preview video khó                                     | **Còn mở.** Có ô nhập giây và player trong form.                                                                                     | Hiện thời lượng, thêm nút lấy mốc đang phát, kiểm tra mốc trước khi lưu.                                                                       |
| Lưu nhanh có thể nhận sai trạng thái của bài lưu cũ            | **Còn mở.** Khám phá lấy trạng thái từ danh sách Xem sau giới hạn 50 mục.                                                            | Trả trạng thái theo các ID trên trang hiện tại và bổ sung phân trang khi cần.                                                                  |

## UI/UX

**Đủ rõ để dẫn người dùng qua một buổi demo, cần kiểm chứng bằng thao tác thật.** Người xem có thể vào Khám phá với vai trò khách, đổi nhanh giữa Ảnh, Video và Hỗn hợp, xem preview, biết số tệp Premium sẽ được mở và tìm lại bài trong Đã mua.

- **Đăng bài:** Đã có nháp, chọn đại diện, chọn Premium từng tệp. Vướng nhất là chọn thời điểm video và chờ tạo preview.
- **Mua và tải:** Đã có thông báo xác nhận tại nút mua, trạng thái tệp thiếu và nút tải cạnh tệp đang xem. Cần thử trên điện thoại và kiểm tra người dùng có tìm ra đúng tệp sau khi mua.
- **Tìm và lưu:** Đã có lọc trực tiếp, chủ đề nhanh và nút Lưu trên thẻ. Cần rà trạng thái khi mất kết nối và sau khi đăng nhập trở lại.

**Mốc gần nhất:** dùng hai tài khoản và một bài hỗn hợp để chạy trọn luồng đăng, xem trước, mua thử và tải trên máy khác. Sau đó ghi lại kết quả ba ca lỗi ưu tiên ở trên.
