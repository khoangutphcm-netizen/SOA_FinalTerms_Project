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
  const slides = document.createElement('div');
  slides.className = 'hero-slides';
  slides.setAttribute('aria-hidden', 'true');
  hero.prepend(slides);
  function loadSlide(src) {
   const image = new Image();
   image.alt = '';
   image.src = src;
   return image;
  }
  let index = 0;
  let current = loadSlide(images[index]);
  slides.append(current);
  if (images.length < 2) return;
  let next = loadSlide(images[1]);
  heroTimer = setInterval(() => {
   if (!hero.isConnected) return;
   if (!next.complete) return;
   if (next.naturalWidth) {
    current.className = 'hero-slide-out';
    next.className = 'hero-slide-in';
    slides.replaceChildren(current, next);
    current = next;
   }
   index = (index+1)%images.length;
   next = loadSlide(images[(index+1)%images.length]);
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
   ${entry.video&&entry.premium?`<label>Bắt đầu preview (giây)
    <input type="number" min="0" max="86400" step="1" required name="previewStart:${index}" data-preview-start="${index}" value="${esc(entry.previewStart??0)}">
    <small>Tối đa 10 giây từ mốc này.</small></label>`:''}
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
 form.querySelector('#upload-feedback').textContent=[...issues].join(' ');
 form.querySelector('[role=status][data-submit-result]').textContent='';
 renderUploadFiles(form);
}

function buildUploadPayload(form) {
 if(!uploadFiles.length)throw new Error('Thêm ít nhất một ảnh hoặc video.');
 const marked=uploadFiles.flatMap((entry,index)=>entry.premium?[index]:[]);
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
function card(p, quickSave=false) {
 const types=p.kinds||[];
 const kinds=types.includes('IMAGE')&&types.includes('VIDEO')?['Hỗn hợp']:types.map(k=>kindNames[k]||'Tệp');
 const cover = p.status==='PUBLISHED' && p.cover_id ? '/api/demo/media/'+encodeURIComponent(p.cover_id) : '';
 const video=cover&&p.cover_kind==='VIDEO';
 return `<article class="card ${video?'video-card':''}"><a href="${postLink(p)}">
  <div class="visual real-cover">${video?`<video src="${cover}" muted playsinline loop preload="metadata" aria-hidden="true"></video>`
   :cover&&p.cover_kind==='IMAGE'?`<img src="${cover}" alt="" loading="lazy">`:'<span>Chưa có ảnh bìa</span>'}</div>
  <div class="card-body"><div class="catalog-card-meta"><span class="category">${esc(kinds.join(' · '))}</span>${p.genres?.length?`<span>${esc(p.genres.join(' · '))}</span>`:''}</div><h3>${esc(p.title)}</h3>
  <p class="catalog-price">${quickSave&&Number(p.price_vnd)>0?'<span>Premium</span> · ':''}${esc(p.moderation_state==='TAKEN_DOWN'?'Đã gỡ do kiểm duyệt':p.withdrawn_at?'Đã gỡ khỏi Khám phá':p.moderation_state==='TEMP_HIDDEN'?'Tạm ẩn · Người mua vẫn xem được':p.status==='HIDDEN'?'Không khả dụng':price(p))}</p></div></a>
  ${quickSave?`<button type="button" class="card-save" data-quick-save="${esc(p.id)}" aria-label="Lưu ${esc(p.title)} vào Xem sau" aria-pressed="${savedForBrowse.has(p.id)}">${savedForBrowse.has(p.id)?'Đã lưu':'Lưu'}</button>`:''}
  ${video?'<button type="button" class="video-card-toggle" aria-label="Phát video đại diện" data-video-toggle>▶</button>':''}</article>`;
}
const grid = (posts,msg='Chưa có tác phẩm nào.',quickSave=false) => posts.length?`<div class="grid">${posts.map(post=>card(post,quickSave)).join('')}</div>`:empty(msg);
const groupCards = (groups, route) => groups.length?`<div class="grid compact-collections">${groups.map(g=>`<article class="card"><a href="#${route}/${encodeURIComponent(g.id)}">${route==='collection'? `<div class="visual real-cover collection-cover">${g.cover_id?`<img src="/api/demo/media/${encodeURIComponent(g.cover_id)}" alt="" loading="lazy">`:'<span>Chưa có ảnh bìa</span>'}</div>`:''}<div class="card-body"><span class="category">${g.total} tác phẩm</span><h3>${esc(g.title)}</h3><p>${esc(g.description)}</p></div></a></article>`).join('')}</div>`:empty('Chưa có nội dung trong mục này.');
const shelf = (title, body, action='') => `<section class="section"><div class="heading"><h2>${title}</h2>${action}</div>${body}</section>`;
async function home() {
 const [catalog,photos,videos,mixed,collections,events] = await Promise.all([
  api('catalog'),api('catalog?kind=IMAGE'),api('catalog?kind=VIDEO'),api('catalog?kind=MIXED'),api('collections'),api('events')
 ]);
 const activeEvents=events.filter(event=>event.total>0).slice(0,2);
 const highlights=await Promise.allSettled(activeEvents.map(event=>api('events/'+encodeURIComponent(event.id))));
 const featured=[...new Map(highlights.flatMap(result=>result.value?.posts??[]).map(post=>[post.id,post])).values()];
 const picks=(featured.length?featured:catalog.posts).slice(0,3);
 const shown=new Set(picks.map(post=>post.id));
 function take(posts) {
  const entries=posts.filter(post=>!shown.has(post.id)).slice(0,4);
  for(const post of entries)shown.add(post.id);
  return entries;
 }
 const recent=take(catalog.posts);
 const mediaShelf=(title,entries,route)=>entries.length?shelf(title,grid(entries),link('Xem thêm',route)):'';
 return '<div class="catalog-page catalog-home">'+document.querySelector('#hero-template').innerHTML +
  '<nav class="home-format-nav" aria-label="Duyệt theo định dạng"><a href="#browse/IMAGE">Ảnh</a><a href="#browse/VIDEO">Video</a><a href="#browse/MIXED">Hỗn hợp</a></nav>'+
  shelf('Nổi bật',picks.length?`<div class="feature-gallery" data-count="${picks.length}">${picks.map(post=>card(post)).join('')}</div>`:empty('Chưa có tác phẩm nổi bật.'),link('Vào Khám phá','#browse'))+
  mediaShelf('Mới phát hành',recent,'#browse')+
  mediaShelf('Ảnh',take(photos.posts),'#browse/IMAGE')+
  mediaShelf('Video',take(videos.posts),'#browse/VIDEO')+
  mediaShelf('Hỗn hợp',take(mixed.posts),'#browse/MIXED')+
  (activeEvents.length?shelf('Sự kiện',groupCards(activeEvents,'event')):'')+
  shelf('Bộ sưu tập',groupCards(collections.slice(0,4),'collection'),link('Xem tất cả','#collections'))+'</div>';
}
let browseTimer, browseRequest = 0;
let savedForBrowse = new Set();

function browseSearch() {
 const {include,exclude,...basic}=filters;
 const search=new URLSearchParams(basic);
 for(const id of include)search.append('include',id);
 for(const id of exclude)search.append('exclude',id);
 return api('catalog?'+search);
}

function browseResults(posts) {
 return grid(posts,'Không tìm thấy tác phẩm phù hợp.',true)+
  `<div class="button-row pagination">${filters.offset?button('Trang trước','previous'):''}${posts.length===25&&filters.offset<3000?button('Trang sau','next'):''}</div>`;
}

function updateBrowse(form, delay=0) {
 clearTimeout(browseTimer);
 const request=++browseRequest;
 const status=form.querySelector('[role=status]');
 const results=document.querySelector('#browse-results');
 status.textContent='Đang lọc…';
 results.setAttribute('aria-busy','true');
 browseTimer=setTimeout(async ()=>{
  if(!form.isConnected)return;
  try {
   const {posts}=await browseSearch();
   if(request!==browseRequest||!form.isConnected)return;
   results.innerHTML=browseResults(posts);
   status.textContent=posts.length?`Hiển thị ${posts.length} tác phẩm.`:'Không có kết quả.';
  } catch {
   if(request!==browseRequest||!form.isConnected)return;
   status.textContent='Chưa cập nhật được kết quả. Nhấn Tìm kiếm để thử lại.';
  } finally {
   if(request===browseRequest&&form.isConnected)results.removeAttribute('aria-busy');
  }
 },delay);
}

function filterBrowse(form, delay=0) {
 const data=new FormData(form);
 const {q,kind,sort,pay,days}=Object.fromEntries(data);
 const tags=[...data].filter(([key])=>key.startsWith('genre:'));
 const selected=mode=>tags.filter(([,value])=>value===mode).map(([key])=>key.slice(6));
 filters={q:q.trim(),kind,sort,pay,days,offset:0,include:selected('yes'),exclude:selected('no')};
 form.querySelectorAll('[data-topic]').forEach(choice=>
  choice.setAttribute('aria-pressed',String(filters.include.includes(choice.dataset.topic))));
 const active=Number(sort!=='new')+Number(Boolean(pay))+Number(Boolean(days))+filters.include.length+filters.exclude.length;
 form.querySelector('[data-filter-count]').textContent=active?` (${active})`:'';
 updateBrowse(form,delay);
}

async function discover() {
 const {include,exclude}=filters;
 const [catalog,genreList,saved]=await Promise.allSettled([browseSearch(),api('genres'),user?api('saved'):null]);
 savedForBrowse=new Set((saved.value?.posts??[]).map(post=>post.id));
 const genres=genreList.value?.genres??[];
 const option=(key,label,current)=>`<option value="${key}" ${key===current?'selected':''}>${label}</option>`;
 const formats=[['','Tất cả'],['IMAGE','Ảnh'],['VIDEO','Video'],['MIXED','Hỗn hợp']];
 return '<div class="catalog-page catalog-discover">'+heading('Khám phá')+`<form id="browse-form" class="browse-controls">
  <div class="catalog-search browse-search">
   <input name="q" type="search" aria-label="Từ khóa" placeholder="Tìm tên, mô tả hoặc thể loại" maxlength="100" value="${esc(filters.q)}">
   <button type="submit" class="btn dark">Tìm kiếm</button>
  </div>
  <input type="hidden" name="kind" value="${esc(filters.kind)}">
  <div class="browse-formats" role="group" aria-label="Định dạng">${formats.map(([value,label])=>`<button type="button" data-format="${value}" aria-pressed="${filters.kind===value}">${label}</button>`).join('')}</div>
  ${genres.length?`<div class="browse-topics" role="group" aria-label="Chủ đề nhanh">${genres.slice(0,6).map(g=>`<button type="button" data-topic="${esc(g.id)}" aria-pressed="${include.includes(g.id)}">${esc(g.name)}</button>`).join('')}</div>`:''}
  <div class="browse-filter-row"><details class="browse-filter"><summary>Bộ lọc<span data-filter-count>${include.length+exclude.length+Number(Boolean(filters.pay))+Number(Boolean(filters.days))+Number(filters.sort!=='new')? ` (${include.length+exclude.length+Number(Boolean(filters.pay))+Number(Boolean(filters.days))+Number(filters.sort!=='new')})`:''}</span></summary>
  <div class="browse-options">
  <select name="sort" aria-label="Sắp xếp">${option('new','Mới nhất',filters.sort)}${option('old','Cũ nhất',filters.sort)}</select>
  <select name="pay" aria-label="Mức giá">${option('','Mọi mức giá',filters.pay)}${option('free','Miễn phí',filters.pay)}${option('premium','Trả phí',filters.pay)}</select>
  <select name="days" aria-label="Thời gian đăng">${option('','Mọi thời gian',filters.days)}${option('7','7 ngày qua',filters.days)}${option('30','30 ngày qua',filters.days)}${option('older','Cũ hơn 30 ngày',filters.days)}</select>
  ${genres.length?`<details class="genre-box" ${include.length||exclude.length?'open':''}><summary>Thể loại</summary>
   ${genres.map(g=>{
    const selected=include.includes(g.id)?'yes':exclude.includes(g.id)?'no':'';
    return `<label>${esc(g.name)}<select name="genre:${esc(g.id)}">${option('','Bỏ qua',selected)}${option('yes','Có',selected)}${option('no','Không',selected)}</select></label>`;
   }).join('')}</details>`:''}
  </div></details><button type="button" class="browse-reset" data-browse-reset>Xóa bộ lọc</button>
  <p class="muted browse-status" role="status">${catalog.status==='rejected'?'Chưa tải được kết quả. Nhấn Tìm kiếm để thử lại.':catalog.value.posts.length?`Hiển thị ${catalog.value.posts.length} tác phẩm.`:'Không có kết quả.'}</p></div>
  </form><div id="browse-results">${catalog.value?browseResults(catalog.value.posts):''}</div></div>`;
}
function welcome() {
 return `<section class="welcome-screen"><div class="welcome-copy">
  <h1><span>PCK.</span><br>Kho ảnh<br>và video.</h1>
  <p>Khám phá góc nhìn mới, đăng tác phẩm của bạn và tìm nội dung phù hợp cho dự án tiếp theo.</p>
  <div class="button-row">${link('Đăng nhập','#login')}${link('Đăng ký','#register','dark')}</div>
 </div><div class="welcome-art" aria-hidden="true">
  <div class="welcome-photo"></div>
 </div></section>
 <section class="welcome-guide" aria-labelledby="welcome-guide-title">
  <header><h2 id="welcome-guide-title">Khám phá và chia sẻ tác phẩm</h2>
   <p>Tìm ảnh, video và bộ sưu tập theo chủ đề, hoặc đăng tác phẩm của riêng bạn.</p>
  </header>
  <div class="welcome-topics">
   <article><h3>Ảnh, video và bộ sưu tập</h3><p>Duyệt theo định dạng và thể loại. Bạn có thể xem các bài công khai khi chưa đăng nhập.</p><a href="#browse">Vào Khám phá <span aria-hidden="true">→</span></a></article>
   <article><h3>Nội dung Premium</h3><p>Xem trước ảnh hoặc một đoạn video. Sau khi mua, bạn có thể tìm và tải bản đầy đủ trong mục Đã mua.</p></article>
   <article><h3>Dành cho người sáng tạo</h3><p>Đăng nhiều ảnh và video trong một bài, chọn tệp đại diện và đặt giá cho phần Premium.</p><a href="#upload">Đăng tác phẩm <span aria-hidden="true">→</span></a></article>
  </div>
 </section>`;
}
function authForm(register=false) {
 if(user)return heading('Bạn đã đăng nhập',user.alias,link('Tài khoản','#account'));
 const label=register?'Tạo tài khoản':'Đăng nhập';
 return `<section class="auth-screen">${heading(label)}<form id="${register?'register':'login'}-form" class="surface edit-form">
 ${register?'<label>Tên hiển thị<input name="displayName" required maxlength="80" autocomplete="nickname"></label>':''}
 ${register?'<label>Email<input name="email" type="email" required maxlength="254" autocomplete="username"></label>':'<label>Tên đăng nhập hoặc email<input name="identifier" type="text" required maxlength="254" autocapitalize="none" autocomplete="username" placeholder="Ví dụ: user1"></label>'}
 <label>Mật khẩu<input name="password" type="password" required ${register?'minlength="8"':''} maxlength="128" autocomplete="${register?'new-password':'current-password'}"></label>
 <div class="button-row"><button class="btn dark">${label}</button>${register?link('Đã có tài khoản','#login'):link('Tạo tài khoản','#register')}</div>
 <p role="status" class="muted"></p>
 <a href="#home">Tiếp tục với vai trò khách</a>
 </form></section>`;
}
const loginRequired = message => heading('Bạn đang xem với vai trò Khách',message)+button('Đăng nhập','login',location.hash.slice(1)||'account');
function genreOptions(genres,assigned=[]) {
 const choices=[...genres,...assigned.filter(item=>!genres.some(g=>g.id===item.id))];
 return '<option value="">Chưa chọn</option>'+choices.map(g=>`<option value="${esc(g.id)}" ${g.id===assigned[0]?.id?'selected':''}>${esc(g.name)}</option>`).join('');
}
const postStatus=p=>p.moderation_state==='TAKEN_DOWN'?'Đã gỡ do kiểm duyệt':p.withdrawn_at?'Tác giả đã gỡ':p.moderation_state==='TEMP_HIDDEN'?'Đang ẩn tạm':({DRAFT:'Bản nháp',PUBLISHED:'Đã phát hành',HIDDEN:'Đang ẩn'})[p.status]||p.status;

function moderationButtons(post) {
 const action=(label,next)=>button(label,'admin-post',post.id,next);
 if(post.status==='DRAFT')return '';
 if(post.moderation_state==='TAKEN_DOWN')return action('Gỡ chặn','REINSTATE');
 const takedown=action('Gỡ do vi phạm','TAKEDOWN');
 if(post.status==='PUBLISHED')return action('Ẩn tạm','HIDE')+takedown;
 if(post.moderation_state==='TEMP_HIDDEN'||!post.withdrawn_at)return action('Bỏ ẩn','RESTORE')+takedown;
 return takedown;
}
function postActions(p) {
 if(!['DRAFT','PUBLISHED'].includes(p.status))return '';
 return link('Sửa bài','#edit/'+encodeURIComponent(p.id))+
  button(p.status==='DRAFT'?'Xóa nháp':'Gỡ bài','remove-post',p.id,p.status);
}
function publishedEditor({post,media,genres:assigned},genres) {
 const publicMedia=media.filter(file=>!file.premium);
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
 const source=m.url||m.previewUrl;
 if(source&&m.kind==='VIDEO')view=`<video src="${esc(source)}" controls ${m.locked?'controlslist="nodownload"':''} playsinline preload="metadata"></video>`;
 else if(source&&m.kind==='IMAGE')view=`<img src="${esc(source)}" alt="${esc(m.filename)}">`;
 else if(m.locked)view='<strong>Nội dung trả phí</strong>';
 return `<div class="preview media-stage">${view}</div><div class="detail-file"><div><strong>${esc(m.filename)}</strong><span>${m.locked?(m.previewUrl?'Bản xem trước Premium':'Tệp Premium chưa mở'):m.premium?'Tệp Premium':'Tệp công khai'}</span></div>${m.url?`<a class="btn dark" href="${esc(m.url)}" download="${esc(m.filename)}">Tải bản gốc</a>`:''}</div>
 <div class="media-thumbs" role="group" aria-label="Tệp trong tác phẩm">${media.map((f,k)=>`<button type="button" class="btn light" data-media="${k}" aria-pressed="${i===k}">${kindNames[f.kind]||'Tệp'} ${k+1}${f.premium?' · Premium':''}</button>`).join('')}
 ${media.filter(f=>f.kind==='IMAGE'&&f.url).length>1?`<button type="button" class="btn light" data-action="cycle" aria-pressed="${Boolean(cycleOverrides.get(galleryPost))}">${cycleOverrides.get(galleryPost)?'Dừng tự chuyển':'Tự chuyển ảnh'}</button>`:''}</div>
  `;
}
async function detail(id) {
 const data=await api('catalog/'+encodeURIComponent(id));
 const {post,media}=data;
 const published=post.status==='PUBLISHED';
 const premiumCount=media.filter(file=>file.premium).length;
 const locked=media.some(file=>file.locked);
 const form=(name,label)=>`<form id="${name}" data-id="${esc(id)}"><input name="text" required maxlength="1000" aria-label="${label}" placeholder="${label}"><button class="btn light">Gửi</button><p role="status"></p></form>`;
 return {media,post, html:heading(post.title,post.author||'')+`<div class="detail"><section id="post-media"></section>
 <aside class="surface detail-summary"><p class="category">${esc(published?(premiumCount?'Premium':'Miễn phí'):postStatus(post))}</p>
 <h2>${esc(published?price(post):post.title)}</h2>
 <p>${media.length} tệp trong tác phẩm${premiumCount?` · ${premiumCount} tệp Premium`:''}</p>
 ${published&&locked?`<p>Một lần mua mở ${premiumCount} tệp Premium. Mua thử không thu tiền.</p><div class="detail-purchase">${button('Mua thử','test-purchase',id,post.price_vnd)}</div>`:''}
 ${premiumCount&&!locked?'<p>Chọn một tệp để tải bản gốc.</p>':''}
 ${post.description?`<p class="detail-description">${esc(post.description)}</p>`:''}
 ${data.canManage?`<div class="button-row post-actions">${data.canPublish?button('Phát hành','publish',id):''}${postActions(post)}</div>`:''}
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
  content=tab==='saved' && posts.length
   ? `<div class="grid">${posts.map(p=>`<div>${p.unavailable
     ? '<div class="surface card-body">Tác phẩm này hiện không công khai.</div>'
     : card(p)}<div class="button-row">${button('Bỏ lưu','unsave',p.id)}</div></div>`).join('')}</div>`
   : grid(posts,tab==='saved'?'Bạn chưa lưu tác phẩm nào.':'Bạn chưa mua tác phẩm nào.');
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
  posts:()=>list(data.posts,p=>`<li><a href="${postLink(p)}">${esc(p.title)}</a><span>${esc(postStatus(p))}</span>${moderationButtons(p)}</li>`,'Chưa có bài đăng.'),
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
 const [route,id]=(location.hash.slice(1)||(user?'home':'welcome')).split('/');
 clearUploadFiles();
 document.body.classList.toggle('admin-mode',route==='admin'&&user?.role==='ADMIN');
 document.body.classList.toggle('welcome-mode',route==='welcome');
 adminLink.hidden=user?.role!=='ADMIN';
 loginLink.href=user?'#account':'#login';
 loginLink.textContent=user?user.alias:'Đăng nhập';
 document.querySelectorAll('.main-nav a').forEach(a=>{
  const parent=({post:'browse',login:'account',events:'home',event:'home',collections:'more',collection:'more','collection-new':'more'})[route]||route;
  if(a.hash==='#'+parent)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 });
 const pages={home,browse:()=>{
  if(['IMAGE','VIDEO','MIXED'].includes(id))filters={...filters,kind:id,q:'',sort:'new',pay:'',days:'',offset:0,include:[],exclude:[]};
  return discover();
 },welcome,login:()=>authForm(),register:()=>authForm(true),upload:()=>upload(),edit:()=>upload(id),more,account:()=>account(id),admin:()=>admin(id),
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
     id:file.id,file:{name:file.filename,size:file.size},preview:file.url,video:file.kind==='VIDEO',premium:file.premium,previewStart:file.previewStart
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
function playCardVideo(video) {
 // Keep previews silent even when playback starts from a click.
 video.muted=true;
 video.play().catch(()=>{});
}
for(const [eventName,isEntering] of [['pointerover',true],['pointerout',false]]){
 app.addEventListener(eventName,event=>{
  if(event.pointerType!=='mouse'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const card=event.target.closest('.video-card');
  if(!card||card.contains(event.relatedTarget))return;
  const video=card.querySelector('video');
  if(isEntering)playCardVideo(video);
  else video.pause();
 });
}
for(const eventName of ['playing','pause','ended']){
 app.addEventListener(eventName,event=>{
  const control=event.target.closest('.video-card')?.querySelector('[data-video-toggle]');
  if(!control)return;
  const playing=eventName==='playing';
  control.textContent=playing?'❚❚':'▶';
  control.setAttribute('aria-label',playing?'Tạm dừng video đại diện':'Phát video đại diện');
 },true);
}
app.addEventListener('click',async event=>{
 const format=event.target.closest('[data-format]');
 const reset=event.target.closest('[data-browse-reset]');
 const topic=event.target.closest('[data-topic]');
 if(format||reset||topic){
  const form=(format||reset||topic).closest('#browse-form');
  if(reset){
   form.elements.q.value='';
   for(const select of form.querySelectorAll('select'))select.selectedIndex=0;
  }
  if(format||reset)form.elements.kind.value=format?.dataset.format||'';
  if(topic){
   const genre=form.elements.namedItem('genre:'+topic.dataset.topic);
   if(genre)genre.value=genre.value==='yes'?'':'yes';
  }
  for(const choice of form.querySelectorAll('[data-format]')){
   choice.setAttribute('aria-pressed',String(choice.dataset.format===form.elements.kind.value));
  }
  filterBrowse(form);
  return;
 }
 const quickSave=event.target.closest('[data-quick-save]');
 if(quickSave){
  if(!user){
   afterLogin='browse';
   notice('Đăng nhập để lưu tác phẩm.');
   go('login');
   return;
  }
  const id=quickSave.dataset.quickSave;
  const wasSaved=savedForBrowse.has(id);
  quickSave.disabled=true;
  try {
   await api('catalog/'+encodeURIComponent(id)+'/save',{method:wasSaved?'DELETE':'PUT'});
   if(wasSaved)savedForBrowse.delete(id);
   else savedForBrowse.add(id);
   const current=app.querySelector('[data-quick-save="'+CSS.escape(id)+'"]');
   if(current){
    current.setAttribute('aria-pressed',String(!wasSaved));
    current.textContent=wasSaved?'Lưu':'Đã lưu';
   }
   notice(wasSaved?'Đã bỏ lưu tác phẩm.':'Đã thêm vào Xem sau.');
  }catch(error){notice(error.message);}
  finally{quickSave.disabled=false;}
  return;
 }
 const videoToggle=event.target.closest('[data-video-toggle]');
 if(videoToggle){
  const video=videoToggle.closest('.video-card').querySelector('video');
  if(video.paused)playCardVideo(video);
  else video.pause();
  return;
 }
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
 if(['next','previous'].includes(action)){
  const form=app.querySelector('#browse-form');
  if(!form||app.querySelector('#browse-results').hasAttribute('aria-busy'))return;
  filters.offset+=action==='next'?25:-25;
  updateBrowse(form);
  return;
 }
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
  if(action==='admin-post'){
   let reason;
   if(next==='HIDE'||next==='TAKEDOWN'){
    const message=next==='HIDE'
     ? 'Ẩn tạm và dừng bán. Người mua cũ vẫn xem được. Nhập lý do:'
     : 'Gỡ do vi phạm sẽ chặn cả người đã mua. Nhập lý do để xác nhận:';
    reason=window.prompt(message);
    if(reason===null){control.disabled=false;return}
   }
   await json(action+'/'+id,'PUT',{action:next,reason});
   notice('Đã cập nhật kiểm duyệt.');
  }else if(action.startsWith('admin-')){
   await json(action+'/'+id,'PUT',action==='admin-genre'?{enabled:next==='true'}:{status:next});
  }
  render();
 }catch(error){notice(error.message);control.disabled=false}
});
app.addEventListener('change',event=>{
 const field=event.target;
 if(field.form?.id==='browse-form'&&field.matches('select'))filterBrowse(field.form);
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
 if(event.target.matches('[data-preview-start]')){
  const entry=uploadFiles[Number(event.target.dataset.previewStart)];
  if(entry)entry.previewStart=event.target.value;
 }
 if(event.target.name==='q'&&event.target.form?.id==='browse-form')filterBrowse(event.target.form,300);
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
 if(form.id==='home-search'){
  filters={q:String(data.get('q')||'').trim(),kind:'',sort:'new',pay:'',days:'',offset:0,include:[],exclude:[]};
  go('browse');
  return;
 }
 if(form.id==='browse-form'){
  filterBrowse(form);
  return;
 }
 const submit=form.querySelector('button[type=submit]')||form.querySelector('button'), status=form.querySelector('[role=status]');
 submit.disabled=true;
 status.textContent='Đang xử lý…';
 try {
  if(form.id==='login-form'||form.id==='register-form'){
   user=await json(form.id==='register-form'?'register':'login','POST',Object.fromEntries(data));
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
const topbar=document.querySelector('.topbar');
function updateTopbar(){topbar.classList.toggle('is-scrolled',window.scrollY>12);}
window.addEventListener('scroll',updateTopbar,{passive:true});
updateTopbar();
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0)});
api('session').then(result=>{user=result.user}).catch(()=>{}).finally(render);
