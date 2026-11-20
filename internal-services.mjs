import { createServer } from 'node:http';
import { connect, accounts, passwordMatches } from './demo-accounts.mjs';

export function servicePort(service) {
  return Number(process.env[service + '_PORT'] || {COMMERCE:3101,CONTENT:3102,IDENTITY:3103,COMMUNITY:3104}[service]);
}

export async function callService(service, operation, input = {}) {
  let response;
  let data;
  try {
    response = await fetch('http://127.0.0.1:' + servicePort(service) + '/' + operation, {
      method:'POST', headers:{Authorization:'Bearer ' + process.env.PCK_INTERNAL_TOKEN,'Content-Type':'application/json'},
      body:JSON.stringify(input), signal:AbortSignal.timeout(25000)
    });
    data = await response.json();
  } catch {
    throw Object.assign(new Error(service + ' đang không phản hồi.'),{status:503});
  }
  if (!response.ok) throw Object.assign(new Error(data.message),{status:response.status});
  return data;
}

const identity = {
  async login(query, {alias,password}) {
    const account = accounts.find(([name]) => name === alias);
    if (!account || typeof password !== 'string' || password.length > 128) return null;
    const [user] = await query("SELECT id,role,password_hash FROM public.users WHERE id=$1 AND status='ACTIVE'",[account[1]]);
    if (!user || !passwordMatches(password,user.password_hash)) return null;
    return {id:user.id,role:user.role,alias};
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
    } catch {
      send(503,{message:'Không xử lý được yêu cầu tại ' + service + '.'});
    } finally {
      await client?.end().catch(() => {});
    }
  }).listen(servicePort(service),'127.0.0.1',() => console.log('PCK ' + service + ': ' + servicePort(service)));
}
