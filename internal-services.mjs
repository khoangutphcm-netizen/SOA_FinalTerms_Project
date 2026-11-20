import { createServer } from 'node:http';
import { accounts, connect } from './demo-accounts.mjs';
import { randomBytes, randomInt, createHmac, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import nodemailer from 'nodemailer';

const derive = promisify(scrypt);
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const otpError = (message, status = 400) => Object.assign(new Error(message), {status});
function otpMac(userId, code) {
  if (!process.env.PCK_OTP_SECRET || process.env.PCK_OTP_SECRET.length < 32) throw otpError('Chưa cấu hình PCK_OTP_SECRET.', 503);
  return createHmac('sha256', process.env.PCK_OTP_SECRET).update(userId + ':' + code).digest();
}
async function issueOtp(query, email) {
  const [user] = await query("SELECT id FROM public.users WHERE email_normalized=$1 AND status='PENDING_VERIFICATION' FOR UPDATE", [email]);
  if (!user) return;
  const [recent] = await query("SELECT created_at > now()-interval '60 seconds' AS recent FROM public.verification_challenges WHERE user_id=$1 AND purpose='VERIFY_EMAIL' ORDER BY created_at DESC LIMIT 1", [user.id]);
  if (recent?.recent) throw otpError('Hãy đợi 60 giây trước khi gửi lại mã.', 429);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !process.env.SMTP_FROM) throw otpError('Chưa cấu hình SMTP.', 503);
  const code = String(randomInt(1000000)).padStart(6, '0');
  await query("UPDATE public.verification_challenges SET revoked_at=now() WHERE user_id=$1 AND purpose='VERIFY_EMAIL' AND consumed_at IS NULL AND revoked_at IS NULL", [user.id]);
  const [challenge] = await query("INSERT INTO public.verification_challenges (user_id,purpose,target_email,code_mac,expires_at) VALUES ($1,'VERIFY_EMAIL',$2,$3,now()+interval '10 minutes') RETURNING id", [user.id,email,otpMac(user.id,code)]);
  return {id:challenge.id,email,code};
}
async function sendOtp(query, challenge) {
  if (!challenge) return;
  const {id,email,code} = challenge;
  const transport = nodemailer.createTransport({host:process.env.SMTP_HOST, port:Number(process.env.SMTP_PORT || 587), secure:process.env.SMTP_SECURE === '1', requireTLS:true, auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}, connectionTimeout:10000, greetingTimeout:10000, socketTimeout:10000});
  try { await transport.sendMail({from:process.env.SMTP_FROM,to:email,subject:'Mã xác minh PCK',text:`Mã xác minh PCK của bạn là ${code}. Mã có hiệu lực trong 10 phút.`}); }
  catch {
    await query("DELETE FROM public.verification_challenges WHERE id=$1 AND consumed_at IS NULL", [id]);
    throw otpError('Không gửi được email xác minh. Hãy dùng chức năng gửi lại mã.', 503);
  }
  finally { transport.close(); }
}

export function servicePort(service) {
  return Number(process.env[service + '_PORT'] || {COMMERCE:3101,CONTENT:3102,IDENTITY:3103,COMMUNITY:3104}[service]);
}

export async function callService(service, operation, input = {}, {timeoutMs=25000} = {}) {
  let response;
  let data;
  try {
    response = await fetch('http://127.0.0.1:' + servicePort(service) + '/' + operation, {
      method:'POST', headers:{Authorization:'Bearer ' + process.env.PCK_INTERNAL_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify(input), signal:AbortSignal.timeout(timeoutMs)
    });
    data = await response.json();
  } catch {
    throw Object.assign(new Error(service + ' đang không phản hồi.'),{status:503});
  }
  if (!response.ok) throw Object.assign(new Error(data.message),{status:response.status});
  return data;
}

export const identity = {
  async login(query, {identifier,email,password}) {
    const login = normalizeEmail(identifier ?? email);
    if (!login || login.length > 254 || typeof password !== 'string' || !password.length || password.length > 128) return null;
    const demoId = accounts.find(([alias]) => alias===login)?.[1] ?? null;
    const [user] = await query(`SELECT id,role,display_name,password_hash FROM public.users
      WHERE (email_normalized=$1 OR id=$2::uuid)
        AND status='ACTIVE'`,[login,demoId]);
    const [method,salt,digest] = (user?.password_hash || '').split('$');
    const key = await derive(password,salt || 'pck-login-fallback',32);
    if (method!=='scrypt'||!salt||!/^[a-f0-9]{64}$/.test(digest)||!timingSafeEqual(key,Buffer.from(digest,'hex'))) return null;
    return {id:user.id,role:user.role,alias:user.display_name};
  },
  async register(query, {email,password,displayName}) {
    email = normalizeEmail(email);
    displayName = typeof displayName === 'string' ? displayName.trim() : '';
    if (email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !displayName || displayName.length>80 || typeof password!=='string'||password.length<8||password.length>128) {
      throw Object.assign(new Error('Kiểm tra email, tên hiển thị và mật khẩu từ 8 đến 128 ký tự.'),{status:400});
    }
    const salt = randomBytes(16).toString('hex');
    const hash = 'scrypt$'+salt+'$'+(await derive(password,salt,32)).toString('hex');
    await query('BEGIN');
    let challenge;
    try {
    const [user] = await query(`INSERT INTO public.users (email_normalized,display_name,password_hash,role,status)
      VALUES ($1,$2,$3,'USER','PENDING_VERIFICATION') ON CONFLICT (email_normalized) DO NOTHING
      RETURNING id,role,display_name`,[email,displayName,hash]);
    if(!user)throw Object.assign(new Error('Không thể đăng ký email này. Nếu đã có tài khoản, hãy đăng nhập.'),{status:409});
    challenge = await issueOtp(query,email);
    await query('COMMIT');
    } catch (error) { await query('ROLLBACK'); throw error; }
    await sendOtp(query,challenge);
    return {message:'Mã xác minh đã được gửi tới email.'};
  },
  async resend(query, {email}) {
    email = normalizeEmail(email);
    if (!email || email.length > 254) throw otpError('Email không hợp lệ.');
    await query('BEGIN');
    let challenge;
    try { challenge = await issueOtp(query,email); await query('COMMIT'); }
    catch (error) { await query('ROLLBACK'); throw error; }
    await sendOtp(query,challenge);
    return {message:'Nếu tài khoản đang chờ xác minh, mã đã được gửi.'};
  },
  async verify(query, {email,code}) {
    email = normalizeEmail(email);
    if (!email || email.length > 254 || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw otpError('Email hoặc mã xác minh không hợp lệ.');
    await query('BEGIN');
    try {
      const [user] = await query("SELECT id FROM public.users WHERE email_normalized=$1 AND status='PENDING_VERIFICATION' FOR UPDATE",[email]);
      const [challenge] = user ? await query(`SELECT id,user_id,code_mac,expires_at > now() AS valid FROM public.verification_challenges
        WHERE user_id=$1 AND purpose='VERIFY_EMAIL' AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE`,[user.id]) : [];
      if (!challenge || !challenge.valid) { await query('COMMIT'); throw otpError('Mã không hợp lệ hoặc đã hết hạn.'); }
      if (!timingSafeEqual(challenge.code_mac,otpMac(challenge.user_id,code))) {
        await query('UPDATE public.verification_challenges SET attempts_used=attempts_used+1, revoked_at=CASE WHEN attempts_used+1>=5 THEN now() ELSE NULL END WHERE id=$1',[challenge.id]);
        await query('COMMIT'); throw otpError('Mã không hợp lệ hoặc đã hết hạn.');
      }
      await query('UPDATE public.verification_challenges SET consumed_at=now() WHERE id=$1',[challenge.id]);
      await query("UPDATE public.users SET status='ACTIVE',email_verified_at=now() WHERE id=$1",[challenge.user_id]);
      await query('COMMIT');
      return {message:'Xác minh thành công. Hãy đăng nhập.'};
    } catch (error) { await query('ROLLBACK'); throw error; }
  },
  names: (query,{ids}) => query('SELECT id,display_name FROM public.users WHERE id=ANY($1::uuid[])',[ids])
};

const community = {
  saved: (query,{userId}) => query('SELECT post_id FROM public.saved_posts WHERE user_id=$1 ORDER BY saved_at DESC LIMIT 50',[userId]),
  reports: query => query("SELECT id,post_id,reason FROM public.reports WHERE status='OPEN' ORDER BY created_at DESC LIMIT 50"),
  dismiss: (query,{id,userId}) => query("UPDATE public.reports SET status='DISMISSED',resolved_by=$2,resolved_at=now() WHERE id=$1 AND status='OPEN'",[id,userId]),
  async detail(query,{id,userId}) {
    const comments = await query('SELECT id,author_id,body,created_at FROM public.comments WHERE post_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 50',[id]);
    const [reaction] = await query(`SELECT (SELECT count(*)::int FROM public.likes WHERE post_id=$1) AS likes,
      EXISTS(SELECT 1 FROM public.likes WHERE post_id=$1 AND user_id=$2) AS liked,
      EXISTS(SELECT 1 FROM public.saved_posts WHERE post_id=$1 AND user_id=$2) AS saved`,[id,userId]);
    return {comments,reaction};
  },
  async interact(query,{action,method,id,userId,content}) {
    if (['like','save'].includes(action) && ['PUT','DELETE'].includes(method)) {
      const table = action === 'like' ? 'likes' : 'saved_posts';
      const sql = method === 'PUT'
        ? `INSERT INTO public.${table} (user_id,post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`
        : `DELETE FROM public.${table} WHERE user_id=$1 AND post_id=$2`;
      await query(sql,[userId,id]);
      return {active:method === 'PUT'};
    }
    if (action === 'comments') {
      await query('INSERT INTO public.comments (author_id,post_id,body) VALUES ($1,$2,$3)',[userId,id,content]);
    } else if (action === 'report') {
      await query(`INSERT INTO public.reports (reporter_id,post_id,reason) VALUES ($1,$2,$3)
        ON CONFLICT (reporter_id,post_id) WHERE status='OPEN' DO NOTHING`,[userId,id,content]);
    } else throw new Error('Unknown interaction');
    return {saved:true};
  }
};

export function startDataService(service) {
  const handlers = {health:async query => {
    await query('SELECT 1');
    return {status:'ok',message:service + ' đã kết nối PostgreSQL.'};
  }, ...{IDENTITY:identity,COMMUNITY:community}[service]};
  const token = process.env.PCK_INTERNAL_TOKEN;
  if (!token) throw new Error('PCK_INTERNAL_TOKEN is required');
  createServer(async (req,res) => {
    const send = (status,data) => {
      res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization !== 'Bearer ' + token) return send(403,{message:'Yêu cầu nội bộ.'});
    const operation = req.url.slice(1);
    if (req.method !== 'POST' || !Object.hasOwn(handlers,operation)) return send(404,{message:'Không tìm thấy API.'});
    let client;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req.iterator({destroyOnReturn:false})) {
        if ((size += chunk.length) > 65536) {
          req.resume();
          return send(413,{message:'Yêu cầu quá lớn.'});
        }
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      client = connect(service);
      client.on('error', () => {});
      await client.connect();
      const query = async (sql,params) => (await client.query(sql,params)).rows;
      send(200,await handlers[operation](query,input));
    } catch (error) {
      send(error.status||503,{message:error.status?error.message:'Không xử lý được yêu cầu tại ' + service + '.'});
    } finally {
      await client?.end().catch(() => {});
    }
  }).listen(servicePort(service),'127.0.0.1',() => console.log('PCK ' + service + ': ' + servicePort(service)));
}
