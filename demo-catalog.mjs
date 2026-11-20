import { callService } from './internal-services.mjs';
import { commerce } from './commerce-client.mjs';
import { access, readFile, unlink } from 'node:fs/promises';
import { connect } from './demo-accounts.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localKey = /^local-demo\/([0-9a-f-]{36}\.(?:jpg|jpeg|png|mp4))$/i;
const mediaUrl = id => '/api/demo/media/' + id;
const postFields = 'p.id, p.author_id, p.title, p.description, p.price_vnd, p.auto_cycle, p.status, p.withdrawn_at, p.moderation_state, p.published_at, p.view_count, p.created_at';

export async function withDb(name, work) {
  const client = connect(name);
  client.on('error', () => {});
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

export function query(name, sql, params = []) {
  return withDb(name, async client => (await client.query(sql, params)).rows);
}

export function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

export async function removeLocalAssets(keys) {
  await Promise.all(keys.map(async key=>{
    const file=key.match(localKey)?.[1];
    if(file) await unlink(new URL('./.pck-demo/uploads/'+file,import.meta.url)).catch(()=>{});
  }));
}

async function hasEntitlement(postId, caller) {
  if (!caller) return false;
  return (await commerce('/entitlement?' + new URLSearchParams({buyerId:caller.id, postId}))).allowed;
}

async function postById(id, caller, publishedOnly = false) {
  const [post] = await query('CONTENT', `SELECT ${postFields} FROM public.posts p WHERE id=$1`, [id]);
  if (post?.moderation_state === 'TAKEN_DOWN') throw problem(403, 'Tác phẩm đã bị gỡ do kiểm duyệt.');
  const retainedAccess = post?.withdrawn_at || post?.moderation_state === 'TEMP_HIDDEN';
  const allowed = post && (post.status === 'PUBLISHED' ||
    (!publishedOnly && (post.status === 'DRAFT'||retainedAccess) && post.author_id === caller?.id) ||
    (!publishedOnly && caller?.role === 'ADMIN'));
  if (!allowed && !(retainedAccess && !publishedOnly && await hasEntitlement(post.id,caller))) {
    throw problem(404, 'Không tìm thấy tác phẩm.');
  }
  return post;
}

async function hasFull(post, caller) {
  if (post.author_id === caller?.id) return true;
  if (!Number(post.price_vnd)) return true;
  return hasEntitlement(post.id,caller);
}

async function postMedia(post, caller) {
  const rows = await query('CONTENT', `SELECT a.id, a.filename, a.original_key, a.purpose, f.mime_type, f.kind
    FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
    WHERE a.post_id=$1 AND a.status='READY' ORDER BY a.position`, [post.id]);
  const full = await hasFull(post, caller);
  return rows.map(({id, filename, original_key, purpose, mime_type, kind}) => ({
    id, filename, purpose, mime_type, kind, premium: Number(post.price_vnd)>0 && purpose==='FULL',
    locked: !full && purpose !== 'PROMO',
    url: localKey.test(original_key) && (full || purpose === 'PROMO') ? mediaUrl(id) : null
  }));
}

const coverColumns = `(
  SELECT a.id FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
  WHERE a.post_id=p.id AND a.status='READY' AND (p.price_vnd=0 OR a.purpose='PROMO')
    AND f.kind IN ('IMAGE','VIDEO') AND a.original_key LIKE 'local-demo/%'
  ORDER BY a.position LIMIT 1
) AS cover_id, ARRAY(
  SELECT DISTINCT f.kind FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
  WHERE a.post_id=p.id AND a.status='READY'
) AS kinds, ARRAY(
  SELECT g.name FROM public.post_genres pg JOIN public.genres g ON g.id=pg.genre_id WHERE pg.post_id=p.id ORDER BY g.name
) AS genres`;

function withCoverKind(sql) {
  return `SELECT entries.*, f.kind AS cover_kind FROM (${sql}) entries
    LEFT JOIN public.assets a ON a.id=entries.cover_id
    LEFT JOIN public.asset_formats f ON f.id=a.format_id`;
}

async function catalog(search) {
  const keyword = (search.get('q') || '').trim().slice(0, 100);
  const kind = search.get('kind');
  const sort = search.get('sort') === 'old' ? 'ASC' : 'DESC';
  const offset = Math.min(3000, Math.max(0, Number.parseInt(search.get('offset'), 10) || 0));
  const pay = ['free','premium'].includes(search.get('pay')) ? search.get('pay') : '';
  const days = ['7','30','older'].includes(search.get('days')) ? search.get('days') : '';
  const include = search.getAll('include').filter(id=>uuid.test(id)).slice(0,50);
  const exclude = search.getAll('exclude').filter(id=>uuid.test(id)).slice(0,50);
  return query('CONTENT', withCoverKind(`SELECT ${postFields}, ${coverColumns}
    FROM public.posts p WHERE p.status='PUBLISHED'
    AND ($1='' OR strpos(lower(p.title), lower($1))>0 OR strpos(lower(p.description), lower($1))>0
      OR EXISTS (SELECT 1 FROM public.post_genres pg JOIN public.genres g ON g.id=pg.genre_id
        WHERE pg.post_id=p.id AND strpos(lower(g.name),lower($1))>0))
    AND ($2='' OR EXISTS (SELECT 1 FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
      WHERE a.post_id=p.id AND a.status='READY' AND f.kind=$2))
    AND ($4='' OR ($4='free' AND p.price_vnd=0) OR ($4='premium' AND p.price_vnd>0))
    AND ($5='' OR ($5='7' AND p.published_at>=now()-interval '7 days')
      OR ($5='30' AND p.published_at>=now()-interval '30 days') OR ($5='older' AND p.published_at<now()-interval '30 days'))
    AND (cardinality($6::uuid[])=0 OR EXISTS (SELECT 1 FROM public.post_genres WHERE post_id=p.id AND genre_id=ANY($6)))
    AND NOT EXISTS (SELECT 1 FROM public.post_genres WHERE post_id=p.id AND genre_id=ANY($7::uuid[]))
    ORDER BY p.published_at ${sort}, p.id LIMIT 25 OFFSET $3`) + ` ORDER BY entries.published_at ${sort}, entries.id`,
    [keyword, ['IMAGE','VIDEO'].includes(kind) ? kind : '', offset, pay, days, include, exclude]);
}

async function sendMedia(req, res, id, caller) {
  const [asset] = await query('CONTENT', `SELECT a.post_id, a.original_key, a.purpose, f.mime_type
    FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id WHERE a.id=$1 AND a.status='READY'`, [id]);
  const key = asset?.original_key.match(localKey)?.[1];
  if (!key) throw problem(404, 'Tệp không có trên kho local.');
  const post = await postById(asset.post_id, caller);
  if (asset.purpose !== 'PROMO' && !(await hasFull(post, caller))) throw problem(403, 'Bạn chưa có quyền xem tệp.');
  if (!['image/jpeg','image/png','video/mp4'].includes(asset.mime_type)) throw problem(415, 'Tệp không được hỗ trợ.');
  const bytes = await readFile(new URL('./.pck-demo/uploads/' + key, import.meta.url)).catch(error => {
    if (error.code === 'ENOENT') throw problem(404, 'Tệp không có trên máy chạy server.');
    throw error;
  });
  const headers = {'Content-Type':asset.mime_type, 'Accept-Ranges':'bytes', 'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff', 'Content-Disposition':'inline'};
  const requested = req.headers.range;
  if (!requested) {
    res.writeHead(200, {...headers, 'Content-Length':bytes.length}).end(bytes);
    return;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(requested);
  let first = NaN, last = NaN;
  if (range && (range[1] || range[2])) {
    first = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
    last = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length-1) : bytes.length-1;
  }
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last || first >= bytes.length) {
    res.writeHead(416, {...headers,'Content-Range':'bytes */' + bytes.length}).end();
    return;
  }
  res.writeHead(206, {...headers,'Content-Length':last-first+1,'Content-Range':`bytes ${first}-${last}/${bytes.length}`})
    .end(bytes.subarray(first,last+1));
}

async function publish(id, caller) {
  return withDb('CONTENT', async client => {
    await client.query('BEGIN');
    try {
      const {rows:[post]} = await client.query('SELECT status,price_vnd FROM public.posts WHERE id=$1 AND author_id=$2 FOR UPDATE', [id,caller.id]);
      if (!post) throw problem(404, 'Không tìm thấy bài của bạn.');
      if (!['DRAFT','PUBLISHED'].includes(post.status)) throw problem(409, 'Bài này không thể phát hành.');
      if (post.status === 'DRAFT') {
        const {rows} = await client.query(
          "SELECT original_key,purpose FROM public.assets WHERE post_id=$1 AND status='READY'", [id]);
        if (!rows.some(file=>file.purpose==='FULL') ||
          (Number(post.price_vnd)>0 && !rows.some(file=>file.purpose==='PROMO'))) {
          throw problem(409,'Bài cần tệp đầy đủ sẵn sàng. Bài premium còn cần ảnh quảng bá.');
        }
        for (const file of rows) {
          const key=file.original_key.match(localKey)?.[1];
          if (!key) throw problem(409,'Bài có tệp chưa sẵn sàng trên kho local.');
          await access(new URL('./.pck-demo/uploads/'+key,import.meta.url)).catch(()=>{
            throw problem(409,'Không tìm thấy tệp trên máy chạy server.');
          });
        }
        await client.query("UPDATE public.posts SET status='PUBLISHED',published_at=now() WHERE id=$1", [id]);
      }
      await client.query('COMMIT');
      return {status:'PUBLISHED'};
    } catch(error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

async function testPurchase(id, caller, expectedPrice) {
  return withDb('CONTENT', async content => {
    await content.query('BEGIN');
    try {
      const {rows:[post]} = await content.query(
        "SELECT author_id, price_vnd FROM public.posts WHERE id=$1 AND status='PUBLISHED' FOR SHARE", [id]);
      if (!post) throw problem(409, 'Tác phẩm hiện không mở bán.');
      if (post.author_id === caller.id || Number(post.price_vnd) <= 0) throw problem(409,'Chỉ mua thử bài premium của người khác.');
      if (expectedPrice !== Number(post.price_vnd)) throw problem(409,'Giá đã thay đổi. Tải lại bài để xác nhận.');
      return await commerce('/test-purchase', {buyerId:caller.id, postId:id, price:expectedPrice, authorId:post.author_id});
    } finally {
      await content.query('ROLLBACK').catch(() => {});
    }
  });
}

async function community(path, req, caller, id, readJson) {
  const action = path.split('/').at(-1);
  const {method} = req;
  const input = {action,method,id,userId:caller.id};
  if (['like','save'].includes(action)) {
    if (!['PUT','DELETE'].includes(method)) throw problem(405,'Phương thức không hợp lệ.');
    if (method === 'PUT') await postById(id,caller,true);
  } else {
    if (method !== 'POST') throw problem(405,'Dùng POST.');
    await postById(id,caller,true);
    const body = await readJson(req);
    input.content = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!input.content || input.content.length > 1000) throw problem(400,'Nhập nội dung từ 1 đến 1000 ký tự.');
  }
  return callService('COMMUNITY','interact',input);
}

async function detail(id, caller) {
  const post = await postById(id,caller);
  const media = await postMedia(post,caller);
  const canManage=post.author_id===caller?.id&&['DRAFT','PUBLISHED'].includes(post.status);
  if (post.status !== 'PUBLISHED') return {post,media,canManage,canPublish:post.status==='DRAFT'&&canManage,comments:[],likes:0,liked:false,saved:false};
  const {comments,reaction} = await callService('COMMUNITY','detail',{id,userId:caller?.id || null});
  const ids = [...new Set([post.author_id,...comments.map(c=>c.author_id)])];
  const users = await callService('IDENTITY','names',{ids});
  const names = new Map(users.map(user=>[user.id,user.display_name]));
  return {post:{...post,author:names.get(post.author_id)},media,canManage,
    comments:comments.map(c=>({id:c.id,body:c.body,created_at:c.created_at,author:names.get(c.author_id)})),...reaction};
}

const groupKinds = {
  collections: ['collections','collection_items','collection_id','true'],
  events: ['homepage_events','homepage_event_items','event_id','g.enabled AND (g.starts_at IS NULL OR g.starts_at<=now()) AND (g.ends_at IS NULL OR g.ends_at>now())']
};

async function groups(kind, groupId) {
  const [table, items, fk, visibility] = groupKinds[kind];
  if (!groupId) return query('CONTENT', `SELECT g.id,g.title,g.description,count(p.id)::int AS total
    FROM public.${table} g LEFT JOIN public.${items} i ON i.${fk}=g.id
    LEFT JOIN public.posts p ON p.id=i.post_id AND p.status='PUBLISHED' WHERE ${visibility}
    GROUP BY g.id ORDER BY g.title,g.id LIMIT 50`);
  return withDb('CONTENT', async client=>{
    const {rows:[group]} = await client.query(`SELECT g.id,g.title,g.description FROM public.${table} g WHERE g.id=$1 AND ${visibility}`,[groupId]);
    if (!group) throw problem(404,'Không tìm thấy danh mục.');
    const {rows:posts} = await client.query(withCoverKind(`SELECT ${postFields}, ${coverColumns}, i.position FROM public.${items} i
      JOIN public.posts p ON p.id=i.post_id AND p.status='PUBLISHED' WHERE i.${fk}=$1`)+' ORDER BY position',[groupId]);
    return {group,posts};
  });
}

async function createCollection(caller, input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const ids = Array.isArray(input?.posts) ? [...new Set(input.posts)] : [];
  if (!title || title.length > 80 || description.length > 240 || !ids.length || ids.length > 25 ||
    ids.some(id=>typeof id!=='string'||!uuid.test(id))) throw problem(400,'Nhập tên và chọn tối đa 25 bài đã phát hành.');
  return withDb('CONTENT',async client=>{
    await client.query('BEGIN');
    try {
      const {rows} = await client.query("SELECT id FROM public.posts WHERE status='PUBLISHED' AND id=ANY($1::uuid[]) FOR SHARE",[ids]);
      if(rows.length!==ids.length) throw problem(409,'Một bài đã không còn hiển thị.');
      const {rows:[row]} = await client.query('INSERT INTO public.collections (owner_id,title,description) VALUES ($1,$2,$3) RETURNING id',[caller.id,title,description]);
      await client.query('INSERT INTO public.collection_items (collection_id,post_id,position) SELECT $1,v.id,v.pos FROM unnest($2::uuid[]) WITH ORDINALITY v(id,pos)',[row.id,ids]);
      await client.query('COMMIT');
      return row;
    } catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  });
}

async function library(kind, caller) {
  const rows = kind === 'saved'
    ? await callService('COMMUNITY','saved',{userId:caller.id})
    : await commerce('/purchases?' + new URLSearchParams({buyerId:caller.id}));
  const posts = await query('CONTENT', withCoverKind(`SELECT ${postFields}, ${coverColumns} FROM public.posts p
    WHERE p.id=ANY($1::uuid[]) AND ($2 OR p.status='PUBLISHED')`),[rows.map(row=>row.post_id),kind==='purchases']);
  const byId = new Map(posts.map(post=>[post.id,post]));
  return rows.map(row=>byId.get(row.post_id) || {
    id:row.post_id, title:'Tác phẩm không khả dụng', status:'HIDDEN', unavailable:true
  });
}

async function adminDashboard() {
  const [posts, paid, reports, genres, events, totals] = await Promise.all([
    query('CONTENT','SELECT id,title,status,withdrawn_at,moderation_state FROM public.posts ORDER BY created_at DESC,id LIMIT 50'),
    commerce('/paid-count'),
    callService('COMMUNITY','reports'),
    query('CONTENT','SELECT id,name,enabled FROM public.genres ORDER BY name'),
    query('CONTENT',`SELECT e.id,e.title,e.description,e.enabled,
      ARRAY(SELECT post_id FROM public.homepage_event_items WHERE event_id=e.id ORDER BY position) AS posts
      FROM public.homepage_events e ORDER BY e.title,e.id`),
    query('CONTENT',`SELECT count(*)::int AS posts,
      count(*) FILTER (WHERE status='PUBLISHED')::int AS published,
      count(*) FILTER (WHERE status='PUBLISHED' AND price_vnd>0)::int AS premium
      FROM public.posts`)
  ]);
  return {posts,paid:paid.count,reports,genres,events,totals:totals[0]};
}

async function saveEvent(id, input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const ids = Array.isArray(input?.posts) ? [...new Set(input.posts)] : [];
  if (!title || title.length > 80 || description.length > 240 || typeof input?.enabled !== 'boolean' ||
    (input.enabled && !ids.length) || ids.length > 25 || ids.some(value=>typeof value!=='string'||!uuid.test(value))) {
    throw problem(400,'Kiểm tra tên, mô tả và danh sách bài. Sự kiện đang bật cần ít nhất một bài.');
  }
  return withDb('CONTENT', async client=>{
    await client.query('BEGIN');
    try {
      const {rows} = await client.query("SELECT id FROM public.posts WHERE id=ANY($1::uuid[]) AND status='PUBLISHED' FOR SHARE",[ids]);
      if (rows.length!==ids.length) throw problem(409,'Một bài đã không còn hiển thị.');
      const result = id
        ? await client.query('UPDATE public.homepage_events SET title=$1,description=$2,enabled=$3 WHERE id=$4 RETURNING id',[title,description,input.enabled,id])
        : await client.query('INSERT INTO public.homepage_events (title,description,enabled) VALUES ($1,$2,$3) RETURNING id',[title,description,input.enabled]);
      const eventId = result.rows[0]?.id;
      if (!eventId) throw problem(404,'Không tìm thấy sự kiện.');
      await client.query('DELETE FROM public.homepage_event_items WHERE event_id=$1',[eventId]);
      if (ids.length) await client.query('INSERT INTO public.homepage_event_items (event_id,post_id,position) SELECT $1,v.id,v.pos FROM unnest($2::uuid[]) WITH ORDINALITY v(id,pos)',[eventId,ids]);
      await client.query('COMMIT');
      return {id:eventId};
    } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  });
}

export async function setPostGenre(client, id, genreId) {
  if (genreId) {
    const {rows:[genre]}=await client.query('SELECT enabled FROM public.genres WHERE id=$1 FOR SHARE',[genreId]);
    if (!genre) throw problem(400,'Không tìm thấy thể loại.');
    const {rows:assigned}=await client.query('SELECT 1 FROM public.post_genres WHERE post_id=$1 AND genre_id=$2',[id,genreId]);
    if (assigned.length) return;
    if (!genre.enabled) throw problem(400,'Thể loại này đã tạm dừng.');
  }
  await client.query('DELETE FROM public.post_genres WHERE post_id=$1',[id]);
  if (genreId) await client.query('INSERT INTO public.post_genres (post_id,genre_id) VALUES ($1,$2)',[id,genreId]);
}

async function moderatePost(id, caller, input) {
  const action = input?.action;
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (!['HIDE','RESTORE','TAKEDOWN','REINSTATE'].includes(action)) throw problem(400,'Thao tác kiểm duyệt không hợp lệ.');
  if ((['HIDE','TAKEDOWN'].includes(action) && !reason) || reason.length > 1000) {
    throw problem(400,'Nhập lý do kiểm duyệt từ 1 đến 1000 ký tự.');
  }
  // Removing a takedown restores buyer access. Relisting requires a separate decision.
  const state = {HIDE:'TEMP_HIDDEN',RESTORE:'CLEAR',TAKEDOWN:'TAKEN_DOWN',REINSTATE:'TEMP_HIDDEN'}[action];
  const rows = await query('CONTENT', `
    WITH changed AS (
      UPDATE public.posts SET
        status=CASE WHEN $2='CLEAR' AND withdrawn_at IS NULL THEN 'PUBLISHED' ELSE 'HIDDEN' END,
        moderation_state=$2, moderation_reason=$3, moderated_by=$4, moderated_at=now()
      WHERE id=$1 AND published_at IS NOT NULL AND (
        ($5='HIDE' AND status='PUBLISHED' AND moderation_state='CLEAR') OR
        ($5='RESTORE' AND status='HIDDEN' AND
          (moderation_state='TEMP_HIDDEN' OR (moderation_state='CLEAR' AND withdrawn_at IS NULL))) OR
        ($5='TAKEDOWN' AND moderation_state<>'TAKEN_DOWN') OR
        ($5='REINSTATE' AND moderation_state='TAKEN_DOWN')
      )
      RETURNING id
    )
    INSERT INTO public.post_moderation_actions (post_id,actor_id,actor_kind,action,reason)
    SELECT id,$4,'ADMIN',$5,$3 FROM changed RETURNING post_id
  `, [id,state,reason || null,caller.id,action]);
  if (!rows.length) throw problem(409,'Trạng thái bài không còn phù hợp. Tải lại danh sách và thử lại.');
}

async function managePost(id, caller, method, input) {
  const result = await withDb('CONTENT',async client=>{
    await client.query('BEGIN');
    try {
      const {rows:[post]}=await client.query(`SELECT ${postFields},p.xmin::text AS revision FROM public.posts p
        WHERE p.id=$1 AND p.author_id=$2 ${method==='GET'?'FOR SHARE':'FOR UPDATE'}`,[id,caller.id]);
      if (!post) throw problem(404,'Không tìm thấy bài của bạn.');
      if (method==='DELETE') {
        if (post.withdrawn_at) { await client.query('COMMIT'); return {status:'WITHDRAWN'}; }
        if(input?.status && input.status!==post.status) throw problem(409,'Trạng thái bài đã đổi. Tải lại trước khi xóa hoặc gỡ.');
        if (post.status==='DRAFT'){
          const {rows}=await client.query('DELETE FROM public.assets WHERE post_id=$1 RETURNING original_key',[id]);
          await client.query('DELETE FROM public.post_genres WHERE post_id=$1',[id]);
          await client.query('DELETE FROM public.posts WHERE id=$1',[id]);
          await client.query('COMMIT');
          return {status:'DELETED',keys:rows.map(row=>row.original_key)};
        }
        if (post.status!=='PUBLISHED' && post.moderation_state!=='TEMP_HIDDEN') throw problem(409,'Bài đang bị quản trị viên ẩn.');
        await client.query("UPDATE public.posts SET status='HIDDEN',withdrawn_at=now() WHERE id=$1",[id]);
        await client.query("INSERT INTO public.post_moderation_actions (post_id,actor_id,actor_kind,action) VALUES ($1,$2,'AUTHOR','WITHDRAW')",[id,caller.id]);
        await client.query('COMMIT');
        return {status:'WITHDRAWN'};
      }
      if (!['DRAFT','PUBLISHED'].includes(post.status)) throw problem(409,'Bài này không còn sửa được.');
      if (method==='GET') {
        const {rows:genres}=await client.query(`SELECT g.id,g.name FROM public.post_genres pg JOIN public.genres g ON g.id=pg.genre_id
          WHERE pg.post_id=$1 ORDER BY g.name,g.id`,[id]);
        const {rows:assets}=await client.query(`SELECT a.id,a.filename,a.original_key,a.size_bytes,a.position,a.purpose,f.kind
          FROM public.assets a JOIN public.asset_formats f ON f.id=a.format_id
          WHERE a.post_id=$1 AND a.status='READY' ORDER BY a.position`,[id]);
        await client.query('COMMIT');
        return {post,genres,media:assets.map(a=>({
          id:a.id,filename:a.filename,size:Number(a.size_bytes),kind:a.kind,
          premium:Number(post.price_vnd)>0&&a.purpose==='FULL',url:localKey.test(a.original_key)?mediaUrl(a.id):null
        }))};
      }
      if (post.status!=='PUBLISHED') throw problem(409,'Dùng form chỉnh sửa bản nháp để lưu tệp.');
      if (input?.revision!==post.revision) throw problem(409,'Bài đã thay đổi. Tải lại form trước khi lưu.');
      const title=typeof input.title==='string'?input.title.trim():'';
      const description=typeof input.description==='string'?input.description.trim():'';
      const genreId=input.genreId||null;
      const coverId=input.coverId||null;
      if(!title||title.length>100||description.length>1000||
         (genreId&&(typeof genreId!=='string'||!uuid.test(genreId)))||
         (coverId&&(typeof coverId!=='string'||!uuid.test(coverId)))) throw problem(400,'Kiểm tra tiêu đề, mô tả, thể loại và ảnh đại diện.');
      if(coverId){
        const {rows:[cover]}=await client.query(`SELECT a.position,a.purpose,f.kind FROM public.assets a
          JOIN public.asset_formats f ON f.id=a.format_id WHERE a.id=$1 AND a.post_id=$2 AND a.status='READY'`,[coverId,id]);
        if(!cover||!['IMAGE','VIDEO'].includes(cover.kind)||
          (Number(post.price_vnd)>0&&(cover.purpose!=='PROMO'||cover.kind!=='IMAGE'))) {
          throw problem(400,'Chọn tệp công khai phù hợp làm đại diện.');
        }
        if(cover.position!==1){
          await client.query('SET CONSTRAINTS ALL DEFERRED');
          await client.query(`UPDATE public.assets SET position=CASE WHEN id=$1 THEN 1 ELSE $3 END
            WHERE post_id=$2 AND (id=$1 OR position=1)`,[coverId,id,cover.position]);
        }
      }
      await setPostGenre(client,id,genreId);
      await client.query('UPDATE public.posts SET title=$2,description=$3,auto_cycle=$4 WHERE id=$1',
        [id,title,description,input.autoCycle===true]);
      await client.query('COMMIT');
      return {status:'PUBLISHED'};
    } catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  });
  if(result.keys)await removeLocalAssets(result.keys);
  const {keys,...response}=result;
  return response;
}

export async function handleCatalog(req, res, path, send, caller, readJson) {
  const search = new URL(req.url,'http://localhost').searchParams;
  const match = /^\/api\/demo\/(media|catalog|publish|manage-post|test-purchase|admin-post|admin-genre|admin-report|admin-event)\/([^/]+)(?:\/(like|save|comments|report))?$/.exec(path);
  const group = /^\/api\/demo\/(collections|events)(?:\/([^/]+))?$/.exec(path);
  const requireUser = () => { if (!caller) throw problem(401,'Hãy đăng nhập để tiếp tục.'); };
  const requireAdmin = () => { if (caller?.role!=='ADMIN') throw problem(403,'Chỉ tài khoản admin được thực hiện.'); };
  try {
    if (path==='/api/demo/catalog' && req.method==='GET') return send(res,200,{posts:await catalog(search)});
    if (group && req.method==='GET' && (!group[2]||uuid.test(group[2]))) return send(res,200,await groups(group[1],group[2]));
    if (path==='/api/demo/collections' && req.method==='POST') {
      requireUser(); return send(res,201,await createCollection(caller,await readJson(req)));
    }
    if (path==='/api/demo/genres' && req.method==='GET') {
      return send(res,200,{genres:await query('CONTENT','SELECT id,name FROM public.genres WHERE enabled OR $1 ORDER BY name',[search.has('all')])});
    }
    if (['/api/demo/saved','/api/demo/purchases'].includes(path) && req.method==='GET') {
      requireUser(); return send(res,200,{posts:await library(path.split('/').at(-1),caller)});
    }
    if (path==='/api/demo/admin' && req.method==='GET') {
      requireAdmin(); return send(res,200,await adminDashboard());
    }
    if (path==='/api/demo/admin-events' && req.method==='POST') {
      requireAdmin(); return send(res,201,await saveEvent(null,await readJson(req)));
    }
    if (path==='/api/demo/admin-genres' && req.method==='POST') {
      requireAdmin();
      const input=await readJson(req);
      const name=typeof input?.name==='string'?input.name.trim():'';
      const slug=name.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/đ/g,'d')
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      if (!slug || name.length>60) throw problem(400,'Nhập tên thể loại từ 1 đến 60 ký tự.');
      const rows=await query('CONTENT','INSERT INTO public.genres (name,slug) VALUES ($1,$2) ON CONFLICT (slug) DO NOTHING RETURNING id',[name,slug]);
      if(!rows.length) throw problem(409,'Thể loại đã tồn tại.');
      return send(res,201,rows[0]);
    }
    if (!match || !uuid.test(match[2]) || (match[3] && match[1]!=='catalog')) return send(res,404,{message:'Không tìm thấy API.'});
    const [, action, id, sub] = match;
    if (action==='media' && req.method==='GET') return await sendMedia(req,res,id,caller);
    if (action==='catalog' && !sub && req.method==='GET') return send(res,200,await detail(id,caller));
    if (sub) {
      requireUser(); return send(res,200,await community(path,req,caller,id,readJson));
    }
    if (action==='publish' && req.method==='PUT') {
      requireUser(); return send(res,200,await publish(id,caller));
    }
    if (action==='manage-post' && ['GET','PUT','DELETE'].includes(req.method)) {
      requireUser();
      return send(res,200,await managePost(id,caller,req.method,req.method==='GET'?null:await readJson(req)));
    }
    if (action==='test-purchase' && req.method==='POST') {
      requireUser();
      const input=await readJson(req);
      return send(res,200,await testPurchase(id,caller,input?.price));
    }
    if (action==='admin-event' && req.method==='PUT') {
      requireAdmin(); return send(res,200,await saveEvent(id,await readJson(req)));
    }
    if (action.startsWith('admin-') && req.method==='PUT') {
      requireAdmin();
      const input = await readJson(req);
      if(action==='admin-genre' && typeof input?.enabled==='boolean'){
        const rows = await query('CONTENT','UPDATE public.genres SET enabled=$2 WHERE id=$1 RETURNING id',[id,input.enabled]);
        if(!rows.length) throw problem(404,'Không tìm thấy thể loại.');
      }else if(action==='admin-post'){
        await moderatePost(id, caller, input);
      }else if(action==='admin-report' && input?.status==='DISMISSED'){
        await callService('COMMUNITY','dismiss',{id,userId:caller.id});
      }else throw problem(400,'Thao tác không hợp lệ.');
      return send(res,200,{saved:true});
    }
    return send(res,405,{message:'Phương thức không hợp lệ.'});
  } catch(error) {
    return send(res,error.status || 503,{message:error.status?error.message:'Không đọc hoặc ghi được dữ liệu. Kiểm tra kết nối DB.'});
  }
}
