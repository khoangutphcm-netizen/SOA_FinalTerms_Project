import { accounts } from './demo-accounts.mjs';
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
  try { await transport.sendMail({
    from:process.env.SMTP_FROM,
    to:email,
    subject:'Mã xác minh PCK',
    text:`Mã xác minh PCK của bạn là ${code}. Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`,
    html:`<!doctype html><html lang="vi"><body style="margin:0;padding:24px 12px;background:#f7f7f4;color:#20211e;font-family:Arial,sans-serif">
      <table role="presentation" style="width:100%;max-width:520px;margin:0 auto;border-collapse:collapse"><tr><td>
      <p style="margin:0 0 24px;font-size:28px;font-weight:900;letter-spacing:-2px">PCK<span style="color:#879a13">.</span></p>
      <div style="padding:32px;background:#fff;border:1px solid #e3e5df;border-radius:20px">
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">Xác minh email</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Nhập mã dưới đây để hoàn tất đăng ký tài khoản PCK.</p>
      <p style="margin:0 0 20px;padding:18px;text-align:center;background:#e8ff65;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:8px">${code}</p>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#555850">Mã có hiệu lực trong 10 phút. Không chia sẻ mã với người khác.</p>
      </div><p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#747770">Nếu bạn không yêu cầu mã này, hãy bỏ qua email.</p>
      </td></tr></table></body></html>`
  }); }
  catch {
    await query("DELETE FROM public.verification_challenges WHERE id=$1 AND consumed_at IS NULL", [id]);
    throw otpError('Không gửi được email xác minh. Hãy dùng chức năng gửi lại mã.', 503);
  }
  finally { transport.close(); }
}

export const identity = {
  async login(query, {identifier,email,password}) {
    const login = normalizeEmail(identifier ?? email);
    if (!login || login.length > 254 || typeof password !== 'string' || !password.length || password.length > 128) return null;
    const demoId = accounts.find(([alias]) => alias===login)?.[1] ?? null;
    const [user] = await query(`SELECT id,role,display_name,password_hash,avatar_updated_at FROM public.users
      WHERE (email_normalized=$1 OR id=$2::uuid)
        AND status='ACTIVE'`,[login,demoId]);
    const [method,salt,digest] = (user?.password_hash || '').split('$');
    const key = await derive(password,salt || 'pck-login-fallback',32);
    if (method!=='scrypt'||!salt||!/^[a-f0-9]{64}$/.test(digest)||!timingSafeEqual(key,Buffer.from(digest,'hex'))) return null;
    return {id:user.id,role:user.role,alias:user.display_name,avatarVersion:user.avatar_updated_at};
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
  names: (query,{ids}) => query('SELECT id,display_name,avatar_updated_at FROM public.users WHERE id=ANY($1::uuid[])',[ids])
};

