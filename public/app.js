const names = ['Identity', 'Content', 'Commerce', 'Community'];
const list = document.querySelector('#services');
const all = document.querySelector('#all');

function makeRow(name) {
  const item = document.createElement('li');
  const heading = document.createElement('h2');
  const button = document.createElement('button');
  const row = document.createElement('div');
  const status = document.createElement('p');
  heading.textContent = name;
  button.type = 'button';
  button.textContent = 'Kiểm tra';
  button.setAttribute('aria-label', 'Kiểm tra ' + name);
  row.className = 'row';
  row.append(heading, button);
  status.setAttribute('role', 'status');
  status.textContent = 'Chưa kiểm tra.';
  item.append(row, status);
  list.append(item);

  async function run() {
    if (button.disabled) return;
    button.disabled = true;
    status.className = '';
    status.textContent = 'Đang kiểm tra…';
    try {
      const response = await fetch('/api/check/' + name.toLowerCase(), {
        method: 'POST', headers: { 'X-PCK-Check': '1' }
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      status.className = result.status;
      status.textContent = result.message + (typeof result.ms === 'number' ? ' ' + result.ms + ' ms.' : '');
    } catch {
      status.className = 'error';
      status.textContent = 'Không nhận được phản hồi từ web kiểm tra.';
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener('click', run);
  return run;
}

const checks = names.map(makeRow);
all.addEventListener('click', async () => {
  all.disabled = true;
  try {
    await Promise.all(checks.map(run => run()));
  } finally {
    all.disabled = false;
  }
});
