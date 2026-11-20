const login = document.querySelector('#login');
const upload = document.querySelector('#upload');
async function run(form, output, url, payload, json, onSuccess) {
  const status = document.querySelector(output);
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Đang xử lý…';
  try {
    const headers = { 'X-PCK-Demo': '1' };
    if (json) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { method: 'POST', headers, body: payload });
    const result = await response.json();
    if (!response.ok) {
      status.textContent = result.message;
      if (response.status === 401) upload.hidden = true;
      return;
    }
    status.textContent = onSuccess(result);
  } catch {
    status.textContent = 'Không nhận được phản hồi, hãy kiểm tra server.';
  } finally {
    button.disabled = false;
  }
}
login.addEventListener('submit', event => {
  event.preventDefault();
  run(login, '#login-result', '/api/demo/login', JSON.stringify(Object.fromEntries(new FormData(login))), true, result => {
    upload.hidden = false;
    login.elements.password.value = '';
    return 'Đã đăng nhập ' + result.alias + ' · ' + result.role;
  });
});
upload.addEventListener('submit', event => {
  event.preventDefault();
  run(upload, '#upload-result', '/api/demo/upload', new FormData(upload), false, result => {
    upload.reset();
    return 'Đã lưu ' + result.status + ' · Bài ' + result.postId + ' · Tệp ' + result.assetId;
  });
});
