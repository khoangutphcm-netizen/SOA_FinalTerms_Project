# Tiến độ PCK

Cập nhật ngày 21/11/2026. PCK là đồ án SOA chia sẻ và mua ảnh, video. Gateway chuyển yêu cầu đến bốn service Identity, Content, Commerce và Community; mỗi service kết nối DB Neon riêng.

## Tiến độ theo rubric

| Tiêu chí | Hiện trạng | Việc còn lại |
| --- | --- | --- |
| Phân tích và thiết kế | Có đặc tả, Use Case, ERD, SQL và sơ đồ kiến trúc. | Đồng bộ tài liệu với OTP, ví, Stripe, lưu media và kiểm duyệt. |
| Microservices | Có gateway và bốn service giao tiếp qua HTTP. | Kiểm tra lại sơ đồ và chuẩn bị bằng chứng service phối hợp khi demo. |
| Chức năng và nghiệp vụ | Có đăng ký OTP, bài nhiều tệp, preview, Xem sau, Đã mua, bộ sưu tập và quản trị cơ bản. Có ví demo và Stripe Checkout test để nạp ví. | Kiểm thử trọn luồng bằng hai tài khoản, gồm nạp ví, mua và tải. Stripe Checkout hiện không phải tích hợp QR riêng. |
| Giao tiếp và tích hợp | Có REST API, SMTP và Stripe webhook xác thực chữ ký. Ví xử lý lặp webhook theo mã yêu cầu. | Thử callback thất bại, gửi lại và mất kết nối service; ghi kết quả. |
| Dữ liệu và bảo mật | Có DB riêng, phân quyền admin và kiểm tra quyền tải. Media và preview lưu trong Content DB. | Phiên hiện lưu RAM. Cải thiện giới hạn xác thực và kiểm tra quyền truy cập trực tiếp tới media. |
| Đóng gói và triển khai | Có `npm start` và hướng dẫn ngrok. | Bổ sung Docker Compose và thử truy cập qua Internet. Theo rubric, thiếu Docker Compose giới hạn tối đa 7,5 điểm. |
| Giám sát | Có trang kiểm tra kết nối DB. | Tích hợp Prometheus và Grafana. Theo rubric, thiếu cả hai giới hạn tối đa 8,0 điểm. |
| Kiểm thử và chất lượng mã | Có test OTP, quyền truy cập, giao diện mua và Stripe webhook. | Bổ sung bằng chứng kiểm thử trên trình duyệt, DB và các ca lỗi thực tế. |
| Báo cáo, demo và hỏi đáp | Có README và tài liệu nền. | Cập nhật báo cáo, chuẩn bị kịch bản demo và giải thích kiến trúc. |

## Kết quả kiểm tra

- Ngày 21/11/2026, `node --test test/*.test.mjs` đạt 11/11. Test tự động dùng mock cho các phần tích hợp.
- Đã kiểm tra kết nối bốn service với Neon, gửi email SMTP thật và thử đăng ký, xác minh OTP, đăng nhập bằng tài khoản tạm.
- Đã tạo Stripe Checkout Session test. Webhook test qua Stripe CLI trả HTTP 200; một giao dịch test đã được đối soát và cộng vào ví. Cần ghi thêm bằng chứng kiểm thử toàn bộ luồng trên giao diện.
- Đã kiểm tra FFmpeg trên máy phát triển có `drawtext` và `libx264`. Cấu hình riêng nằm trong `.env` và không được commit.

## Việc ưu tiên

1. Sửa `migrate.mjs` không nhận dạng được `CREATE TABLE` xuống dòng, rồi kiểm thử với DB trống. Trước khi sửa, dùng hướng dẫn SQL thủ công trong README.
2. Chạy và ghi kết quả luồng OTP, đăng bài, nạp ví Stripe test, mua và tải bằng hai tài khoản. Kiểm tra cả quyền tải của khách và người chưa mua.
3. Giới hạn xác thực theo nguồn hoặc tài khoản; thống nhất phản hồi gửi lại OTP để tránh lộ trạng thái tài khoản.
4. Cải thiện Xem sau khi có hơn 50 bài và phân trang thư viện. Kiểm tra giao diện trên màn hình nhỏ và khi mất kết nối.
5. Bổ sung Docker Compose, Prometheus và Grafana; kiểm tra ngrok khi có môi trường triển khai.
6. Đồng bộ Use Case, ERD, sơ đồ service và báo cáo với bản thực tế.

## Lưu ý cho demo

- Giữ Stripe CLI chạy với đúng cú pháp PowerShell trong README. Nếu webhook chưa hoạt động lúc thanh toán, giao dịch cũ cần đối soát riêng.
- Luồng mua dùng số dư demo và đơn `PCK_WALLET_TEST`; Stripe chỉ được dùng để nạp ví ở test mode.
- Preview video đã có thời lượng và nút lấy mốc đang phát. Cần kiểm tra thao tác và dữ liệu thực tế trên trình duyệt.
- Khi một tiến trình dừng, launcher hiện dừng toàn bộ cụm. Khi khởi động lại, phiên đăng nhập trong RAM bị mất.
