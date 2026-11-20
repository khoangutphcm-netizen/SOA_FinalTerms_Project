import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';

export const accounts = [
  ['user1', '70ca0000-0000-4000-8000-000000000001', 'User 1', 'USER'],
  ['user2', '70ca0000-0000-4000-8000-000000000002', 'User 2', 'USER'],
  ['user3', '70ca0000-0000-4000-8000-000000000003', 'User 3', 'USER'],
  ['admin', '70ca0000-0000-4000-8000-000000000004', 'Admin demo', 'ADMIN']
];

export function connect(name) {
  const connectionString = process.env[name + '_DATABASE_URL'];
  if (!connectionString) throw new Error('Missing database configuration');
  return new Client({ connectionString, connectionTimeoutMillis: 7000, statement_timeout: 15000 });
}

export function passwordMatches(password, encoded) {
  const [method, salt, digest] = encoded.split('$');
  if (method !== 'scrypt' || !salt || !/^[a-f0-9]{64}$/.test(digest ?? '')) return false;
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(digest, 'hex'));
}

export async function seed() {
  const dir = new URL('./.pck-demo/', import.meta.url);
  const file = new URL('accounts.json', dir);
  await mkdir(dir, { recursive: true });
  let credentials;
  try {
    credentials = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    credentials = Object.fromEntries(accounts.map(([alias]) => [
      alias, { email: '', password: randomBytes(18).toString('base64url') }
    ]));
    await writeFile(file, JSON.stringify(credentials, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  const client = connect('IDENTITY');
  try {
    await client.connect();
    await client.query('BEGIN');
    for (const [alias, id, displayName, role] of accounts) {
      const { email, password } = credentials[alias];
      const salt = randomBytes(16).toString('hex');
      const hash = 'scrypt$' + salt + '$' + scryptSync(password, salt, 32).toString('hex');
      await client.query(`
        INSERT INTO public.users (id, email_normalized, password_hash, display_name, role, status, email_verified_at)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now()) ON CONFLICT (id) DO NOTHING`,
        [id, email.trim().toLowerCase() || alias + '@pck.invalid', hash, displayName, role]);
      const { rows: [row] } = await client.query(
        'SELECT role, status, password_hash FROM public.users WHERE id=$1', [id]);
      if (row?.role !== role || row.status !== 'ACTIVE' || !passwordMatches(password, row.password_hash)) {
        throw new Error('Demo account differs from local setup');
      }
      // A blank field preserves any email already set in the database.
      if (email.trim()) await client.query(
        'UPDATE public.users SET email_normalized=$2 WHERE id=$1', [id, email.trim().toLowerCase()]);
    }
    await client.query('COMMIT');
    console.log('Đã xác nhận 3 USER và 1 ADMIN. Mở .pck-demo/accounts.json để lấy mật khẩu demo.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}
