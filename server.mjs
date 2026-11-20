import { createServer, request } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { callService, servicePort } from './internal-services.mjs';
import { commerce } from './commerce-client.mjs';

const services = Object.freeze({
  identity: 'IDENTITY_DATABASE_URL',
  content: 'CONTENT_DATABASE_URL',
  commerce: 'COMMERCE_DATABASE_URL',
  community: 'COMMUNITY_DATABASE_URL'
});
const assets = {
  '/assets/welcome/welcome.png': ['assets/welcome/welcome.png', 'image/png'],
  '/assets/welcome/welcome2.png': ['assets/welcome/welcome2.png', 'image/png'],
  '/assets/welcome/welcome3.png': ['assets/welcome/welcome3.png', 'image/png'],
  '/': ['concept/index.html', 'text/html; charset=utf-8'],
  '/db-check': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/demo': ['concept/index.html', 'text/html; charset=utf-8'],
  '/demo/': ['concept/index.html', 'text/html; charset=utf-8'],
  '/demo-assets/app.js': ['concept/app.js', 'text/javascript; charset=utf-8'],
  '/demo-assets/frame.css': ['concept/frame.css', 'text/css; charset=utf-8'],
  '/demo-assets/screens.css': ['concept/screens.css', 'text/css; charset=utf-8']
};
const inFlight = new Map();
const authWindows = new Map();

function allowAuth(path) {
  const minute = Math.floor(Date.now()/60000);
  const previous = authWindows.get(path);
  const count = previous?.minute===minute ? previous.count+1 : 1;
  authWindows.set(path,{minute,count});
  return count <= (path.endsWith('/register') ? 20 : 60);
}
const heroFormats = [
  ['webp', 'image/webp'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['avif', 'image/avif']
];
const heroFolder = new URL('./public/assets/hero/', import.meta.url);

async function sendHero(res, path) {
  try {
    const files = (await readdir(heroFolder, {withFileTypes:true}))
      .filter(entry => entry.isFile() && heroFormats.some(([extension]) => entry.name.toLowerCase().endsWith('.' + extension)))
      .map(entry => entry.name)
      .sort((a,b) => a.localeCompare(b,'vi',{numeric:true}));
    const images = files.map(name => '/assets/hero/image/' + encodeURIComponent(name));
    if (path === '/assets/hero/images') return send(res, 200, {images});
    const index = path === '/assets/hero/banner' ? 0 : images.indexOf(path);
    const file = files[index];
    if (!file) return send(res, 404, {message:'Không tìm thấy ảnh banner.'});
    const [, type] = heroFormats.find(([extension]) => file.toLowerCase().endsWith('.' + extension));
    return send(res, 200, await readFile(new URL(encodeURIComponent(file), heroFolder)), type);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return path === '/assets/hero/images' ? send(res, 200, {images:[]}) : send(res, 404, {message:'Không tìm thấy ảnh banner.'});
    }
    return send(res, 500, {message:'Không đọc được ảnh banner.'});
  }
}

async function check(service) {
  const start = performance.now();
  try {
    const result = service === 'commerce'
      ? await commerce('/health')
      : await callService(service.toUpperCase(),'health');
    return {...result,ms:Math.round(performance.now()-start)};
  } catch (error) {
    return {status:'error',message:error.message};
  }
}

function proxyContent(req,res) {
  const headers = {};
  for (const name of ['content-type','content-length','cookie','range','x-pck-demo']) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  headers.authorization = 'Bearer ' + process.env.PCK_INTERNAL_TOKEN;
  const upstream = request({
    hostname:'127.0.0.1', port:servicePort('CONTENT'), path:req.url, method:req.method, headers
  }, response => {
    response.on('error', () => res.destroy());
    res.writeHead(response.statusCode,response.headers);
    response.pipe(res);
  });
  const savesMedia = req.url === '/api/demo/upload' || req.url.startsWith('/api/demo/edit-draft/');
  upstream.setTimeout(savesMedia ? 210000 : 60000,() => upstream.destroy(new Error('Content timeout')));
  upstream.on('error',() => {
    req.unpipe(upstream);
    req.resume();
    if (res.headersSent) return res.destroy();
    if (!res.destroyed) send(res,503,{message:'Content đang không phản hồi.'});
  });
  res.on('close',() => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && (path === '/assets/hero/banner' || path === '/assets/hero/images' || path.startsWith('/assets/hero/image/'))) {
    return sendHero(res, path);
  }
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
  if (path.startsWith('/api/demo/')) {
    if (req.method==='POST' && req.headers['x-pck-demo']==='1' &&
        ['/api/demo/login','/api/demo/register','/api/demo/verify','/api/demo/resend'].includes(path) && !allowAuth(path)) {
      res.setHeader('Retry-After','60');
      return send(res,429,{message:'Có quá nhiều yêu cầu. Hãy thử lại sau một phút.'});
    }
    return proxyContent(req, res);
  }
  send(res, 404, { message: 'Không tìm thấy đường dẫn.' });
});
const port = Number(process.env.PORT || 3100);
server.listen(port, '127.0.0.1', () => {
  console.log('PCK DB Check: http://127.0.0.1:' + server.address().port);
});
