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
let heroTimer;

async function cycleHero(hero) {
 try {
  const response = await fetch('/assets/hero/images');
  if (!response.ok) return;
  const {images} = await response.json();
  if (!hero.isConnected || !images.length) return;
  let index = 0;
  function show() {
   hero.style.setProperty('--hero-image', 'url("' + images[index] + '")');
   if (images.length > 1) {
    const preload = new Image();
    preload.src = images[(index+1)%images.length];
   }
  }
  show();
  if (images.length > 1) heroTimer = setInterval(() => {
   index = (index+1)%images.length;
   show();
  }, 7000);
 } catch {
  // The gradient remains visible if the image list cannot be loaded.
 }
}
let filters = {q:'',kind:'',sort:'new',pay:'',days:'',offset:0,include:[],exclude:[]};
let galleryTimer, galleryIndex = 0, galleryPost = '';
const cycleOverrides = new Map();
const uploadFiles = [];
let uploadCover = null;
let uploadBusy = false;

function clearUploadFiles() {
 for (const entry of uploadFiles) if(!entry.id)URL.revokeObjectURL(entry.preview);
 uploadFiles.length=0;
 uploadCover=null;
}

const fileSize = bytes => bytes < 1024*1024
 ? Math.max(1,Math.round(bytes/1024))+' KiB'
 : (bytes/(1024*1024)).toFixed(1)+' MiB';

function uploadPriceSummary(form) {
 const count=uploadFiles.filter(entry=>entry.premium).length;
 const price=form.elements.price;
 form.querySelector('#upload-price').hidden=!count;
 price.disabled=!count;
 price.required=Boolean(count);
 form.querySelector('#upload-price-label').textContent='Giá mua một lần cho '+count+' tệp Premium';
 form.querySelector('#upload-price-preview').textContent=price.value&&Number(price.value)>0
  ? Number(price.value).toLocaleString('vi-VN')+' ₫' : '';
}

function renderUploadFiles(form) {
 const container=form.querySelector('#upload-files');
 const total=uploadFiles.reduce((sum,entry)=>sum+entry.file.size,0);
 form.querySelector('#upload-count').textContent=uploadFiles.length+'/8 tệp'+(total?' · '+fileSize(total):'');
 form.querySelector('#upload-add').disabled=uploadFiles.length>=8;
 container.innerHTML=uploadFiles.map((entry,index)=>{
  const cover=entry===uploadCover, name=esc(entry.file.name);
  const preview=!entry.preview?'<span>Tệp không có bản xem trước</span>':entry.video
   ? `<video src="${esc(entry.preview)}" controls playsinline preload="metadata" aria-label="${name}"></video>`
   : `<img src="${esc(entry.preview)}" alt="${name}">`;
  return `<article class="upload-file">
   <div class="upload-preview">${preview}<span class="upload-chip">${cover?'Đại diện':entry.premium?'Premium':'Công khai'}</span></div>
   <div class="upload-file-meta"><strong title="${name}">${name}</strong><small>${entry.video?'Video':'Ảnh'} · ${fileSize(entry.file.size)}</small></div>
   <div class="upload-file-actions">
    <button type="button" class="btn light" data-upload-action="cover" data-index="${index}" aria-label="Chọn ${name} làm đại diện" aria-pressed="${cover}">${cover?'✓ Đại diện':'Đặt đại diện'}</button>
    <button type="button" class="btn light" data-upload-action="remove" data-index="${index}" aria-label="Xóa ${name}">Xóa</button>
   </div>
   <label class="upload-switch"><input type="checkbox" role="switch" data-upload-premium="${index}" aria-label="Premium cho ${name}" ${entry.premium?'checked':''} ${cover?'disabled':''}>
   Premium ${cover?'<small>Ảnh bìa công khai</small>':''}</label>
  </article>`;
 }).join('');
 uploadPriceSummary(form);
}

function addUploadFiles(form, selected) {
 if(uploadBusy)return;
 const issues=new Set();
 let total=uploadFiles.reduce((sum,entry)=>sum+entry.file.size,0);
 for(const file of selected){
  if(!/\.(jpe?g|png|mp4)$/i.test(file.name)||!file.size){issues.add('Chỉ nhận tệp JPG, PNG hoặc MP4 có dữ liệu.');continue}
  if(uploadFiles.some(({file:old})=>old.name===file.name&&old.size===file.size&&old.lastModified===file.lastModified)){
   issues.add('Tệp đã có trong danh sách được bỏ qua.');
   continue;
  }
  if(uploadFiles.length>=8){issues.add('Chỉ thêm được tối đa 8 tệp.');break}
  if(file.size>10*1024*1024||total+file.size>40*1024*1024){issues.add('Tối đa 10 MiB mỗi tệp và 40 MiB tổng cộng.');continue}
  const entry={file,preview:URL.createObjectURL(file),video:/\.mp4$/i.test(file.name),premium:false};
  uploadFiles.push(entry);
  total+=file.size;
  if(!uploadCover)uploadCover=entry;
 }
 const image=uploadFiles.find(entry=>!entry.video);
 if(uploadCover?.video&&image)uploadCover=image;
 form.querySelector('#upload-feedback').textContent=[...issues].join(' ');
 form.querySelector('[role=status][data-submit-result]').textContent='';
 renderUploadFiles(form);
}

function buildUploadPayload(form) {
 if(!uploadFiles.length)throw new Error('Thêm ít nhất một ảnh hoặc video.');
 const marked=uploadFiles.flatMap((entry,index)=>entry.premium?[index]:[]);
 if(marked.length&&uploadCover.video)throw new Error('Bài Premium cần ảnh JPG hoặc PNG công khai làm đại diện.');
 const data=new FormData(form);
 data.set('cover',String(uploadFiles.indexOf(uploadCover)));
 let upload=0;
 const entries=uploadFiles.map(entry=>{
  if(entry.id)return {id:entry.id};
  data.append('file',entry.file);
  return {upload:upload++};
 });
 if(form.dataset.postId)data.set('entries',JSON.stringify(entries));
 for(const index of marked)data.append('premiumIndex',String(index));
 return data;
}

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
  <p>${esc(p.withdrawn_at?'Đã gỡ khỏi Khám phá':p.status==='HIDDEN'?'Không khả dụng':price(p))}</p></div></a></article>`;
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
function genreOptions(genres,assigned=[]) {
 const choices=[...genres,...assigned.filter(item=>!genres.some(g=>g.id===item.id))];
 return '<option value="">Chưa chọn</option>'+choices.map(g=>`<option value="${esc(g.id)}" ${g.id===assigned[0]?.id?'selected':''}>${esc(g.name)}</option>`).join('');
}
const postStatus=p=>p.withdrawn_at?'Đã gỡ':({DRAFT:'Bản nháp',PUBLISHED:'Đã phát hành',HIDDEN:'Đang ẩn'})[p.status]||p.status;
function postActions(p) {
 if(!['DRAFT','PUBLISHED'].includes(p.status))return '';
 return link('Sửa bài','#edit/'+encodeURIComponent(p.id))+
  button(p.status==='DRAFT'?'Xóa nháp':'Gỡ bài','remove-post',p.id,p.status);
}
function publishedEditor({post,media,genres:assigned},genres) {
 const publicMedia=media.filter(file=>!Number(post.price_vnd)||(!file.premium&&file.kind==='IMAGE'));
 return heading('Sửa bài đã phát hành','Bạn có thể sửa thông tin, ảnh đại diện và chế độ tự chuyển ảnh.',link('Hủy',postLink(post)))+
  `<form id="published-edit" class="surface edit-form" data-id="${esc(post.id)}">
  <input name="revision" type="hidden" value="${esc(post.revision)}">
  <label>Tiêu đề<input name="title" required maxlength="100" value="${esc(post.title)}"></label>
  <label>Mô tả<textarea name="description" maxlength="1000" rows="4">${esc(post.description)}</textarea></label>
  <label>Thể loại<select name="genre">${genreOptions(genres,assigned)}</select></label>
  <label>Ảnh đại diện<select name="cover"><option value="">Giữ ảnh đại diện hiện tại</option>
   ${publicMedia.map(file=>`<option value="${esc(file.id)}">${esc(file.filename)}</option>`).join('')}</select></label>
  <label class="check"><input name="autoCycle" type="checkbox" ${post.auto_cycle?'checked':''}> Tự chuyển ảnh mỗi 7 giây khi mở bài</label>
  <p class="muted">Tệp, trạng thái Premium và giá được giữ nguyên để người mua tiếp tục truy cập nội dung đã mua.</p>
  <button class="btn dark">Lưu thay đổi</button><p role="status" class="muted"></p></form>`;
}
async function upload(id) {
 if(!user) return loginRequired('Đăng nhập để tải tệp lên.');
 const {genres}=await api('genres');
 const draft=id?await api('manage-post/'+encodeURIComponent(id)):null;
 if(draft?.post.status==='PUBLISHED')return publishedEditor(draft,genres);
 const post=draft?.post;
 const html=heading(post?'Sửa bản nháp':'Đăng tác phẩm','Thêm ảnh hoặc video, chọn ảnh bìa và quyết định tệp nào cần trả phí.',post?link('Hủy',postLink(post)):'')+
 `<form id="upload-form" class="surface edit-form upload-form" ${post?`data-post-id="${esc(post.id)}"`:''}>
 <fieldset class="upload-fields">
 <input name="revision" type="hidden" value="${esc(post?.revision)}">
 <label>Tiêu đề<input name="title" maxlength="100" required value="${esc(post?.title)}"></label><label>Mô tả<textarea name="description" maxlength="1000" rows="3">${esc(post?.description)}</textarea></label>
 <label>Thể loại<select name="genre">${genreOptions(genres,draft?.genres)}</select></label>
 <section id="upload-drop" class="upload-drop" aria-label="Kéo thả tệp">
  <input id="upload-picker" type="file" multiple accept=".jpg,.jpeg,.png,.mp4" hidden>
  <button type="button" id="upload-add" class="btn dark" data-upload-action="add">+ Thêm ảnh/video</button>
  <span>Kéo và thả vào đây hoặc thêm tệp qua nhiều lượt</span>
  <small>JPG, PNG, MP4 · 8 tệp · 10 MiB/tệp · 40 MiB/bài</small>
 </section>
 <div class="upload-list-head"><strong>Tệp trong bài</strong><span id="upload-count" aria-live="polite">0/8 tệp</span></div>
 <p id="upload-feedback" class="upload-feedback" aria-live="polite"></p>
 <div id="upload-files" class="upload-files"></div>
 <label class="check"><input name="autoCycle" type="checkbox" ${post?.auto_cycle?'checked':''}> Tự chuyển ảnh mỗi 7 giây khi mở bài</label>
 <section id="upload-price" class="upload-price" hidden><label><span id="upload-price-label"></span>
 <input name="price" type="number" min="1" max="100000000" step="1" inputmode="numeric" placeholder="Ví dụ: 39000" value="${Number(post?.price_vnd)||''}" disabled></label>
 <output id="upload-price-preview" aria-live="polite"></output><small>Một mức giá bằng VND để mở toàn bộ tệp được bật Premium. Các tệp khác vẫn xem miễn phí.</small></section>
 <button type="submit" class="btn dark">${post?'Lưu bản nháp':'Tải lên và lưu nháp'}</button><p data-submit-result role="status" class="muted"></p>
 </fieldset></form>`;
 return {html,draft};
}
function gallery(media,i=0) {
 if(!media.length)return empty('Chưa có tệp để hiển thị.');
 const m=media[i];
 let view='<span>Không có tệp trong kho local</span>';
 if(m.locked)view='<strong>Nội dung trả phí</strong>';
 else if(m.url&&m.kind==='VIDEO')view=`<video src="${esc(m.url)}" controls playsinline preload="metadata"></video>`;
 else if(m.url&&m.kind==='IMAGE')view=`<img src="${esc(m.url)}" alt="${esc(m.filename)}">`;
 return `<div class="preview media-stage">${view}</div><div class="media-thumbs">${media.map((f,k)=>`<button type="button" class="btn light" data-media="${k}" aria-pressed="${i===k}">${kindNames[f.kind]||'Tệp'} ${k+1}${f.locked?' · Khóa':f.premium?' · Premium':''}</button>`).join('')}
 ${media.filter(f=>f.kind==='IMAGE'&&f.url).length>1?`<button type="button" class="btn light" data-action="cycle" aria-pressed="${Boolean(cycleOverrides.get(galleryPost))}">${cycleOverrides.get(galleryPost)?'Dừng tự chuyển':'Tự chuyển ảnh'}</button>`:''}</div>
  <p>${esc(m.filename)}${m.url?` · <a href="${esc(m.url)}" download="${esc(m.filename)}">Tải tệp</a>`:''}</p>`;
}
async function detail(id) {
 const data=await api('catalog/'+encodeURIComponent(id));
 const {post,media}=data;
 const published=post.status==='PUBLISHED';
 const form=(name,label)=>`<form id="${name}" data-id="${esc(id)}"><input name="text" required maxlength="1000" aria-label="${label}" placeholder="${label}"><button class="btn light">Gửi</button><p role="status"></p></form>`;
 return {media,post, html:heading(post.title,post.author||'')+`<div class="detail"><section id="post-media"></section>
 <aside class="surface"><p class="category">${esc(published?price(post):postStatus(post))}</p><p>${esc(post.description)}</p>
 ${data.canManage?`<div class="button-row post-actions">${data.canPublish?button('Phát hành','publish',id):''}${postActions(post)}</div>`:''}
 ${published&&Number(post.price_vnd)&&media.some(f=>f.locked)?`<p>Mua thử để kiểm tra quyền xem. Không thu tiền.</p>${button('Mua thử · '+price(post),'test-purchase',id,post.price_vnd)}`:''}
 ${published?`<div class="button-row">${button((data.liked?'Bỏ thích':'Thích')+' · '+data.likes,data.liked?'unlike':'like',id)}${button(data.saved?'Bỏ lưu':'Xem sau',data.saved?'unsave':'save',id)}</div>`:''}</aside></div>
 ${published?`<section class="surface comments"><h2>Bình luận</h2>${data.comments.length?data.comments.map(c=>`<p><strong>${esc(c.author||'Tài khoản không khả dụng')}</strong> · ${esc(c.body)}</p>`).join(''):'<p>Chưa có bình luận.</p>'}
 ${user?form('comments-form','Viết bình luận')+`<details><summary>Báo cáo bài</summary>${form('report-form','Lý do báo cáo')}</details>`:button('Đăng nhập để bình luận','login','post/'+id)}</section>`:''}`};
}
function updateGallery(direction) {
 const panel=document.querySelector('#post-media');
 if(!panel)return;
 panel.innerHTML=gallery(currentMedia,galleryIndex);
 if(direction){
  const stage=panel.querySelector('.media-stage');
  stage?.classList.add('gallery-slide',direction==='back'?'gallery-slide-back':'gallery-slide-forward');
 }
}
function scheduleGallery() {
 clearInterval(galleryTimer);
 const items=currentMedia.flatMap((file,index)=>file.kind==='IMAGE'&&file.url?[index]:[]);
 if(!cycleOverrides.get(galleryPost)||items.length<2||currentMedia[galleryIndex]?.kind==='VIDEO')return;
 galleryTimer=setInterval(()=>{
  const panel=document.querySelector('#post-media');
  if(!panel||panel.contains(document.activeElement)||document.hidden)return;
  galleryIndex=items[(items.indexOf(galleryIndex)+1)%items.length];
  updateGallery('forward');
 },7000);
}
async function account(tab='profile') {
 if(!user)return loginRequired('Đăng nhập để xem bài và nội dung của bạn.');
 const tabs=[['profile','Hồ sơ'],['posts','Bài của tôi'],['saved','Xem sau'],['purchases','Đã mua']];
 let content=`<div class="surface"><p>${esc(user.alias)} · ${esc(user.role)}</p>${user.role==='ADMIN'?link('Quản trị','#admin'):''} ${button('Đăng xuất','logout')}</div>`;
 if(tab==='posts'){
  const {posts}=await api('posts');
  content=posts.length?`<ul class="real-list surface">${posts.map(p=>`<li><a href="${postLink(p)}"><strong>${esc(p.title)}</strong></a><span>${esc(postStatus(p))}</span><div class="button-row post-actions">${postActions(p)}</div></li>`).join('')}</ul>`:empty('Bạn chưa tải tác phẩm nào.');
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
  posts:()=>list(data.posts,p=>`<li><a href="${postLink(p)}">${esc(p.title)}</a><span>${esc(postStatus(p))}</span>${p.status==='PUBLISHED'?button('Ẩn bài','admin-post',p.id,'HIDDEN'):p.status==='HIDDEN'&&!p.withdrawn_at?button('Khôi phục','admin-post',p.id,'PUBLISHED'):''}</li>`,'Chưa có bài đăng.'),
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
 clearInterval(heroTimer);
 clearInterval(galleryTimer);
 const request=++version;
 const [route,id]=(location.hash.slice(1)||'home').split('/');
 clearUploadFiles();
 document.body.classList.toggle('admin-mode',route==='admin'&&user?.role==='ADMIN');
 adminLink.hidden=user?.role!=='ADMIN';
 loginLink.href=user?'#account':'#login';
 loginLink.textContent=user?user.alias:'Đăng nhập';
 document.querySelectorAll('.main-nav a').forEach(a=>{
  const parent=({post:'browse',login:'account',events:'home',event:'home',collections:'more',collection:'more','collection-new':'more'})[route]||route;
  if(a.hash==='#'+parent)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 });
 const pages={home,browse:discover,login,upload:()=>upload(),edit:()=>upload(id),more,account:()=>account(id),admin:()=>admin(id),
  collections:async()=>heading('Bộ sưu tập','',link('Tạo bộ sưu tập','#collection-new','dark'))+groupCards(await api('collections'),'collection'),
  collection:()=>groupPage('collections',id),event:()=>groupPage('events',id),'collection-new':newCollection,post:()=>detail(id)};
 app.innerHTML=empty('Đang tải…');
 try {
  const page=await (Object.hasOwn(pages,route)?pages[route]():home());
  if(request!==version)return;
  currentMedia=page.media||[];
  app.innerHTML=page.html||page;
  const form=app.querySelector('#upload-form');
  if(form){
   if(page.draft) {
    uploadFiles.push(...page.draft.media.map(file=>({
     id:file.id,file:{name:file.filename,size:file.size},preview:file.url,video:file.kind==='VIDEO',premium:file.premium
    })));
    uploadCover=uploadFiles[0]||null;
   }
   renderUploadFiles(form);
  }
  if(page.post){
   galleryPost=page.post.id;
   galleryIndex=0;
   if(!cycleOverrides.has(galleryPost))cycleOverrides.set(galleryPost,page.post.auto_cycle);
   updateGallery();
   scheduleGallery();
  }
  const hero = app.querySelector('.hero');
  if (hero) cycleHero(hero);
 }catch(error){if(request===version)app.innerHTML=heading('Không thể mở trang')+empty(error.message);}
}
app.addEventListener('click',async event=>{
 const uploadControl=event.target.closest('[data-upload-action]');
 if(uploadControl){
  const form=uploadControl.closest('#upload-form');
  if(!form||uploadBusy)return;
  const {uploadAction,index}=uploadControl.dataset;
  if(uploadAction==='add'){form.querySelector('#upload-picker').click();return}
  const entry=uploadFiles[Number(index)];
  if(!entry)return;
  const feedback=form.querySelector('#upload-feedback');
  feedback.textContent='';
  if(uploadAction==='cover'){
   if(entry.video&&uploadFiles.some(file=>!file.video)){
    feedback.textContent='Chọn một ảnh làm đại diện cho bài có ảnh.';
    return;
   }
   if(entry.premium)feedback.textContent='Tệp đã được chuyển sang công khai vì được chọn làm đại diện.';
   entry.premium=false;
   uploadCover=entry;
  }else if(uploadAction==='remove'){
   if(!entry.id)URL.revokeObjectURL(entry.preview);
   uploadFiles.splice(Number(index),1);
   if(entry===uploadCover){
    uploadCover=uploadFiles.find(file=>!file.video&&!file.premium)||
     uploadFiles.find(file=>!file.video)||uploadFiles[0]||null;
    if(uploadCover?.premium){
     uploadCover.premium=false;
     feedback.textContent='Tệp đại diện mới đã được chuyển sang công khai.';
    }
   }
  }
  renderUploadFiles(form);
  const selector=uploadAction==='remove'?'#upload-add':'[data-upload-action="cover"][data-index="'+index+'"]';
  form.querySelector(selector)?.focus({preventScroll:true});
  return;
 }
 const media=event.target.closest('[data-media]');
 if(media){
  const nextIndex=Number(media.dataset.media);
  if(nextIndex===galleryIndex)return;
  const direction=nextIndex<galleryIndex?'back':'forward';
  galleryIndex=nextIndex;
  updateGallery(direction);
  scheduleGallery();
  document.querySelector('[data-media="'+galleryIndex+'"]')?.focus({preventScroll:true});
  return;
 }
 const control=event.target.closest('[data-action]');
 if(!control)return;
 const {action,id,next}=control.dataset;
 if(action==='cycle'){
  cycleOverrides.set(galleryPost,!cycleOverrides.get(galleryPost));
  updateGallery();
  scheduleGallery();
  return;
 }
 if(['next','previous'].includes(action)){filters.offset+=action==='next'?25:-25;render();return}
 if(action==='login'||!user){afterLogin=id&&action==='login'?id:location.hash.slice(1)||'account';go('login');return}
 control.disabled=true;
 try {
  if(action==='logout'){await api('logout',{method:'POST'});user=null;go('home');return}
  if(action==='publish'){await api('publish/'+id,{method:'PUT'});notice('Đã phát hành. Khách có thể tìm bài trong Khám phá.');}
  if(action==='remove-post'){
   const draft=next==='DRAFT';
   const message=draft?'Xóa vĩnh viễn bản nháp và các tệp của bài này?':'Gỡ bài khỏi Khám phá? Người đã mua vẫn xem được tệp của họ.';
   if(!window.confirm(message)){control.disabled=false;return}
   const result=await json('manage-post/'+id,'DELETE',{status:next});
   notice(result.status==='DELETED'?'Đã xóa bản nháp.':'Đã gỡ bài khỏi Khám phá.');
   go('account/posts');
   return;
  }
  if(action==='test-purchase'){
   if(!window.confirm('Xác nhận mua thử? Không có tiền thật được thu.')){control.disabled=false;return}
   await json('test-purchase/'+id,'POST',{price:Number(next)});
   notice('Mua thử thành công. Đã mở quyền xem.');
  }
  if(['like','unlike','save','unsave'].includes(action)){
   const remove=action.startsWith('un');
   await api('catalog/'+id+'/'+(remove?action.slice(2):action),{method:remove?'DELETE':'PUT'});
  }
  if(action.startsWith('admin-'))await json(action+'/'+id,'PUT',action==='admin-genre'?{enabled:next==='true'}:{status:next});
  render();
 }catch(error){notice(error.message);control.disabled=false}
});
app.addEventListener('change',event=>{
 const field=event.target;
 const form=field.closest('#upload-form');
 if(!form)return;
 if(field.id==='upload-picker'){
  addUploadFiles(form,[...field.files]);
  field.value='';
 }
 if(field.hasAttribute('data-upload-premium')){
  const index=Number(field.dataset.uploadPremium);
  const entry=uploadFiles[index];
  if(!entry||entry===uploadCover||uploadBusy)return;
  entry.premium=field.checked;
  renderUploadFiles(form);
  form.querySelector('[data-upload-premium="'+index+'"]')?.focus({preventScroll:true});
 }
});
app.addEventListener('input',event=>{
 if(event.target.name==='price'&&event.target.form?.id==='upload-form')uploadPriceSummary(event.target.form);
});
app.addEventListener('dragover',event=>{
 const zone=event.target.closest('#upload-drop');
 if(!zone||!event.dataTransfer.types.includes('Files'))return;
 event.preventDefault();
 event.dataTransfer.dropEffect=uploadBusy?'none':'copy';
 if(!uploadBusy)zone.classList.add('drag-active');
});
app.addEventListener('dragleave',event=>{
 const zone=event.target.closest('#upload-drop');
 if(zone&&!zone.contains(event.relatedTarget))zone.classList.remove('drag-active');
});
app.addEventListener('drop',event=>{
 const zone=event.target.closest('#upload-drop');
 if(!zone)return;
 event.preventDefault();
 zone.classList.remove('drag-active');
 addUploadFiles(zone.closest('form'),[...event.dataTransfer.files]);
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
 const submit=form.querySelector('button[type=submit]')||form.querySelector('button'), status=form.querySelector('[role=status]');
 submit.disabled=true;
 status.textContent='Đang xử lý…';
 try {
  if(form.id==='login-form'){
   user=await json('login','POST',Object.fromEntries(data));
   const route=afterLogin;afterLogin='account';go(route);
  }else if(form.id==='upload-form'){
   if(uploadBusy)return;
   const payload=buildUploadPayload(form);
   uploadBusy=true;
   const fields=form.querySelector('.upload-fields');
   fields.disabled=true;
   let result;
   const draftId=form.dataset.postId;
   try { result=await api(draftId?'edit-draft/'+draftId:'upload',{method:draftId?'PUT':'POST',body:payload}); }
   finally { uploadBusy=false;fields.disabled=false; }
   clearUploadFiles();
   notice('Đã lưu bản nháp.');go('post/'+result.postId);
  }else if(form.id==='published-edit'){
   await json('manage-post/'+form.dataset.id,'PUT',{
    title:data.get('title'),description:data.get('description'),genreId:data.get('genre'),
    coverId:data.get('cover'),autoCycle:data.has('autoCycle'),revision:data.get('revision')
   });
   cycleOverrides.delete(form.dataset.id);
   notice('Đã lưu thay đổi.');
   go('post/'+form.dataset.id);
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
