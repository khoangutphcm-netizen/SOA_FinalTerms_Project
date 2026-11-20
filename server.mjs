import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { handleDemo } from './demo-upload.mjs';

const services = Object.freeze({
  identity: 'IDENTITY_DATABASE_URL',
  content: 'CONTENT_DATABASE_URL',
  commerce: 'COMMERCE_DATABASE_URL',
  community: 'COMMUNITY_DATABASE_URL'
});
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/db-check': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/demo': ['concept/index.html', 'text/html; charset=utf-8'],
  '/demo/': ['concept/index.html', 'text/html; charset=utf-8'],
  '/demo-assets/app.js': ['concept/app.js', 'text/javascript; charset=utf-8'],
  '/demo-assets/frame.css': ['concept/frame.css', 'text/css; charset=utf-8'],
  '/demo-assets/screens.css': ['concept/screens.css', 'text/css; charset=utf-8']
};
const inFlight = new Map();
const heroFormats = [
  ['webp', 'image/webp'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['avif', 'image/avif']
];

async function sendHero(res) {
  for (const [extension, type] of heroFormats) {
    try {
      const file = new URL('./public/assets/hero/banner.' + extension, import.meta.url);
      return send(res, 200, await readFile(file), type);
    } catch (error) {
      if (error.code !== 'ENOENT') return send(res, 500, {message: 'Không đọc được ảnh banner.'});
    }
  }
  return send(res, 404, {message: 'Chưa có ảnh banner.'});
}

function connectionError(error) {
  if (error.code === '28P01' || error.code === '28000') return 'Thông tin đăng nhập PostgreSQL bị từ chối.';
  if (error.code === '3D000') return 'Database trong chuỗi kết nối không tồn tại.';
  if (['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ENETUNREACH'].includes(error.code)) {
    return 'Không liên lạc được với máy chủ PostgreSQL.';
  }
  if (/timeout|timed out/i.test(error.message)) return 'Hết thời gian chờ kết nối hoặc chạy truy vấn.';
  return 'Không thể kết nối hoặc chạy SELECT 1. Kiểm tra cấu hình PostgreSQL, TLS và mạng.';
}

async function check(service) {
  const variable = services[service];
  const connectionString = process.env[variable]?.trim();
  if (!connectionString) return { status: 'missing', message: 'Chưa cấu hình ' + variable + '.' };
  try {
    const url = new URL(connectionString);
    if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    return { status: 'error', message: variable + ' phải là URL PostgreSQL hợp lệ.' };
  }

  let client;
  const start = performance.now();
  try {
    const { Client } = await import('pg');
    client = new Client({ connectionString, connectionTimeoutMillis: 7000, query_timeout: 5000 });
    client.on('error', () => {}); // Errors already reported by connect/query must not crash the local tool.
    await client.connect();
    await client.query('SELECT 1');
    return { status: 'ok', message: 'Kết nối thành công. SELECT 1 chạy được.', ms: Math.round(performance.now()-start) };
  } catch (error) {
    return {
      status: 'error',
      message: error.code === 'ERR_MODULE_NOT_FOUND' ? 'Chưa cài thư viện PostgreSQL. Chạy npm install.' : connectionError(error)
    };
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && path === '/assets/hero/banner') return sendHero(res);
  if (req.method === 'GET' && Object.hasOwn(assets, path)) {
    const [file, type] = assets[path];
    try {
      return send(res, 200, await readFile(new URL('./public/' + file, import.meta.url)), type);
    } catch {
      return send(res, 500, { message: 'Không đọc được giao diện kiểm tra.' });
    }
  }
  if (path.startsWith('/api/check/')) {
    if (req.method !== 'POST') return send(res, 405, { message: 'Dùng POST để chạy kiểm tra.' });
    // A custom header prevents an unrelated website from triggering connection probes.
    if (req.headers['x-pck-check'] !== '1') return send(res, 403, { message: 'Yêu cầu không hợp lệ.' });
    const service = path.slice('/api/check/'.length);
    if (!Object.hasOwn(services, service)) return send(res, 404, { message: 'Service không tồn tại.' });
    if (!inFlight.has(service)) {
      inFlight.set(service, check(service).finally(() => inFlight.delete(service)));
    }
    return send(res, 200, await inFlight.get(service));
  }
  if (path.startsWith('/api/demo/')) return handleDemo(req, res, path, send);
  send(res, 404, { message: 'Không tìm thấy đường dẫn.' });
});
const port = Number(process.env.PORT || 3100);
server.listen(port, '127.0.0.1', () => {
  console.log('PCK DB Check: http://127.0.0.1:' + server.address().port);
});
