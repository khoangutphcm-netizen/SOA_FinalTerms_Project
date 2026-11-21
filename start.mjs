import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { servicePort } from './service-network.mjs';

const env = {...process.env, PCK_INTERNAL_TOKEN: randomBytes(32).toString('hex')};
function processEnv(owner) {
  const scoped = {...env};
  for (const name of ['IDENTITY','CONTENT','COMMERCE','COMMUNITY']) {
    if (name !== owner) delete scoped[name + '_DATABASE_URL'];
  }
  if (owner !== 'IDENTITY') for (const name of ['PCK_OTP_SECRET','SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASSWORD','SMTP_FROM']) delete scoped[name];
  if (owner !== 'COMMERCE') for (const name of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']) delete scoped[name];
  if (owner !== 'NGROK') delete scoped.NGROK_AUTHTOKEN;
  return scoped;
}
const programs = [
  ['COMMERCE','commerce-server.mjs'],
  ['IDENTITY','data-server.mjs','IDENTITY'],
  ['COMMUNITY','data-server.mjs','COMMUNITY'],
  ['CONTENT','content-server.mjs'],
  ['WEB','server.mjs']
];
const children = [];
let stopping = false;
function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill();
}
function launch(name, executable, args, options) {
  const child = spawn(executable, args, { windowsHide: true, ...options });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (!stopping && signal !== 'SIGINT' && code !== 0)
      console.error(name + ' dừng bất ngờ.');
    stop(signal === 'SIGINT' ? 0 : code ?? 1);
  });
  child.on('error', error => {
    console.error(error.code === 'ENOENT' ? 'Không tìm thấy lệnh ' + executable + '.' : error.message);
    stop(1);
  });
  return child;
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function assertFreePort(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('Cổng ' + port + ' đang bận. Dừng phiên PCK hoặc ngrok cũ trước.')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function startNgrok() {
  const port = Number(env.PORT || 3100);
  const agentPort = Number(env.PCK_NGROK_API_PORT || 4040);
  const ports = [port, agentPort, ...programs.filter(([owner]) => owner !== 'WEB').map(([owner]) => servicePort(owner))];
  if (new Set(ports).size !== ports.length || ports.some(value => !Number.isInteger(value) || value < 1 || value > 65535))
    throw new Error('Kiểm tra cấu hình cổng PCK và ngrok. Các cổng phải hợp lệ và khác nhau.');
  await Promise.all(ports.map(assertFreePort));
  if (stopping) return;
  const upstream = 'http://127.0.0.1:' + port;
  const ngrokEnv = processEnv('NGROK');
  delete ngrokEnv.PCK_INTERNAL_TOKEN;
  const child = launch('ngrok', 'ngrok', ['http', upstream, '--inspect=false', '--log=stdout', '--log-format=json'], {
    env: ngrokEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  function printError(chunk) {
    for (const code of new Set(chunk.toString().match(/ERR_NGROK_\d+/g) || []))
      console.error('ngrok: ' + code);
  }
  child.stdout.on('data', printError);
  child.stderr.on('data', printError);
  for (let attempt = 0; attempt < 80 && !stopping; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:' + agentPort + '/api/tunnels', { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        const { tunnels } = await response.json();
        const tunnel = tunnels?.find(item => item.proto === 'https' && item.config?.addr === upstream);
        if (tunnel && new URL(tunnel.public_url).protocol === 'https:') return new URL(tunnel.public_url).origin;
      }
    } catch {
      // The agent's local API may not be up yet.
    }
    await delay(250);
  }
  if (!stopping)
    throw new Error('Không lấy được URL ngrok. Kiểm tra authtoken và Agent API trên cổng ' + agentPort + '.');
}

try {
  const publicUrl = process.argv.includes('--ngrok') ? await startNgrok() : null;
  if (!stopping) {
    if (publicUrl) {
      env.PCK_PUBLIC_URL = publicUrl;
      env.PCK_SECURE_COOKIE = '1';
    }
    for (const [owner, ...args] of programs)
      launch(owner, process.execPath, args, { env: processEnv(owner), stdio: 'inherit' });
    if (publicUrl) console.log('PCK ngrok: ' + publicUrl + ' (Ctrl+C để dừng)');
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}
