import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const env = {...process.env, PCK_INTERNAL_TOKEN: randomBytes(32).toString('hex')};
function processEnv(owner) {
  const scoped = {...env};
  for (const name of ['IDENTITY','CONTENT','COMMERCE','COMMUNITY']) {
    if (name !== owner) delete scoped[name + '_DATABASE_URL'];
  }
  return scoped;
}
const programs = [
  ['COMMERCE','commerce-server.mjs'],
  ['IDENTITY','data-server.mjs','IDENTITY'],
  ['COMMUNITY','data-server.mjs','COMMUNITY'],
  ['CONTENT','content-server.mjs'],
  ['WEB','server.mjs']
];
const children = programs.map(([owner,...args]) =>
  spawn(process.execPath,args,{env:processEnv(owner),stdio:'inherit'}));

let stopping = false;
function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill();
}
for (const child of children) {
  child.on('exit', code => stop(code ?? 1));
  child.on('error', error => { console.error(error.message); stop(1); });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
