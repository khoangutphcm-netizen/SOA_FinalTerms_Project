import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import { identity } from '../internal-services.mjs';

const secret = 'test-only-secret-with-at-least-32-characters';
Object.assign(process.env, {
  PCK_OTP_SECRET:secret, SMTP_HOST:'smtp.example.test', SMTP_USER:'test',
  SMTP_PASSWORD:'test', SMTP_FROM:'test@example.test'
});

function queriesForResend(events) {
  return async (sql, params) => {
    events.push(sql);
    if (sql.startsWith('SELECT id FROM public.users')) return [{id:'user-id'}];
    if (sql.startsWith('SELECT created_at')) return [];
    if (sql.startsWith('INSERT INTO public.verification_challenges')) {
      assert.ok(Buffer.isBuffer(params[2]));
      assert.equal(params[2].length,32);
      return [{id:'challenge-id'}];
    }
    return [];
  };
}

test('resend commits before SMTP and keeps the code out of storage', async () => {
  const events = [];
  const original = nodemailer.createTransport;
  nodemailer.createTransport = () => ({
    async sendMail(message) {
      events.push('SEND');
      const code = message.text.match(/\b\d{6}\b/)?.[0];
      assert.ok(code);
      assert.ok(message.html.includes(code));
      assert.match(message.html,/10 phút/);
    },
    close() {}
  });
  try {
    await identity.resend(queriesForResend(events),{email:'test@example.test'});
    assert.ok(events.indexOf('COMMIT') < events.indexOf('SEND'));
    assert.equal(events.includes('ROLLBACK'),false);
  } finally { nodemailer.createTransport = original; }
});

test('expired and unavailable challenges cannot activate a user', async () => {
  for (const challenge of [null, {id:'challenge-id',user_id:'user-id',valid:false}]) {
    const events = [];
    const query = async (sql) => {
      events.push(sql);
      if (sql.startsWith('SELECT id FROM public.users')) return [{id:'user-id'}];
      if (sql.startsWith('SELECT id,user_id')) return challenge ? [challenge] : [];
      return [];
    };
    await assert.rejects(identity.verify(query,{email:'test@example.test',code:'123456'}),/không hợp lệ/);
    assert.equal(events.some(sql => sql.startsWith('UPDATE public.users')),false);
  }
});

test('SMTP failure removes the new challenge after commit', async () => {
  const events = [];
  const original = nodemailer.createTransport;
  nodemailer.createTransport = () => ({async sendMail() { throw new Error('unavailable'); }, close() {}});
  try {
    await assert.rejects(identity.resend(queriesForResend(events),{email:'test@example.test'}),/gửi lại mã/);
    assert.ok(events.indexOf('COMMIT') < events.findIndex(sql => sql.startsWith('DELETE FROM public.verification_challenges')));
    assert.equal(events.includes('ROLLBACK'),false);
  } finally { nodemailer.createTransport = original; }
});

test('verification records a wrong attempt and activates only for a correct code', async () => {
  for (const [code,success] of [['000001',false],['123456',true]]) {
    const events = [];
    const query = async (sql) => {
      events.push(sql);
      if (sql.startsWith('SELECT id FROM public.users')) return [{id:'user-id'}];
      if (sql.startsWith('SELECT id,user_id')) return [{id:'challenge-id',user_id:'user-id',valid:true,code_mac:createHmac('sha256',secret).update('user-id:123456').digest()}];
      return [];
    };
    if (success) await identity.verify(query,{email:'test@example.test',code});
    else await assert.rejects(identity.verify(query,{email:'test@example.test',code}),/không hợp lệ/);
    assert.equal(events.some(sql => sql.startsWith('UPDATE public.users SET status')),success);
    assert.equal(events.some(sql => sql.startsWith('UPDATE public.verification_challenges SET attempts_used')),!success);
    assert.ok(events.includes('COMMIT'));
  }
});
