# PCK | Website chia sẻ và mua bán nội dung số

PCK là một hệ thống cho phép người dùng khám phá ảnh, video, đăng tác phẩm nhiều tệp, tương tác và mua nội dung Premium. Thanh toán trong đồ án sử dụng ví demo; Stripe Sandbox được dùng để nạp số dư thử nghiệm.

## Chức năng chính

- Đăng ký, xác minh email bằng OTP, đăng nhập và quản lý hồ sơ.
- Tìm kiếm, lọc và xem trước tác phẩm; thích, bình luận, báo cáo và lưu Xem sau.
- Tạo bộ sưu tập; đăng, chỉnh sửa và quản lý tác phẩm ảnh hoặc video.
- Nạp ví qua Stripe Checkout test, mua bằng ví, xem và tải nội dung đã mua.
- Quản trị tài khoản, ví demo, bài đăng, báo cáo, thể loại và sự kiện.
- Thu thập metrics bằng Prometheus và hiển thị dashboard Grafana.

## Kiến trúc

Gateway phục vụ giao diện và chuyển API ứng dụng tới Content. Content trao đổi HTTP với các service nội bộ; mỗi service sử dụng một PostgreSQL riêng.

| Thành phần | Cổng mặc định | Trách nhiệm                                       |
| ---------- | ------------: | ------------------------------------------------- |
| Gateway    |          3100 | Giao diện, định tuyến API và webhook Stripe       |
| Commerce   |          3101 | Ví demo, đơn hàng, thanh toán và quyền mua        |
| Content    |          3102 | Tác phẩm, tệp, tìm kiếm, bộ sưu tập và kiểm duyệt |
| Identity   |          3103 | Tài khoản, OTP, hồ sơ và phân quyền               |
| Community  |          3104 | Thích, bình luận, báo cáo và Xem sau              |

Metrics được cung cấp riêng trên các cổng 9461 đến 9465. Trong Docker Compose, Prometheus và Grafana dùng lần lượt cổng 9090 và 3000 trên localhost.

## Yêu cầu

- Bốn PostgreSQL riêng, có thể dùng Neon. Các kết nối cần hỗ trợ TLS.
- Với chế độ Node: Node.js 22 trở lên, npm và FFmpeg có `drawtext` và `libx264` để tạo preview.
- Với Docker: Docker Desktop và Docker Compose. Image đã có Node.js, FFmpeg và font cần thiết.
- SMTP để gửi OTP. Stripe CLI và khóa sandbox để nạp ví qua Stripe. Ngrok cần tài khoản và authtoken nếu trình bày qua Internet.

## Cấu hình ban đầu

Mở PowerShell trong thư mục dự án:

```powershell
Copy-Item .env.example .env
npm ci
```

Nếu đã có `.env`, không chạy lệnh sao chép đè file. `npm ci` chỉ cần cho chế độ Node, không bắt buộc với Docker.

Điền các biến sau trong `.env`:

| Biến                                                                                               | Mục đích                                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `IDENTITY_DATABASE_URL`, `CONTENT_DATABASE_URL`, `COMMERCE_DATABASE_URL`, `COMMUNITY_DATABASE_URL` | Bốn chuỗi kết nối PostgreSQL riêng                                 |
| `PCK_OTP_SECRET`                                                                                   | Khóa ngẫu nhiên ổn định, ít nhất 32 ký tự                          |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`                 | Cấu hình gửi email OTP                                             |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                                       | Khóa test Stripe và signing secret của webhook                     |
| `PCK_PUBLIC_URL`                                                                                   | URL gốc để Stripe quay lại; local mặc định `http://127.0.0.1:3100` |
| `PORT`                                                                                             | Cổng Gateway, mặc định 3100                                        |
| `GRAFANA_ADMIN_PASSWORD`                                                                           | Mật khẩu Grafana khi dùng Compose; nên đặt trước lần chạy đầu      |

Với Gmail, dùng SMTP `smtp.gmail.com`, cổng `587`, `SMTP_SECURE=0` và App Password. Không đưa `.env`, mật khẩu hoặc khóa lên Git. Nếu FFmpeg không nằm trong PATH, đặt `PCK_FFMPEG_PATH` thành đường dẫn đầy đủ tới executable trên máy chạy Content.

### Khởi tạo cơ sở dữ liệu

Với bốn DB trống, chạy lần lượt các file SQL tương ứng trên từng DB: [Identity](migrations/01_identity.sql), [Content](migrations/02_content.sql), [Commerce](migrations/03_commerce.sql), [Community](migrations/04_community.sql). Sau đó chạy:

```powershell
node --env-file=.env migrate-gallery.mjs
```

Với DB đã có dữ liệu, kiểm tra phiên bản schema và áp dụng các migration còn thiếu theo thứ tự. Không chạy lại SQL khởi tạo lên DB đang sử dụng. Các migration riêng gồm `06` đến `10` cho Content hoặc Identity và `11`, `13`, `14`, `15` cho Commerce; xem nội dung từng file trong [migrations](migrations/) trước khi áp dụng. Để kiểm tra các bảng khởi tạo mà không thay đổi DB:

```powershell
node --env-file=.env migrate.mjs
```

Lệnh chỉ kiểm tra sự hiện diện bảng, không xác nhận đầy đủ cột, ràng buộc hoặc migration. Việc khởi tạo DB trống vẫn cần được kiểm thử theo môi trường triển khai.

## Các cách chạy

Các script sau chạy ở foreground. Dừng từng terminal bằng `Ctrl+C`. Trên Windows, có thể thay lệnh PowerShell bằng `start-pck.bat` với cùng tham số `-Mode`.

### 1. Node.js trên máy local

```powershell
./start-pck.ps1 -Mode Local
```

Hoặc chạy `npm start`. Mở [PCK](http://127.0.0.1:3100) và [kiểm tra kết nối DB](http://127.0.0.1:3100/db-check). Launcher khởi chạy Gateway cùng bốn service. Khi một tiến trình dừng bất ngờ, launcher dừng cả cụm; phiên đăng nhập trong RAM mất khi Content khởi động lại.

### 2. Docker Compose

Khởi động Docker Desktop và chạy:

```powershell
./start-pck.ps1 -Mode Docker
```

Hoặc chạy `docker compose up --build`. Mở [PCK](http://127.0.0.1:3100), [Prometheus](http://127.0.0.1:9090/targets) và [Grafana](http://127.0.0.1:3000). Grafana dùng user `admin` và mật khẩu `GRAFANA_ADMIN_PASSWORD`; Compose mặc định là `admin` nếu chưa đặt. Dashboard nằm tại **Dashboards > PCK > PCK Service Overview**. Cần xác nhận 5 target có trạng thái **UP**.

### 3. Node.js và ngrok

Cấu hình ngrok một lần bằng `ngrok config add-authtoken <TOKEN>` hoặc đặt `NGROK_AUTHTOKEN` trong `.env`, sau đó chạy:

```powershell
./start-pck.ps1 -Mode Ngrok
```

Hoặc chạy `npm run ngrok`. Mở URL HTTPS được in sau `PCK ngrok`. Launcher tự cấu hình URL Stripe trả về và cookie an toàn. Agent API mặc định dùng cổng 4040; đặt `PCK_NGROK_API_PORT` nếu đã thay đổi. Kiểm tra URL từ một mạng khác trước khi báo cáo.

### 4. Prometheus và Grafana ngoài Docker

Chạy PCK bằng Node trước. Tạo `prometheus-local.yml` trong thư mục Prometheus:

```yaml
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: pck
    static_configs:
      - targets:
          [
            "127.0.0.1:9461",
            "127.0.0.1:9462",
            "127.0.0.1:9463",
            "127.0.0.1:9464",
            "127.0.0.1:9465",
          ]
```

Mở terminal tại thư mục Prometheus, chạy `./prometheus.exe --config.file=prometheus-local.yml --web.listen-address=127.0.0.1:9090`. Trong terminal khác tại thư mục gốc Grafana, chạy `./bin/grafana.exe server`. Tại Grafana, thêm Prometheus data source với URL `http://127.0.0.1:9090` và UID `prometheus`, sau đó import `grafana-prometheus/grafana/dashboards/pck-overview.json`. Mở Targets để xác nhận 5 service được thu thập. Không dùng trực tiếp file cấu hình Prometheus của Compose vì file đó chứa hostname Docker.

## Cấu hình và thử Stripe Sandbox

1. Chọn Stripe Sandbox và đặt test secret key vào `STRIPE_SECRET_KEY`. Khóa test bắt đầu bằng `sk_test_`, `rk_test_` hoặc `rkcs_test_` tùy môi trường.
2. Cài Stripe CLI, đăng nhập và chọn cùng sandbox. Mở terminal riêng, chạy:

   ```powershell
   ./start-pck.ps1 -Mode Stripe
   ```

   Nếu Gateway dùng cổng khác, thêm `-Port <cong>`. Giữ listener mở. Sao chép signing secret `whsec_...` do CLI cấp vào `STRIPE_WEBHOOK_SECRET` trong `.env` và khởi động lại PCK. Key và webhook phải thuộc cùng sandbox.

3. Đăng nhập, mở **Tài khoản > Số dư > Nạp qua Stripe test**. Dùng thẻ test `4242 4242 4242 4242`, ngày hết hạn trong tương lai và CVC ba chữ số bất kỳ.
4. Kiểm tra listener nhận `checkout.session.completed` với HTTP 200, rồi tải lại ví để xem số dư và lịch sử. Hủy hoặc chưa thanh toán không cộng ví. Nếu webhook chưa chạy lúc thanh toán, cần gửi lại sự kiện hoặc đối soát giao dịch.

Khi dùng webhook HTTPS đăng ký trên Stripe Dashboard, trỏ endpoint tới `/api/stripe/webhook` của URL công khai và dùng signing secret của endpoint đó. Không dùng khóa live hoặc thẻ thật cho demo.

## Kiểm thử

```powershell
./start-pck.ps1 -Mode Test
```

Hoặc chạy `node --test test/*.test.mjs`. Bộ test bao gồm OTP, quyền truy cập, xử lý mua và webhook Stripe; các tích hợp trong test được mock. Khi demo, kiểm tra thêm OTP qua email, đăng tác phẩm, nạp Stripe, mua và tải bằng hai tài khoản, cùng các chức năng quản trị.

## Lưu ý vận hành

- Nếu cổng bận, dừng phiên tương ứng trước khi chạy lại. Không cần dừng các ứng dụng Node khác.
- Nếu ví chưa tăng sau Stripe, kiểm tra listener, signing secret, sandbox và HTTP response của webhook.
- Nếu preview không tạo được, kiểm tra FFmpeg, `drawtext`, `libx264` và đường dẫn font.
- Phiên web hiện lưu trong RAM, vì vậy cần đăng nhập lại sau khi Content khởi động lại.
- Các script tạo tài khoản demo dùng `node --env-file=.env seed-demo.mjs`; thông tin ở `.pck-demo/accounts.json`. Script không ghi đè tài khoản đã có mật khẩu khác.

## Cấu trúc dự án

- `server.mjs`, `start.mjs`: Gateway và launcher.
- `content-*.mjs`, `identity-*.mjs`, `community-handlers.mjs`, `commerce-*.mjs`: nghiệp vụ service.
- `public/concept/`: giao diện chính.
- `migrations/`: schema và migration PostgreSQL.
- `grafana-prometheus/`: metrics, cấu hình thu thập và dashboard.
- `test/`: kiểm thử tự động.

[hướng dẫn triển khai](HOW-TO-RUN.md), [đặc tả Use Case](presentation\dac-ta-usecase.pdf) và [slide trình bày](presentation\presentation.pptx)
