const app = document.querySelector('#app');
const loginLink = document.querySelector('#login-link');
const adminLink = document.querySelector('#admin-link');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link = (label, href, style='light') => `<a class="btn ${style}" href="${esc(href)}">${esc(label)}</a>`;
const heading = (title, text='', action='') => `<header class="page-head"><div><h1>${esc(title)}</h1>${text?`<p>${esc(text)}</p>`:''}</div>${action}</header>`;
const empty = text => `<p class="empty">${esc(text)}</p>`;
const price = p => Number(p.price_vnd) ? Number(p.price_vnd).toLocaleString('vi-VN') + ' ₫' : 'Miễn phí';
const postLink = p => '#post/' + encodeURIComponent(p.id);
const kindNames = {IMAGE:'Ảnh', VIDEO:'Video', AUDIO:'Âm thanh'};
let user = null, version = 0, afterLogin = 'account', currentMedia = [], noticeTimer;
let filters = {q:'',kind:'',sort:'new',pay:'',days:'',offset:0,include:[],exclude:[]};

async function api(path, options={}) {
 const response = await fetch('/api/demo/'+path,{...options,headers:{'X-PCK-Demo':'1',...options.headers}});
 const result = await response.json();
 if (!response.ok) throw new Error(result.message || 'Yêu cầu thất bại.');
 return result;
}
const json = (path, method, body) => api(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function go(route) {
 if (location.hash==='#'+route) render();
 else location.hash=route;
}
function notice(text) {
 const box = document.querySelector('#notice');
 box.textContent=text; box.classList.add('show');
 clearTimeout(noticeTimer);
 noticeTimer=setTimeout(()=>box.classList.remove('show'),3700);
}
function button(label, action, id='', next='') {
 return `<button class="btn light" data-action="${action}" data-id="${esc(id)}" data-next="${esc(next)}">${esc(label)}</button>`;
}
function card(p) {
 const kinds=(p.kinds||[]).map(k=>kindNames[k]||'Tệp');
 const cover = p.status==='PUBLISHED' && p.cover_id && p.cover_kind==='IMAGE';
 return `<article class="card"><a href="${postLink(p)}">
  <div class="visual real-cover">${cover?`<img src="/api/demo/media/${encodeURIComponent(p.cover_id)}" alt="" loading="lazy">`:`<span>${kinds.includes('Video')?'▶ Video':'Chưa có ảnh bìa'}</span>`}</div>
  <div class="card-body"><span class="category">${esc([...kinds,...(p.genres||[])].join(' · '))}</span><h3>${esc(p.title)}</h3>
  <p>${esc(p.status==='HIDDEN'?'Không khả dụng':price(p))}</p></div></a></article>`;
}
const grid = (posts,msg='Chưa có tác phẩm nào.') => posts.length?`<div class="grid">${posts.map(card).join('')}</div>`:empty(msg);
const groupCards = (groups, route) => groups.length?`<div class="grid compact-collections">${groups.map(g=>`<article class="card"><a class="card-body" href="#${route}/${encodeURIComponent(g.id)}"><span class="category">${g.total} tác phẩm</span><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p></a></article>`).join('')}</div>`:empty('Chưa có nội dung trong mục này.');
const shelf = (title, body, action='') => `<section class="section"><div class="heading"><h2>${title}</h2>${action}</div>${body}</section>`;
async function home() {
 const [catalog,collections,events] = await Promise.all([api('catalog'),api('collections'),api('events')]);
 return document.querySelector('#hero-template').innerHTML +
  shelf('Mới phát hành',grid(catalog.posts.slice(0,6),'Chưa có bài phát hành.'),link('Xem tất cả','#browse'))+
  (events.length?shelf('Sự kiện',groupCards(events,'event')):'')+
  shelf('Bộ sưu tập',groupCards(collections.slice(0,4),'collection'),link('Xem tất cả','#collections'));
}
async function discover() {
 const {include,exclude,...basic}=filters;
 const search=new URLSearchParams(basic);
 for(const id of include)search.append('include',id);
 for(const id of exclude)search.append('exclude',id);
 const [{posts},{genres}]=await Promise.all([api('catalog?'+search),api('genres?all=1')]);
 const option=(key,label,current)=>`<option value="${key}" ${key===current?'selected':''}>${label}</option>`;
 return heading('Khám phá')+`<form id="browse-form" class="browse-controls">
  <input name="q" type="search" aria-label="Từ khóa" placeholder="Tìm tên, mô tả hoặc thể loại" maxlength="100" value="${esc(filters.q)}">
  <select name="kind" aria-label="Định dạng">${option('','Mọi định dạng',filters.kind)}${option('IMAGE','Ảnh',filters.kind)}${option('VIDEO','Video',filters.kind)}</select>
  <select name="sort" aria-label="Sắp xếp">${option('new','Mới nhất',filters.sort)}${option('old','Cũ nhất',filters.sort)}</select>
  <select name="pay" aria-label="Mức giá">${option('','Mọi mức giá',filters.pay)}${option('free','Miễn phí',filters.pay)}${option('premium','Trả phí',filters.pay)}</select>
  <select name="days" aria-label="Thời gian đăng">${option('','Mọi thời gian',filters.days)}${option('7','7 ngày qua',filters.days)}${option('30','30 ngày qua',filters.days)}${option('older','Cũ hơn 30 ngày',filters.days)}</select>
  ${genres.length?`<details class="genre-box" ${include.length||exclude.length?'open':''}><summary>Thể loại</summary>
   ${genres.map(g=>{
    const selected=include.includes(g.id)?'yes':exclude.includes(g.id)?'no':'';
    return `<label>${esc(g.name)}<select name="genre:${esc(g.id)}">${option('','Bỏ qua',selected)}${option('yes','Có',selected)}${option('no','Không',selected)}</select></label>`;
   }).join('')}</details>`:''}
  <button class="btn dark">Tìm kiếm</button></form>`+grid(posts,'Không tìm thấy tác phẩm phù hợp.')+
  `<div class="button-row pagination">${filters.offset?button('Trang trước','previous'):''}${posts.length===25&&filters.offset<3000?button('Trang sau','next'):''}</div>`;
}
function login() {
 return user?heading('Bạn đã đăng nhập',user.alias,link('Tài khoản','#account')):heading('Đăng nhập PCK')+
 `<form id="login-form" class="surface edit-form"><label>Tài khoản<select name="alias"><option>user1</option><option>user2</option><option>user3</option><option>admin</option></select></label>
 <label>Mật khẩu<input name="password" type="password" required maxlength="128" autocomplete="current-password"></label>
 <div class="button-row"><button class="btn dark">Đăng nhập</button>${link('Tiếp tục với vai trò Khách','#browse')}</div><p role="status" class="muted"></p></form>`;
}
const loginRequired = message => heading('Bạn đang xem với vai trò Khách',message)+button('Đăng nhập','login',location.hash.slice(1)||'account');
async function upload() {
 if(!user) return loginRequired('Đăng nhập để tải tệp lên.');
 const {genres}=await api('genres');
 return heading('Đăng tác phẩm','Tải một tệp để tạo bài nháp.')+`<form id="upload-form" class="surface edit-form">
 <label>Tiêu đề<input name="title" maxlength="100" required></label><label>Mô tả<textarea name="description" maxlength="1000" rows="3"></textarea></label>
 <label>Thể loại<select name="genre"><option value="">Chưa chọn</option>${genres.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select></label>
 <label>JPG, PNG hoặc MP4 · tối đa 10 MB<input name="file" type="file" required accept=".jpg,.jpeg,.png,.mp4"></label>
 <button class="btn dark">Tải lên và lưu nháp</button><p role="status" class="muted"></p></form>`;
}
function gallery(media,i=0) {
 if(!media.length)return empty('Chưa có tệp để hiển thị.');
 const m=media[i];
 let view='<span>Không có tệp trong kho local</span>';
 if(m.locked)view='<strong>Nội dung trả phí</strong>';
 else if(m.url&&m.kind==='VIDEO')view=`<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>`;
 else if(m.url&&m.kind==='IMAGE')view=`<img src="${esc(m.url)}" alt="${esc(m.filename)}">`;
 return `<div class="preview media-stage">${view}</div><div class="media-thumbs">${media.map((f,k)=>`<button type="button" class="btn light" data-media="${k}" aria-pressed="${i===k}">${kindNames[f.kind]||'Tệp'} ${k+1}${f.locked?' · Khóa':''}</button>`).join('')}</div>
  <p>${esc(m.filename)}${m.url?` · <a href="${esc(m.url)}" download="${esc(m.filename)}">Tải tệp</a>`:''}</p>`;
}
async function detail(id) {
 const data=await api('catalog/'+encodeURIComponent(id));
 const {post,media}=data;
 const published=post.status==='PUBLISHED';
 const form=(name,label)=>`<form id="${name}" data-id="${esc(id)}"><input name="text" required maxlength="1000" aria-label="${label}" placeholder="${label}"><button class="btn light">Gửi</button><p role="status"></p></form>`;
 return {media, html:heading(post.title,post.author||'')+`<div class="detail"><section id="post-media">${gallery(media)}</section>
 <aside class="surface"><p class="category">${esc(post.status==='DRAFT'?'Bản nháp':post.status==='HIDDEN'?'Đã ẩn':price(post))}</p><p>${esc(post.description)}</p>
 ${data.canPublish?button('Phát hành','publish',id):''}
 ${published&&Number(post.price_vnd)&&media.some(f=>f.locked)?'<p>Thanh toán chưa được tích hợp.</p>':''}
 ${published?`<div class="button-row">${button((data.liked?'Bỏ thích':'Thích')+' · '+data.likes,data.liked?'unlike':'like',id)}${button(data.saved?'Bỏ lưu':'Xem sau',data.saved?'unsave':'save',id)}</div>`:''}</aside></div>
 ${published?`<section class="surface comments"><h2>Bình luận</h2>${data.comments.length?data.comments.map(c=>`<p><strong>${esc(c.author||'Tài khoản không khả dụng')}</strong> · ${esc(c.body)}</p>`).join(''):'<p>Chưa có bình luận.</p>'}
 ${user?form('comments-form','Viết bình luận')+`<details><summary>Báo cáo bài</summary>${form('report-form','Lý do báo cáo')}</details>`:button('Đăng nhập để bình luận','login','post/'+id)}</section>`:''}`};
}
async function account(tab='profile') {
 if(!user)return loginRequired('Đăng nhập để xem bài và nội dung của bạn.');
 const tabs=[['profile','Hồ sơ'],['posts','Bài của tôi'],['saved','Xem sau'],['purchases','Đã mua']];
 let content=`<div class="surface"><p>${esc(user.alias)} · ${esc(user.role)}</p>${user.role==='ADMIN'?link('Quản trị','#admin'):''} ${button('Đăng xuất','logout')}</div>`;
 if(tab==='posts'){
  const {posts}=await api('posts');
  content=posts.length?`<ul class="real-list surface">${posts.map(p=>`<li><a href="${postLink(p)}"><strong>${esc(p.title)}</strong></a><span>${esc(p.status)}</span>${link('Mở bài',postLink(p))}</li>`).join('')}</ul>`:empty('Bạn chưa tải tác phẩm nào.');
 }else if(['saved','purchases'].includes(tab)){
  const {posts}=await api(tab);
  content=grid(posts,tab==='saved'?'Bạn chưa lưu tác phẩm nào.':'Bạn chưa mua tác phẩm nào.');
 }
 return heading('Tài khoản',user.alias,link('Đăng tác phẩm','#upload','dark'))+`<nav class="tabs">${tabs.map(([id,label])=>`<a href="#account/${id}" class="${id===tab?'selected':''}">${label}</a>`).join('')}</nav>`+content;
}
async function newCollection() {
 if(!user)return loginRequired('Đăng nhập để tạo bộ sưu tập.');
 const {posts}=await api('catalog');
 if(!posts.length)return heading('Tạo bộ sưu tập')+empty('Chưa có bài đã phát hành để chọn.');
 return heading('Tạo bộ sưu tập')+`<form id="collection-form" class="surface edit-form"><label>Tên<input name="title" required maxlength="80"></label>
 <label>Mô tả<textarea name="description" maxlength="240"></textarea></label><fieldset><legend>Tác phẩm</legend>
 ${posts.map(p=>`<label class="check"><input name="posts" type="checkbox" value="${esc(p.id)}"> ${esc(p.title)}</label>`).join('')}</fieldset>
 <button class="btn dark">Tạo bộ sưu tập</button><p role="status"></p></form>`;
}
async function groupPage(kind,id) {
 const {group,posts}=await api(kind+'/'+encodeURIComponent(id));
 return heading(group.title,group.description)+grid(posts);
}
async function admin(tab='overview') {
 if(user?.role!=='ADMIN')return heading('Khu vực quản trị','Đăng nhập với tài khoản admin.',link('Tài khoản','#account'));
 const data=await api('admin');
 const list=(rows,format,msg)=>rows.length?`<ul class="real-list surface">${rows.map(format).join('')}</ul>`:empty(msg);
 const eventForm=(event={title:'',description:'',enabled:false,posts:[]})=>`<form class="surface edit-form" data-event-id="${esc(event.id||'')}">
  <label>Tên sự kiện<input name="title" maxlength="80" required value="${esc(event.title)}"></label><label>Mô tả<textarea name="description" maxlength="240">${esc(event.description)}</textarea></label>
  <label class="check"><input type="checkbox" name="enabled" ${event.enabled?'checked':''}> Hiện trên Trang chủ</label>
  <fieldset><legend>Bài đã phát hành</legend>${data.posts.filter(p=>p.status==='PUBLISHED'||event.posts.includes(p.id)).map(p=>`<label class="check"><input type="checkbox" name="posts" value="${esc(p.id)}" ${event.posts.includes(p.id)?'checked':''}> ${esc(p.title)}${p.status==='HIDDEN'?' · Đã ẩn':''}</label>`).join('')}</fieldset>
  <button class="btn dark">${event.id?'Lưu sự kiện':'Tạo sự kiện'}</button><p role="status"></p></form>`;
 const views={
  overview:()=>`<div class="stats">${[[data.totals.posts,'Tổng bài'],[data.totals.published,'Đã phát hành'],[data.totals.premium,'Premium công khai'],[data.paid,'Đơn đã thanh toán']].map(([count,label])=>`<div class="surface"><strong>${count}</strong><span>${label}</span></div>`).join('')}</div>`,
  posts:()=>list(data.posts,p=>`<li><a href="${postLink(p)}">${esc(p.title)}</a><span>${esc(p.status)}</span>${p.status==='PUBLISHED'?button('Ẩn bài','admin-post',p.id,'HIDDEN'):p.status==='HIDDEN'?button('Khôi phục','admin-post',p.id,'PUBLISHED'):''}</li>`,'Chưa có bài đăng.'),
  genres:()=>`<form class="surface edit-form" id="genre-form"><label>Tên thể loại<input name="name" required maxlength="60"></label><button class="btn dark">Thêm thể loại</button><p role="status"></p></form>`+
   list(data.genres,g=>`<li>${esc(g.name)}${button(g.enabled?'Tạm dừng':'Bật lại','admin-genre',g.id,!g.enabled)}</li>`,'Chưa có thể loại.'),
  events:()=>`<div class="event-editors">${eventForm()}${data.events.map(eventForm).join('')}</div>`,
  reports:()=>list(data.reports,r=>`<li><a href="#post/${encodeURIComponent(r.post_id)}">${esc(r.reason)}</a>${button('Đóng báo cáo','admin-report',r.id,'DISMISSED')}</li>`,'Chưa có báo cáo đang chờ.')
 };
 const tabs=[['overview','Tổng quan'],['posts','Bài đăng'],['genres','Thể loại'],['events','Sự kiện'],['reports','Báo cáo']];
 return `<div class="admin-layout"><aside class="admin-sidebar"><a class="logo" href="#admin">PCK<span>.</span></a><nav>${tabs.map(([id,label])=>`<a href="#admin/${id}" ${id===tab?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
 <a class="admin-exit" href="#home">← Về trang người dùng</a></aside><div class="admin-content">${heading(tabs.find(([id])=>id===tab)?.[1]||'Tổng quan')}${Object.hasOwn(views,tab)?views[tab]():views.overview()}</div></div>`;
}
function more() {
 return heading('Khác')+`<div class="shortcut-grid">${[['Bộ sưu tập','collections'],['Xem sau','account/saved'],['Đã mua','account/purchases']].map(([label,route])=>`<a class="surface shortcut" href="#${route}"><strong>${label} ↗</strong></a>`).join('')}</div>`;
}
async function render() {
 const request=++version;
 const [route,id]=(location.hash.slice(1)||'home').split('/');
 document.body.classList.toggle('admin-mode',route==='admin'&&user?.role==='ADMIN');
 adminLink.hidden=user?.role!=='ADMIN';
 loginLink.href=user?'#account':'#login';
 loginLink.textContent=user?user.alias:'Đăng nhập';
 document.querySelectorAll('.main-nav a').forEach(a=>{
  const parent=({post:'browse',login:'account',events:'home',event:'home',collections:'more',collection:'more','collection-new':'more'})[route]||route;
  if(a.hash==='#'+parent)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 });
 const pages={home,browse:discover,login,upload,more,account:()=>account(id),admin:()=>admin(id),
  collections:async()=>heading('Bộ sưu tập','',link('Tạo bộ sưu tập','#collection-new','dark'))+groupCards(await api('collections'),'collection'),
  collection:()=>groupPage('collections',id),event:()=>groupPage('events',id),'collection-new':newCollection,post:()=>detail(id)};
 app.innerHTML=empty('Đang tải…');
 try {
  const page=await (Object.hasOwn(pages,route)?pages[route]():home());
  if(request!==version)return;
  currentMedia=page.media||[];
  app.innerHTML=page.html||page;
 }catch(error){if(request===version)app.innerHTML=heading('Không thể mở trang')+empty(error.message);}
}
app.addEventListener('click',async event=>{
 const media=event.target.closest('[data-media]');
 if(media){
  const index=Number(media.dataset.media);
  document.querySelector('#post-media').innerHTML=gallery(currentMedia,index);
  document.querySelector('[data-media="'+index+'"]')?.focus({preventScroll:true});
  return;
 }
 const control=event.target.closest('[data-action]');
 if(!control)return;
 const {action,id,next}=control.dataset;
 if(['next','previous'].includes(action)){filters.offset+=action==='next'?25:-25;render();return}
 if(action==='login'||!user){afterLogin=id&&action==='login'?id:location.hash.slice(1)||'account';go('login');return}
 control.disabled=true;
 try {
  if(action==='logout'){await api('logout',{method:'POST'});user=null;go('home');return}
  if(action==='publish'){await api('publish/'+id,{method:'PUT'});notice('Đã phát hành. Khách có thể tìm bài trong Khám phá.');}
  if(['like','unlike','save','unsave'].includes(action)){
   const remove=action.startsWith('un');
   await api('catalog/'+id+'/'+(remove?action.slice(2):action),{method:remove?'DELETE':'PUT'});
  }
  if(action.startsWith('admin-'))await json(action+'/'+id,'PUT',action==='admin-genre'?{enabled:next==='true'}:{status:next});
  render();
 }catch(error){notice(error.message);control.disabled=false}
});
app.addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.target, data=new FormData(form);
 if(form.id==='browse-form'){
  const {q,kind,sort,pay,days}=Object.fromEntries(data);
  const tags=[...data].filter(([key])=>key.startsWith('genre:'));
  const selected=mode=>tags.filter(([,value])=>value===mode).map(([key])=>key.slice(6));
  filters={q,kind,sort,pay,days,offset:0,include:selected('yes'),exclude:selected('no')};
  render();
  return;
 }
 const submit=form.querySelector('button'), status=form.querySelector('[role=status]');
 submit.disabled=true;
 status.textContent='Đang xử lý…';
 try {
  if(form.id==='login-form'){
   user=await json('login','POST',Object.fromEntries(data));
   const route=afterLogin;afterLogin='account';go(route);
  }else if(form.id==='upload-form'){
   const result=await api('upload',{method:'POST',body:data});
   notice('Đã lưu bản nháp.');go('post/'+result.postId);
  }else if(form.id==='collection-form'){
   const group=await json('collections','POST',{title:data.get('title'),description:data.get('description'),posts:data.getAll('posts')});
   go('collection/'+group.id);
  }else if(form.id==='genre-form'){
   await json('admin-genres','POST',{name:data.get('name')});
   notice('Đã thêm thể loại.');
   render();
  }else if(Object.hasOwn(form.dataset,'eventId')){
   const id=form.dataset.eventId;
   await json(id?'admin-event/'+id:'admin-events',id?'PUT':'POST',{
    title:data.get('title'),description:data.get('description'),enabled:data.has('enabled'),posts:data.getAll('posts')
   });
   notice('Đã lưu sự kiện.');
   render();
  }else{
   const action=form.id==='comments-form'?'comments':'report';
   await json('catalog/'+form.dataset.id+'/'+action,'POST',{text:data.get('text')});
   if(action==='report')notice('Đã gửi báo cáo.');
   render();
  }
 }catch(error){status.textContent=error.message;}
 finally{submit.disabled=false;}
});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0)});
api('session').then(result=>{user=result.user}).catch(()=>{}).finally(render);
