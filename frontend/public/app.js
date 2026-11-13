// Frontend gọi API bằng đường dẫn tương đối (/api/...) -> cùng origin với trang,
// Nginx sẽ chuyển tiếp sang backend. Không cần biết backend ở IP/port nào.
const API = '/api';

const $ = (selector) => document.querySelector(selector);

// ---------- Hành trình của request ----------

function setStep(name, state, detail, hint = '') {
  const el = document.querySelector(`[data-step="${name}"]`);
  el.className = `step ${state}`;
  el.querySelector('.detail').textContent = detail;
  el.querySelector('.hint').textContent = hint;
}

function checkDomain() {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    setStep('domain', 'warn', 'Đang chạy ở máy cá nhân (localhost).',
      'Trên VPS: tạo bản ghi A  api -> <VPS_IP>, kiểm tra bằng: nslookup <DOMAIN>');
  } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    setStep('domain', 'warn', `Đang truy cập bằng IP ${host}, chưa có tên miền.`,
      'Lab 4: tạo bản ghi A trỏ tên miền về IP này (hoặc dùng ' + host + '.nip.io)');
  } else {
    setStep('domain', 'ok', `DNS đã phân giải ${host} về server này.`);
  }
}

function checkHttps() {
  if (location.protocol === 'https:') {
    setStep('https', 'ok', 'Kết nối được mã hoá bằng TLS, chứng chỉ hợp lệ.');
  } else {
    setStep('https', 'warn', 'Đang dùng HTTP: dữ liệu truyền đi dạng văn bản thuần.',
      'sudo certbot --nginx -d <DOMAIN>   # cần tên miền thật trỏ về VPS');
  }
}

function checkNginx(res) {
  const server = res.headers.get('server') || 'không rõ';
  if (location.port === '3000') {
    setStep('nginx', 'warn',
      `Đang vào thẳng container frontend qua port 3000 (${server}), chưa qua Nginx trên host.`,
      'Lab 4: cấu hình Nginx reverse proxy (deploy/nginx/guestbook.conf), rồi đặt PUBLISH_IP=127.0.0.1 trong .env');
  } else {
    setStep('nginx', 'ok', `Request đi qua ${server} ở port ${location.port || (location.protocol === 'https:' ? 443 : 80)}.`);
  }
}

function renderClient(client) {
  const pageScheme = location.protocol.replace(':', '');
  const schemeNote = client.scheme === pageScheme
    ? ''
    : ` <b>(khác với ${pageScheme} của trình duyệt — header X-Forwarded-Proto chưa được chuyển đúng)</b>`;
  $('#client').innerHTML =
    `Backend nhìn thấy bạn: IP <b>${escapeHtml(client.ip)}</b>, giao thức <b>${escapeHtml(client.scheme)}</b>${schemeNote}, ` +
    `tên miền <b>${escapeHtml(client.host)}</b>. ` +
    `<span class="muted">Có được thông tin này là nhờ Nginx gửi kèm header X-Forwarded-* và Spring Boot bật forward-headers-strategy.</span>`;
}

async function checkSystem() {
  checkDomain();
  checkHttps();

  let res;
  try {
    res = await fetch(`${API}/info`, { cache: 'no-store' });
  } catch (e) {
    setStep('nginx', 'fail', 'Không kết nối được tới server.', 'sudo ufw status · sudo systemctl status nginx · dig +short <DOMAIN>');
    setStep('backend', '', 'Chưa kiểm tra được.');
    setStep('database', '', 'Chưa kiểm tra được.');
    $('#client').innerHTML = '';
    return done();
  }

  checkNginx(res);

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    setStep('backend', 'fail', `${res.status} ${res.statusText || 'Bad Gateway'}: Nginx không gọi được Spring Boot.`,
      'docker compose ps\ndocker compose logs --tail=100 backend\ncurl -i http://localhost:8080/api/info');
    setStep('database', '', 'Chưa kiểm tra được vì backend không phản hồi.');
    $('#client').innerHTML = '';
    return done();
  }

  let data;
  try {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    setStep('backend', 'fail', `Backend trả về lỗi: ${e.message}.`, 'docker compose logs --tail=100 backend');
    setStep('database', '', 'Chưa kiểm tra được.');
    return done();
  }

  const { app, client, database } = data;
  setStep('backend', 'ok',
    `Phiên bản ${app.version} · profile ${app.profiles.join(', ') || 'default'} · Java ${app.javaVersion} · ` +
    `container ${app.hostname} (chính là CONTAINER ID trong docker ps).`);

  if (database.status === 'UP') {
    setStep('database', 'ok', `${database.product} · ${database.url} · ${database.messages} lời nhắn.`);
  } else {
    setStep('database', 'fail', `Không kết nối được database: ${database.error}`,
      'docker compose ps db\ndocker compose logs --tail=50 db\n# Kiểm tra DB_PASSWORD trong .env có khớp lần khởi tạo volume đầu tiên không');
  }

  renderClient(client);
  done();
}

function done() {
  $('#checked-at').textContent = `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN')}`;
}

// ---------- Sổ lưu bút ----------

async function loadMessages() {
  try {
    const res = await fetch(`${API}/messages`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderMessages(await res.json());
  } catch (e) {
    $('#messages').innerHTML = `<li class="muted">Chưa tải được lời nhắn (${escapeHtml(e.message)}).</li>`;
  }
}

function renderMessages(messages) {
  if (messages.length === 0) {
    $('#messages').innerHTML = '<li class="muted">Chưa có lời nhắn nào. Hãy là người đầu tiên!</li>';
    return;
  }
  $('#messages').innerHTML = messages.map((m) => `
    <li>
      <div class="meta"><b>${escapeHtml(m.author)}</b> · ${new Date(m.createdAt).toLocaleString('vi-VN')}</div>
      <p>${escapeHtml(m.content)}</p>
    </li>`).join('');
}

$('#form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#submit');
  button.disabled = true;
  $('#form-error').textContent = '';
  try {
    const res = await fetch(`${API}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: $('#author').value, content: $('#content').value }),
    });
    if (!res.ok) throw new Error(res.status === 400 ? 'Tên và lời nhắn không được để trống.' : `Lỗi HTTP ${res.status}`);
    $('#content').value = '';
    await Promise.all([loadMessages(), checkSystem()]);
  } catch (e) {
    $('#form-error').textContent = e.message;
  } finally {
    button.disabled = false;
  }
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

$('#recheck').addEventListener('click', checkSystem);
checkSystem();
loadMessages();
setInterval(checkSystem, 5000);
