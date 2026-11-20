import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { accounts, connect, passwordMatches } from './demo-accounts.mjs';
import { handleCatalog } from './demo-catalog.mjs';

const sessions = new Map();
const hour = 60 * 60 * 1000;
const maxFile = 10 * 1024 * 1024;
const signatures = {
  jpg: ['image/jpeg', b => b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255],
  png: ['image/png', b => b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'],
  mp4: ['video/mp4', b => b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp']
};
signatures.jpeg = signatures.jpg;

async function body(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function userFor(id) {
  const client = connect('IDENTITY');
  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT id, role, password_hash FROM public.users WHERE id=$1 AND status=$2', [id, 'ACTIVE']);
    return rows[0];
  } finally {
    await client.end().catch(() => {});
  }
}

async function saveUpload(userId, title, description, genreId, file, extension, mime, bytes) {
  const client = connect('CONTENT');
  const key = randomUUID() + '.' + extension;
  const directory = new URL('./.pck-demo/uploads/', import.meta.url);
  const path = new URL(key, directory);
  let wroteFile = false;
  let committing = false;
  try {
    await client.connect();
    await client.query('BEGIN');
    const { rows: [format] } = await client.query(
      'SELECT id FROM public.asset_formats WHERE extension=$1 AND mime_type=$2 AND enabled', [extension, mime]);
    if (!format) return null;
    if (genreId) {
      const { rows } = await client.query('SELECT id FROM public.genres WHERE id=$1 AND enabled FOR SHARE', [genreId]);
      if (!rows.length) return null;
    }
    await mkdir(directory, { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
    wroteFile = true;
    const { rows: [post] } = await client.query(
      'INSERT INTO public.posts (author_id,title,description) VALUES ($1,$2,$3) RETURNING id,status', [userId, title, description]);
    if (genreId) await client.query('INSERT INTO public.post_genres (post_id,genre_id) VALUES ($1,$2)', [post.id, genreId]);
    const { rows: [asset] } = await client.query(`
      INSERT INTO public.assets (post_id,format_id,original_key,filename,size_bytes,position,status)
      VALUES ($1,$2,$3,$4,$5,1,'READY') RETURNING id`,
      [post.id, format.id, 'local-demo/' + key, file.name.slice(0, 180), bytes.length]);
    committing = true;
    await client.query('COMMIT');
    return { postId: post.id, assetId: asset.id, status: post.status };
  } catch (error) {
    if (wroteFile && !committing) await unlink(path).catch(() => {});
    throw error;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}

async function readJson(req) {
  const bytes = await body(req, 16384);
  try { if (bytes) return JSON.parse(bytes.toString('utf8')); } catch {}
  return null;
}

export async function handleDemo(req, res, path, send) {
  const media = path.startsWith('/api/demo/media/') && req.method === 'GET';
  if (!media && req.headers['x-pck-demo'] !== '1') return send(res, 403, { message: 'Yêu cầu không hợp lệ.' });
  const cookieName = 'pck_demo';
  const cookieSettings = '; Path=/api/demo; HttpOnly; SameSite=Strict; Max-Age=';
  const token = (req.headers.cookie || '').match(/(?:^|;\s*)pck_demo=([\w-]+)/)?.[1];
  const session = sessions.get(token);
  const active = session && session.expires > Date.now() ? session : null;
  const method = {
    '/api/demo/session':'GET', '/api/demo/posts':'GET', '/api/demo/login':'POST',
    '/api/demo/logout':'POST', '/api/demo/upload':'POST'
  }[path];
  if (!method) return handleCatalog(req, res, path, send, active, readJson);
  if (req.method !== method) return send(res, 405, { message: 'Phương thức không hợp lệ.' });
  try {
    if (path === '/api/demo/session') {
      return send(res, 200, { user: active ? { alias: active.alias, role: active.role } : null });
    }
    if (path === '/api/demo/logout') {
      sessions.delete(token);
      res.setHeader('Set-Cookie', cookieName + '=' + cookieSettings + '0');
      return send(res, 200, { user: null });
    }
    if (path === '/api/demo/login') {
      const bytes = await body(req, 4096);
      if (!bytes) return send(res, 413, { message: 'Yêu cầu quá lớn.' });
      let login;
      try { login = JSON.parse(bytes.toString('utf8')); } catch {}
      const account = accounts.find(([alias]) => alias === login?.alias);
      if (!account || typeof login.password !== 'string' || login.password.length > 128) {
        return send(res, 401, { message: 'Tài khoản hoặc mật khẩu không đúng.' });
      }
      const user = await userFor(account[1]);
      if (!user || !passwordMatches(login.password, user.password_hash)) {
        return send(res, 401, { message: 'Tài khoản hoặc mật khẩu không đúng.' });
      }
      for (const [key, session] of sessions) if (session.expires <= Date.now()) sessions.delete(key);
      sessions.delete(token);
      const newToken = randomBytes(32).toString('base64url');
      sessions.set(newToken, { id: user.id, alias: account[0], role: user.role, expires: Date.now() + hour });
      res.setHeader('Set-Cookie', cookieName + '=' + newToken + cookieSettings + '3600');
      return send(res, 200, { role: user.role, alias: account[0] });
    }
    if (!active) return send(res, 401, { message: 'Hãy đăng nhập bằng tài khoản demo.' });
    if (path === '/api/demo/posts') {
      const client = connect('CONTENT');
      try {
        await client.connect();
        const { rows } = await client.query(`
          SELECT id, title, status FROM public.posts
          WHERE author_id = $1 ORDER BY created_at DESC, id LIMIT 50`, [active.id]);
        return send(res, 200, { posts: rows });
      } finally {
        await client.end().catch(() => {});
      }
    }
    if (path !== '/api/demo/upload') return send(res, 404, { message: 'Không tìm thấy API.' });
    if (!(req.headers['content-type'] || '').startsWith('multipart/form-data;')) {
      return send(res, 415, { message: 'Dùng form tải tệp.' });
    }
    const bytes = await body(req, maxFile + 65536);
    if (!bytes) return send(res, 413, { message: 'Tệp tối đa 10 MB.' });
    let form;
    try {
      form = await new Response(bytes, { headers: { 'Content-Type': req.headers['content-type'] } }).formData();
    } catch {
      return send(res, 400, { message: 'Form tải tệp không hợp lệ.' });
    }
    const title = form.get('title')?.toString().trim();
    const description = form.get('description')?.toString().trim() || '';
    const genreId = form.get('genre')?.toString() || '';
    const file = form.get('file');
    if (!title || title.length > 100 || !(file instanceof File) || !file.size || form.getAll('file').length !== 1) {
      return send(res, 400, { message: 'Nhập tiêu đề và chọn một tệp.' });
    }
    if (file.size > maxFile) return send(res, 413, { message: 'Tệp tối đa 10 MB.' });
    if (description.length > 1000 || (genreId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(genreId))) {
      return send(res, 400, { message: 'Mô tả hoặc thể loại không hợp lệ.' });
    }
    const extension = file.name.split('.').pop().toLowerCase();
    const content = Buffer.from(await file.arrayBuffer());
    const format = Object.hasOwn(signatures, extension) && signatures[extension];
    if (!format || !format[1](content)) return send(res, 415, { message: 'Chỉ nhận JPG, PNG hoặc MP4 hợp lệ.' });
    const result = await saveUpload(active.id, title, description, genreId, file, extension, format[0], content);
    return result ? send(res, 201, result) : send(res, 415, { message: 'Định dạng hoặc thể loại chưa được bật trong Content DB.' });
  } catch {
    return send(res, 503, { message: 'Không xử lý được yêu cầu. Kiểm tra DB và cấu hình demo.' });
  }
}
