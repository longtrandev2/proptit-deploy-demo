# Hướng dẫn deploy lên VPS

Làm theo thứ tự Lab 1 → Lab 5, đúng như quy trình Buổi 12.

Quy ước: **[Máy cá nhân]** là chạy trên máy của bạn, **[VPS]** là chạy sau khi đã SSH vào server. Thay `<USER>`, `<VPS_IP>`, `<DOMAIN>`, `<GITHUB_REPO_URL>` bằng thông tin của bạn.

Yêu cầu VPS: Ubuntu 22.04/24.04, tối thiểu 2GB RAM (hoặc 1GB RAM kèm 2GB swap, vì Maven build trên VPS khá tốn RAM).

---

## Lab 1 — Kết nối và chuẩn bị VPS

```bash
# [Máy cá nhân] Đăng nhập bằng SSH key
ssh-keygen -t ed25519 -C "<email>"     # bỏ qua nếu đã có key
ssh-copy-id <USER>@<VPS_IP>
ssh <USER>@<VPS_IP>
```

```bash
# [VPS] Khảo sát server
whoami; cat /etc/os-release; free -h; df -h; ss -tulpn

# [VPS] Cài Git, Docker
sudo apt update && sudo apt upgrade -y
sudo apt install -y git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

```bash
# [Máy cá nhân] Đăng nhập lại để quyền nhóm docker có hiệu lực
ssh <USER>@<VPS_IP>
# [VPS]
docker run --rm hello-world
docker compose version
```

```bash
# [VPS] Firewall: mặc định chặn, chỉ mở các port cần thiết
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp          # PHẢI mở SSH trước khi bật UFW
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp        # tạm thời cho Lab 3, sẽ xoá ở Lab 4
sudo ufw enable
sudo ufw status numbered
```

Kiểm tra thêm firewall trên trang quản trị của nhà cung cấp VPS (nếu có): các port trên cũng phải được mở.

*(Tuỳ chọn) VPS chỉ có 1GB RAM thì tạo swap:*

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Lab 2 — Chạy thử bằng Docker ở máy cá nhân

Dự án đã có sẵn `Dockerfile`, `docker-compose.yml`, `.env.example`. Nếu máy có Docker Desktop:

```bash
# [Máy cá nhân]
cp .env.example .env
docker compose up -d --build
# Mở http://localhost:3000, gửi thử một lời nhắn
docker compose down
```

Chạy được bằng Docker ở máy cá nhân thì gần như chắc chắn chạy được trên VPS, vì môi trường đã được đóng gói cùng ứng dụng.

---

## Lab 3 — Deploy lên VPS

```bash
# [VPS]
cd ~
git clone <GITHUB_REPO_URL> app
cd app
cp .env.example .env
nano .env
```

Trong `.env`:

- Đặt `DB_PASSWORD`, `DB_ROOT_PASSWORD` thành mật khẩu mạnh.
- Tạm đặt `PUBLISH_IP=0.0.0.0` để thử truy cập từ Internet qua port 3000.

```bash
# [VPS]
docker compose up -d --build     # lần đầu mất vài phút để tải image và dependency
docker compose ps
docker compose logs -f backend   # chờ dòng "Started GuestbookApplication", Ctrl+C để thoát
```

**Kiểm tra từ trong ra ngoài:**

```bash
# [VPS] Tầng 1: ứng dụng trên chính server
curl -i http://localhost:8080/api/info      # backend trực tiếp
curl -i http://localhost:3000/api/info      # qua Nginx của container frontend
```

```bash
# [Máy cá nhân] Tầng 2: từ Internet
curl -i http://<VPS_IP>:3000/api/info
# hoặc mở trình duyệt: http://<VPS_IP>:3000
```

Trên trang web, tầng **Tên miền** và **Nginx** đang **vàng** (vì đang dùng IP và vào thẳng port 3000), tầng **Spring Boot** và **MySQL** phải **xanh**.

Thử truy cập `http://<VPS_IP>:8080/api/info` từ máy cá nhân sẽ **không được**, vì backend chỉ bind `127.0.0.1:8080`.

**Kiểm tra khả năng tự phục hồi:**

```bash
# [VPS]
sudo reboot
# [Máy cá nhân] sau khoảng 1 phút
ssh <USER>@<VPS_IP>
cd ~/app && docker compose ps      # các container tự chạy lại nhờ restart: unless-stopped
```

Lời nhắn đã gửi vẫn còn, vì dữ liệu MySQL nằm trong volume `db_data`.

---

## Lab 4 — Nginx, tên miền và HTTPS

**Bước 1. Bản ghi DNS.** Trên trang quản lý DNS, thêm bản ghi `A`: Name `api` (hoặc subdomain được cấp), Value `<VPS_IP>`, TTL 300.

```bash
# [Máy cá nhân]
nslookup <DOMAIN>
```

Nếu chưa có tên miền, dùng `<VPS_IP>.nip.io` (không làm được bước HTTPS).

**Bước 2. Cài Nginx trên host**

```bash
# [VPS]
sudo apt install -y nginx
sudo systemctl status nginx
```

Mở `http://<VPS_IP>` sẽ thấy trang "Welcome to nginx!".

**Bước 3. Cấu hình reverse proxy**

```bash
# [VPS]
cd ~/app
sudo cp deploy/nginx/guestbook.conf /etc/nginx/sites-available/guestbook
sudo nano /etc/nginx/sites-available/guestbook      # sửa server_name thành <DOMAIN>
sudo ln -s /etc/nginx/sites-available/guestbook /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Mở `http://<DOMAIN>`: tầng **Tên miền** và **Nginx** chuyển **xanh**; dòng "Backend nhìn thấy bạn" hiện **IP thật** của bạn chứ không phải `127.0.0.1` hay `172.x.x.x`.

**Bước 4. Đóng truy cập trực tiếp vào container**

```bash
# [VPS]
nano .env                        # đổi PUBLISH_IP=127.0.0.1
docker compose up -d             # tạo lại container frontend với port mới
sudo ufw delete allow 3000/tcp
```

Kiểm tra: `http://<VPS_IP>:3000` **không còn** truy cập được, còn `http://<DOMAIN>` vẫn hoạt động. Nginx trên host đã trở thành điểm vào duy nhất.

> Vì sao phải đổi `PUBLISH_IP` mà không chỉ xoá luật UFW? Vì Docker tự thêm luật iptables **trước** UFW, port đã publish ra `0.0.0.0` vẫn truy cập được dù UFW chặn.

**Bước 5. Bật HTTPS (cần tên miền thật)**

```bash
# [VPS]
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <DOMAIN>
sudo certbot renew --dry-run
sudo cat /etc/nginx/sites-available/guestbook       # xem certbot đã thêm gì
```

Mở `https://<DOMAIN>`: **tất cả các tầng xanh**, và dòng "Backend nhìn thấy bạn" ghi giao thức **https**: header `X-Forwarded-Proto` đã đi qua 2 lớp Nginx tới Spring Boot.

---

## Lab 5 — Cập nhật phiên bản và xử lý sự cố

**Phần 1. Cập nhật phiên bản mới**

Sửa code ở máy cá nhân (ví dụ đổi tiêu đề trong `frontend/public/index.html`), commit, push. Sau đó:

```bash
# [VPS]
cd ~/app
git pull
nano .env                            # tăng APP_VERSION=1.1.0
docker compose up -d --build
docker compose logs -f backend
```

Trong lúc backend khởi động lại, trang báo đỏ **502 Bad Gateway** ở tầng Spring Boot, vài giây sau chuyển xanh với **phiên bản mới** và **Container ID mới**. Đây là hạn chế của deploy một instance (cần zero-downtime deployment để khắc phục).

**Phần 2. Xử lý sự cố (làm theo cặp)**

Người A gây một lỗi, người B mở trang web xem tầng nào đỏ rồi dùng bộ công cụ chẩn đoán để tìm nguyên nhân.

| Lỗi được tạo ra | Hiện tượng mong đợi |
|---|---|
| `docker compose stop backend` | Trang báo 502 ở tầng Spring Boot |
| `docker compose stop frontend` | Nginx host trả 502 cho cả trang |
| Sửa `proxy_pass` trong Nginx host thành port 3001, reload | 502, `error.log` báo connection refused |
| `sudo ufw delete allow 80/tcp` (và 443) | Trình duyệt báo timeout |
| Đổi `DB_PASSWORD` trong `.env` rồi `docker compose up -d` | Backend restart liên tục, log báo `Access denied` |
| `docker compose stop db` | Tầng MySQL đỏ, các tầng khác vẫn xanh |
| Sửa `server_name` sai tên miền | Hiện trang mặc định của Nginx |

Bộ công cụ chẩn đoán, dùng theo thứ tự **từ trong ra ngoài**:

```bash
docker compose ps                             # container có đang chạy không
docker compose logs --tail=100 backend        # ứng dụng báo lỗi gì
curl -i http://localhost:8080/api/info        # backend có phản hồi trên server không
curl -i http://localhost:3000/api/info        # Nginx trong container frontend có chuyển tiếp được không
sudo nginx -t                                 # cấu hình Nginx host có hợp lệ không
sudo tail -n 50 /var/log/nginx/error.log      # Nginx host báo lỗi gì
sudo ufw status                               # firewall có chặn không
sudo ss -tulpn                                # port nào đang được lắng nghe
dig +short <DOMAIN>                           # tên miền đã trỏ đúng IP chưa
```

---

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Build bị dừng, VPS treo | Thiếu RAM khi Maven build | Tạo swap (Lab 1) |
| `permission denied ... docker.sock` | User chưa thuộc nhóm `docker` | `sudo usermod -aG docker $USER`, đăng nhập lại |
| Backend `Restarting` | Sai mật khẩu DB, thiếu biến trong `.env` | `docker compose logs backend` |
| `Access denied for user 'guestbook'` | Đổi mật khẩu trong `.env` sau khi volume đã khởi tạo | Dùng lại mật khẩu cũ, hoặc `docker compose down -v` (**mất dữ liệu**) |
| `bind: address already in use` | Port 3000/8080 đã bị chiếm | `sudo ss -tulpn \| grep 3000` |
| Backend thấy IP `172.x.x.x`, giao thức `http` | Thiếu header `X-Forwarded-*` hoặc thiếu `forward-headers-strategy` | Kiểm tra `deploy/nginx/guestbook.conf`, `application-prod.yml` |
| Certbot lỗi xác thực | Tên miền chưa trỏ đúng IP, port 80 bị chặn | `dig +short <DOMAIN>`, `sudo ufw status` |
