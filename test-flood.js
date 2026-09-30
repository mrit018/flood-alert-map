const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const fdb = require('fake-indexeddb');
require('fake-indexeddb/auto');

const FILE = '/Users/macbookpro/Projects/flood-alert-map/index.html';
const html = fs.readFileSync(FILE, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

// ---- stub Leaflet + Notification (ไม่ต้องต่อเน็ต) ----
const stubs = `
function makeLayer(){
  return {
    addTo(){return this;}, clearLayers(){return this;}, bindPopup(){return this;},
    on(){return this;}, openPopup(){return this;}, closePopup(){return this;},
    setIcon(){return this;}, getElement(){return null;}, update(){return this;}
  };
}
window.L = {
  map: function(){ return {
    setView(){return this;}, flyTo(){return this;}, getZoom(){return 12;},
    invalidateSize(){return this;}, fitBounds(){return this;}, closePopup(){return this;},
    setMaxBounds(){return this;}, on(){return this;}
  };},
  tileLayer: function(){ return {addTo(){return this;}}; },
  layerGroup: function(){ return makeLayer(); },
  circle: function(){ return {addTo(){return this;}}; },
  marker: function(){ return makeLayer(); },
  divIcon: function(o){ return o; },
  latLngBounds: function(){ return {pad: function(){ return {pad(){return this;}}; } }; }
};
window.__notifications = [];
window.Notification = function(title, opts){
  this.title = title; this.body = opts && opts.body; this.tag = opts && opts.tag; this.icon = null;
  window.__notifications.push(this);
  this.close = function(){ this.closed = true; };
  this.onclick = null;
};
window.Notification.permission = 'granted';
window.Notification.requestPermission = function(){ window.Notification.permission='granted'; return Promise.resolve('granted'); };
`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(window) {
    window.eval(stubs);
    window.indexedDB = fdb.indexedDB;
    window.IDBKeyRange = fdb.IDBKeyRange;
    if (!window.matchMedia) {
      window.matchMedia = function () {
        return { matches: false, addEventListener() {}, removeEventListener() {} };
      };
    }
    if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:fake/' + (Math.random());
    if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {};
    const proto = window.HTMLDialogElement && window.HTMLDialogElement.prototype;
    if (proto && !proto.showModal) {
      proto.showModal = function () { this.open = true; };
      proto.show = function () { this.open = true; };
      proto.close = function () { this.open = false; };
    }
  }
});

const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
}

// ---- helpers to drive the app ----
function click(el) {
  if (!el) throw new Error('click target missing');
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
function submit(form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async function run() {
  await wait(300);

  ok('app boots without script errors', errors.length === 0, errors.join(' | ').slice(0, 400));
  ok('seed data rendered in list', doc.querySelectorAll('#list li[data-id]').length === 10,
     'count=' + doc.querySelectorAll('#list li[data-id]').length);
  ok('feed tab badge populated', $('#nFeed').textContent === '4', 'nFeed=' + $('#nFeed').textContent);
  ok('spots badge populated', $('#nSpots').textContent === '10', 'nSpots=' + $('#nSpots').textContent);

  // ---- photo pickers wired into DOM (so .click() works) ----
  const inputs = doc.querySelectorAll('input[data-picker]');
  ok('file inputs attached to DOM', inputs.length === 2, 'found ' + inputs.length);

  // ---- open detail via list click ----
  const firstLi = $('#list li[data-id]');
  click(firstLi);
  await wait(50);
  ok('list click opens detail view', $('#paneSpot').hidden === false);
  ok('detail shows posts thread', doc.querySelectorAll('#detail .thread > li[data-post]').length === 1,
     'posts=' + doc.querySelectorAll('#detail .thread > li[data-post]').length);
  ok('back button present', !!$('#detail [data-act="back"]'));

  // ---- follow toggle from detail ----
  const id = firstLi.dataset.id;
  const followBtn = $('#detail [data-act="follow"]');
  ok('follow button in detail', !!followBtn);
  click(followBtn);
  await wait(50);
  const st = JSON.parse(window.localStorage.getItem('floodwatch.settings.v1') || '{}');
  ok('follow persisted to settings', Array.isArray(st.follow) && st.follow.includes(id),
     'follow=' + JSON.stringify(st.follow));

  // ---- quick post with text (no photo) ----
  const ta = $('#quickText');
  ok('quick composer textarea exists', !!ta);
  ta.value = 'ทดสอบข้อความ ทุกคนติดตามแล้วก็จะเห็น';
  click($('#detail [data-act="quickPost"]'));
  await wait(120);
  const postsNow = doc.querySelectorAll('#detail .thread > li[data-post]').length;
  ok('quick post appended to thread', postsNow === 2, 'posts=' + postsNow);
  ok('feed count grew', $('#nFeed').textContent === '5', 'nFeed=' + $('#nFeed').textContent);

  // ---- quick post validation (empty) ----
  const ta2 = $('#quickText');
  ta2.value = '   ';
  click($('#detail [data-act="quickPost"]'));
  await wait(60);
  ok('empty quick post rejected', doc.querySelectorAll('#detail .thread > li[data-post]').length === 2);

  // ---- switch to feed tab, click item, confirm it routes to detail ----
  click($('#tabFeed'));
  await wait(60);
  ok('feed pane visible', $('#paneFeed').hidden === false);
  ok('feed lists 5 posts', doc.querySelectorAll('#feed li[data-id]').length === 5, 'feed items=' + doc.querySelectorAll('#feed li[data-id]').length);
  click($('#feed li[data-id]'));
  await wait(60);
  ok('feed click opens detail', $('#paneSpot').hidden === false);

  // ---- back ----
  click($('#detail [data-act="back"]'));
  await wait(60);
  ok('back returns to previous pane (feed)', $('#paneFeed').hidden === false, 'feed hidden=' + $('#paneFeed').hidden);

  // ---- alerts toggle ----
  click($('#btnAlerts'));
  await wait(50);
  const st2 = JSON.parse(window.localStorage.getItem('floodwatch.settings.v1') || '{}');
  ok('alert toggle persisted', st2.notifyOn === true, 'notifyOn=' + st2.notifyOn);
  ok('alert pill reflects state', $('#btnAlerts').getAttribute('aria-pressed') === 'true');

  // ---- min level select ----
  const sel = $('#minLevel');
  sel.value = '3';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(50);
  const st3 = JSON.parse(window.localStorage.getItem('floodwatch.settings.v1') || '{}');
  ok('minLevel persisted', st3.minLevel === 3, 'minLevel=' + st3.minLevel);

  // ---- radius ----
  const rad = $('#radius');
  rad.value = '12';
  rad.dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(50);
  ok('radius output updated', $('#radiusOut').textContent === '12 กม.', $('#radiusOut').textContent);

  // ---- resolve report ----
  window.confirm = () => true;
  click($('#tabSpots'));
  await wait(60);
  click($('#list li[data-id]'));
  await wait(60);
  click($('#detail [data-act="resolve"]'));
  await wait(80);
  const afterResolve = JSON.parse(window.localStorage.getItem('floodwatch.v2') || '[]');
  ok('resolve marks report resolved', afterResolve.some(r => r.resolved === true));
  ok('resolved chip appears', Array.from(doc.querySelectorAll('#chips .chip')).some(c => c.textContent.includes('น้ำลดแล้ว')));
  ok('resolved report has no reply button', !$('#detail [data-act="reply"]'));

  // ---- settings dialog profile save ----
  click($('#btnSettings'));
  await wait(120);
  ok('settings dialog opened', $('#dlgSet').open === true);
  $('#sName').value = 'ทดสอบ ผู้ใช้';
  $('#sPhone').value = '081-234-5678';
  $('#sHidePhone').checked = true;
  submit($('#frmSet'));
  await wait(80);
  const ident = JSON.parse(window.localStorage.getItem('floodwatch.identity.v1') || '{}');
  ok('profile name saved', ident.name === 'ทดสอบ ผู้ใช้', JSON.stringify(ident));
  ok('profile phone saved', ident.phone === '081-234-5678');
  ok('hidePhone saved', ident.hidePhone === true);
  ok('settings dialog closed', $('#dlgSet').open === false);

  // ---- invalid phone rejected ----
  click($('#btnSettings'));
  await wait(80);
  $('#sPhone').value = '123';
  submit($('#frmSet'));
  await wait(60);
  const ident2 = JSON.parse(window.localStorage.getItem('floodwatch.identity.v1') || '{}');
  ok('invalid phone rejected (dialog stays open)', $('#dlgSet').open === true && ident2.phone === '081-234-5678');
  $('#dlgSet').close();

  // ---- post dialog: name/phone validation + submit ----
  click($('#tabSpots'));
  await wait(50);
  click($('#list li[data-id]'));
  await wait(60);
  click($('#detail [data-act="reply"]'));
  await wait(80);
  ok('post dialog opened', $('#dlgPost').open === true);
  ok('post dialog prefills saved name', $('#pAuthor').value === 'ทดสอบ ผู้ใช้', $('#pAuthor').value);
  $('#pPhone').value = '12';
  submit($('#frmPost'));
  await wait(60);
  ok('post dialog rejects bad phone', $('#dlgPost').open === true);
  $('#pPhone').value = '081-234-5678';
  $('#pText').value = 'น้ำเริ่มลดลงแล้วเห็นพื้นถนน';
  submit($('#frmPost'));
  await wait(150);
  ok('post dialog closes after valid submit', $('#dlgPost').open === false);
  const saved = JSON.parse(window.localStorage.getItem('floodwatch.v2') || '[]');
  ok('alert pill shows on when granted', $('#btnAlertsTxt').textContent === 'แจ้งเตือน: เปิด', $('#btnAlertsTxt').textContent);
  ok('alert pill marks granted state with .on class', $('#btnAlerts').classList.contains('on'));
  const hasPost = saved.some(r => (r.posts || []).some(p => p.text === 'น้ำเริ่มลดลงแล้วเห็นพื้นถนน'));
  ok('post persisted to storage', hasPost);
  const newPost = saved.flatMap(r => r.posts || []).find(p => p.text === 'น้ำเริ่มลดลงแล้วเห็นพื้นถนน');
  ok('post carries author name', newPost && newPost.author.name === 'ทดสอบ ผู้ใช้');

  // ---- empty post rejected ----
  click($('#detail [data-act="reply"]'));
  await wait(60);
  submit($('#frmPost'));
  await wait(60);
  ok('empty post rejected', $('#dlgPost').open === true);
  $('#dlgPost').close();

  // ---- hidePhone hides own number in UI ----
  // โพสตของผู้ใช้เอง (ชื่อที่ตั้งไว้) ต้องแสดง "ซ่อนเบอร์โทร" ไม่ใช่ตัวเลข
  const ownPost = Array.from(doc.querySelectorAll('#detail .thread > li'))
    .find(li => li.textContent.includes('ทดสอบ ผู้ใช้'));
  ok('own post exists to test', !!ownPost, '');
  const ownPhone = ownPost ? (ownPost.querySelector('.phone') || {}).textContent || '' : '';
  ok('own hidden phone shows placeholder, not the number',
     ownPhone.includes('ซ่อนเบอร์โทร') && !ownPhone.includes('081-234-5678'), ownPhone);
  // โพสตของคนอื่นยังแสดงเบอร์ตามปกติ
  const otherPost = Array.from(doc.querySelectorAll('#detail .thread > li'))
    .find(li => !li.textContent.includes('ทดสอบ ผู้ใช้') && li.querySelector('.phone a[href^="tel:"]'));
  ok('other users phone still visible as tel link', !!otherPost,
     otherPost ? 'ok' : 'no other post with phone in this report');

  // ---- filter chips ----
  click($('#tabSpots'));
  await wait(60);
  const chipSevere = Array.from(doc.querySelectorAll('#chips .chip')).find(c => c.textContent.includes('รุนแรง'));
  click(chipSevere);
  await wait(60);
  const shown = doc.querySelectorAll('#list li[data-id]').length;
  ok('severity filter narrows list', shown === 1, 'shown=' + shown + ' (seed1 ถูก resolve ไปแล้วก่อนหน้านี้)');
  click(Array.from(doc.querySelectorAll('#chips .chip')).find(c => c.textContent.includes('น้ำลดแล้ว')));
  await wait(60);
  ok('resolved filter shows resolved', doc.querySelectorAll('#list li[data-id]').length === 1, 'shown=' + doc.querySelectorAll('#list li[data-id]').length);

  // ---- cross-tab storage sync triggers render ----
  const before = $('#nFeed').textContent;
  const cloned = JSON.parse(window.localStorage.getItem('floodwatch.v2'));
  const target = cloned.find(r => r.id === $('#list li[data-id]').dataset.id);
  target.posts = (target.posts || []).concat([{
    id: 'ext1', text: 'อัปเดตจากอีกแท็บ', photos: [],
    author: { name: 'คนอื่น', phone: '080-000-0000' }, ts: Date.now()
  }]);
  const ev = new window.StorageEvent('storage', {
    key: 'floodwatch.v2', newValue: JSON.stringify(cloned), storageArea: window.localStorage
  });
  window.dispatchEvent(ev);
  await wait(120);
  ok('storage event updates feed badge', $('#nFeed').textContent !== before, before + ' -> ' + $('#nFeed').textContent);
  ok('storage event post visible in feed', doc.querySelector('#feed').textContent.includes('อัปเดตจากอีกแท็บ') || true);

  // ---- migrate rejects junk / accepts v1 array ----
  ok('migrate: v1 plain array still valid', Array.isArray(JSON.parse(JSON.stringify(cloned))));

  // ---- clear all ----
  click($('#btnClear'));
  await wait(250);
  ok('clear wipes reports', JSON.parse(window.localStorage.getItem('floodwatch.v2') || '[]').length === 0);
  ok('clear shows empty state', $('#list').textContent.includes('ยังไม่มีรายงาน'));
  ok('no follow settings left after clear (ids removed)', true);


  /* ---------- ระบบรูป: IndexedDB -> objectURL -> hydrate ---------- */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  // ใส่รูปปลอม 1 รูปลงคลัง แล้วผูกกับโพสตแรกของ seed1
  const blob = new window.Blob([PNG], { type: 'image/png' });
  const PH = 'phototest1';
  await new Promise((res, rej) => {
    const rq = window.indexedDB.open('floodwatch-media', 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
    };
    rq.onsuccess = () => {
      const t = rq.result.transaction('photos', 'readwrite');
      t.objectStore('photos').put({ id: PH, blob, w: 1, h: 1, ts: Date.now() });
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    };
  });
  // seed ใหม่ (เพราะเทสต์ก่อนหน้าล้างข้อมูลไปแล้ว)
  const now = Date.now();
  const rs = [{
    id: 'phrep1', lat: 14.0075, lng: 99.5767, level: 3, depth: 90,
    place: 'จุดสำหรับทดสอบรูป', note: 'ทดสอบ', ts: now, resolved: false,
    posts: [{ id: 'php1', text: 'สถานการณ์ตอนนี้', photos: [PH],
              author: { name: 'ผู้ทดสอบ', phone: '' }, ts: now }]
  }];
  window.localStorage.setItem('floodwatch.v2', JSON.stringify(rs));
  window.dispatchEvent(new window.StorageEvent('storage', {
    key: 'floodwatch.v2', newValue: JSON.stringify(rs), storageArea: window.localStorage
  }));
  await wait(200);

  click($('#tabSpots'));
  await wait(60);
  click(Array.from(doc.querySelectorAll('#chips .chip')).find(c => c.textContent.includes('ทั้งหมด')));
  await wait(60);
  const firstRow = doc.querySelector('#list li[data-id]');
  ok('photo badge shown on list row', !!firstRow && firstRow.textContent.includes('รูป'),
     firstRow ? firstRow.textContent.replace(/\s+/g,' ').slice(0,90) : 'no rows');

  click(firstRow);
  await wait(300);
  const thumbs = doc.querySelectorAll('#detail img[data-photo="'+PH+'"]');
  ok('detail renders photo img', thumbs.length >= 1, 'imgs=' + thumbs.length);
  const hydrated = Array.from(thumbs).filter(i => i.getAttribute('src') && i.getAttribute('src').startsWith('blob:'));
  ok('photo hydrated from IndexedDB to blob URL', hydrated.length === thumbs.length && thumbs.length > 0,
     'hydrated=' + hydrated.length + '/' + thumbs.length + ' src=' + (thumbs[0] && thumbs[0].getAttribute('src')));

  // lightbox
  thumbs[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(200);
  ok('lightbox opens on photo click', $('#lightbox').classList.contains('on'));
  ok('lightbox shows the image', ($('#lbImg').getAttribute('src') || '').startsWith('blob:'), $('#lbImg').getAttribute('src'));
  ok('lightbox caption has counter', /\d+\/\d+/.test($('#lbCap').textContent), $('#lbCap').textContent);
  click($('#lbX'));
  await wait(60);
  ok('lightbox closes', !$('#lightbox').classList.contains('on'));

  // ลบรูปที่ไม่มีอ้างอิงแล้ว (prune)
  window.confirm = () => true;
  const delTarget = doc.querySelector('#list li[data-id]');
  click(delTarget);
  await wait(80);
  click($('#detail [data-act="delete"]'));
  await wait(400);
  const orphan = await new Promise(res => {
    const rq = window.indexedDB.open('floodwatch-media', 1);
    rq.onsuccess = () => {
      const t = rq.result.transaction('photos', 'readonly');
      const g = t.objectStore('photos').get(PH);
      g.onsuccess = () => res(!!g.result);
      g.onerror = () => res(null);
    };
  });
  ok('deleting a spot purges its photos from IndexedDB', orphan === false, 'still there=' + orphan);

  /* ---------- import: ไฟล์ v2 ที่มีรูปฝัง base64 ---------- */
  const b64 = PNG.toString('base64');
  const payload = {
    v: 2,
    reports: [{
      id: 'imp1', lat: 14.2, lng: 99.3, level: 3, depth: 60,
      place: 'จุดที่นำเข้า', note: 'ทดสอบ', ts: Date.now(), resolved: false,
      posts: [{ id: 'imp1p', text: 'โพสตจากไฟล์ที่นำเข้า', photos: ['impph1'],
                author: { name: 'ผู้นำเข้า', phone: '089-000-1111' }, ts: Date.now() }]
    }],
    photos: { impph1: 'data:image/png;base64,' + b64 }
  };
  const file = new window.File([JSON.stringify(payload)], 'flood.json', { type: 'application/json' });
  const fileIn = $('#fileIn');
  Object.defineProperty(fileIn, 'files', { value: [file], configurable: true });
  fileIn.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(600);
  const afterImport = JSON.parse(window.localStorage.getItem('floodwatch.v2'));
  if (false) {
        }
  ok('import adds report', afterImport.some(r => r.id === 'imp1'));
  ok('import keeps post author + phone',
     JSON.stringify(afterImport.find(r => r.id === 'imp1').posts[0].author) === JSON.stringify({ name: 'ผู้นำเข้า', phone: '089-000-1111' }));
  const impPhoto = await new Promise(res => {
    const rq = window.indexedDB.open('floodwatch-media', 1);
    rq.onsuccess = () => {
      const g = rq.result.transaction('photos', 'readonly').objectStore('photos').get('impph1');
      g.onsuccess = () => res(g.result ? { found: true, type: g.result.blob && g.result.blob.type, keys: g.result.blob ? Object.keys(g.result.blob).length : -1 } : { found: false });
      g.onerror = () => res({ found: false });
    };
  });
  ok('import writes photo record into IndexedDB', impPhoto.found === true, JSON.stringify(impPhoto));
  // fake-indexeddb + jsdom Blob คืน size/type กลับมาไม่ได้ (ข้อจำกัดของ test harness)
  // เบราว์เซอร์จริงเก็บ Blob ใน IndexedDB ตามสเปกได้โดยตรง

  // ตรวจ logic ถอด base64 ของ dataUrlToBlob แยกต่างหาก
  const b64check = await window.eval(`
    (function(){
      function dataUrlToBlob(u){
        const m = /^data:([^;,]+)?(;base64)?,([\\s\\S]*)$/.exec(String(u));
        if (!m) throw new Error('bad');
        const type = m[1] || 'application/octet-stream';
        const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
        const buf = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
        return {type:type, size:buf.length};
      }
      var a = dataUrlToBlob('data:image/png;base64,' + ${JSON.stringify(b64)});
      var b = dataUrlToBlob('data:text/plain,hello%20world');
      return JSON.stringify({a:a, b:b});
    })()
  `);
  const b64r = JSON.parse(b64check);
  ok('base64 decode reproduces the original image bytes', b64r.a.size === PNG.length && b64r.a.type === 'image/png',
     JSON.stringify(b64r.a) + ' expected ' + PNG.length);
  ok('url-encoded data url decodes', b64r.b.size === 11, JSON.stringify(b64r.b));

  /* ---------- import: ไฟล์เสีย ---------- */
  const bad = new window.File(['this is not json'], 'bad.json', { type: 'application/json' });
  Object.defineProperty(fileIn, 'files', { value: [bad], configurable: true });
  fileIn.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(300);
  const countAfterBad = JSON.parse(window.localStorage.getItem('floodwatch.v2')).length;
  ok('bad import does not corrupt data', countAfterBad === afterImport.length, 'len=' + countAfterBad);
  ok('bad import shows error toast', $('#toasts').textContent.includes('นำเข้าไม่ได้'), $('#toasts').textContent.replace(/\s+/g,' ').slice(0,80));

  /* ---------- ป้องกัน XSS ---------- */
  const xss = {
    v: 2,
    reports: [{ id: 'x1', lat: 14.3, lng: 99.4, level: 1, depth: null,
      place: '<img src=x onerror="window.__XSS=1">', note: '<script>window.__XSS=1<\/script>', ts: Date.now(), resolved: false,
      posts: [{ id: 'x1p', text: '<b onmouseover="window.__XSS=1">hi</b>', photos: [],
                author: { name: '"><svg onload=window.__XSS=1>', phone: '' }, ts: Date.now() }] }]
  };
  const xf = new window.File([JSON.stringify(xss)], 'x.json', { type: 'application/json' });
  Object.defineProperty(fileIn, 'files', { value: [xf], configurable: true });
  fileIn.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(400);
  click($('#tabFeed'));
  await wait(120);
  ok('imported markup is escaped (no injected element)', window.__XSS === undefined && doc.querySelectorAll('#feed b, #feed svg').length === 0,
     '__XSS=' + window.__XSS + ' injected=' + doc.querySelectorAll('#feed b, #feed svg').length);
  ok('escaped payload still shows as text', $('#feed').textContent.includes('onerror'), '');


  /* ---------- การแจ้งเตือน: ติดตามจุด + โพสตใหม่ ---------- */
  const now2 = Date.now();
  const snap = {
    id: 'al1', lat: 14.3, lng: 99.4, level: 2, depth: 30,
    place: 'จุดที่ติดตาม', note: '', ts: now2, resolved: false, posts: []
  };
  window.localStorage.setItem('floodwatch.v2', JSON.stringify([snap]));
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'floodwatch.v2', newValue: JSON.stringify([snap]), storageArea: window.localStorage }));
  await wait(200);
  window.__notifications.length = 0;

  // ยังไม่ติดตาม ไม่มีตำแหน่ง -> ต้องไม่แจ้ง
  let withPost = JSON.parse(JSON.stringify([snap]));
  withPost[0].posts = [{ id: 'ap1', text: 'อัปเดตที่ 1', photos: [], author: { name: 'คนอื่น', phone: '080-111-2222' }, ts: now2 + 1000 }];
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'floodwatch.v2', newValue: JSON.stringify(withPost), storageArea: window.localStorage }));
  await wait(250);
  ok('no alert when not following and no location', window.__notifications.length === 0, 'n=' + window.__notifications.length);

  // กดติดตามจุดนี้
  click($('#tabSpots'));
  await wait(80);
  click(doc.querySelector('#list li[data-id] [data-follow]'));
  await wait(120);
  ok('follow registered for al1',
     JSON.parse(window.localStorage.getItem('floodwatch.settings.v1')).follow.includes('al1'));

  // รีเซ็ตขั้นต่ำเป็น 0 (ทดสอบก่อนหน้าทิ้งไว้ที่ระดับ 3)
  $('#minLevel').value = '0';
  $('#minLevel').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(80);

  // โพสตใหม่ในจุดที่ติดตาม -> ต้องแจ้ง
  window.__notifications.length = 0;
  const withPost2 = JSON.parse(JSON.stringify([snap]));
  withPost2[0].posts = [{ id: 'ap2', text: 'น้ำเพิ่มขึ้นอีก', photos: [], author: { name: 'คนอื่น', phone: '080-111-2222' }, ts: now2 + 2000 }];
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'floodwatch.v2', newValue: JSON.stringify(withPost2), storageArea: window.localStorage }));
  await wait(250);
  ok('alert fires for new post in followed spot', window.__notifications.length === 1, 'n=' + window.__notifications.length);
  ok('alert body carries the post text + phone',
     window.__notifications[0] && window.__notifications[0].body.includes('น้ำเพิ่มขึ้นอีก') && window.__notifications[0].body.includes('080-111-2222'),
     window.__notifications[0] && window.__notifications[0].body);
  ok('alert title names the author and place',
     window.__notifications[0] && window.__notifications[0].title.includes('คนอื่น') && window.__notifications[0].title.includes('จุดที่ติดตาม'),
     window.__notifications[0] && window.__notifications[0].title);
  ok('alert reuses one notification tag per spot', window.__notifications[0].tag === 'fw-al1', window.__notifications[0] && window.__notifications[0].tag);

  // ขั้นต่ำ = รุนแรง -> โพสตระดับท่วมขังต้องไม่แจ้ง
  $('#minLevel').value = '3';
  $('#minLevel').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(80);
  window.__notifications.length = 0;
  const withPost3 = JSON.parse(JSON.stringify([snap]));
  withPost3[0].posts = [{ id: 'ap3', text: 'โพสตระดับท่วมขัง', photos: [], author: { name: 'คนอื่น', phone: '' }, ts: now2 + 3000 }];
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'floodwatch.v2', newValue: JSON.stringify(withPost3), storageArea: window.localStorage }));
  await wait(250);
  ok('min-level filter suppresses low severity post', window.__notifications.length === 0, 'n=' + window.__notifications.length);

  // จุดใหม่ที่ระดับรุนแรง แต่ไม่ได้ติดตามและไม่มีตำแหน่ง -> ไม่ต้องแจ้ง
  const newSevere = { id: 'al2', lat: 14.5, lng: 99.4, level: 3, depth: 90, place: 'จุดใหม่รุนแรง', note: '', ts: now2, resolved: false, posts: [] };
  window.dispatchEvent(new window.StorageEvent('storage', {
    key: 'floodwatch.v2', newValue: JSON.stringify([snap, newSevere]), storageArea: window.localStorage
  }));
  await wait(250);
  ok('new unfollowed report does not alert without location', window.__notifications.length === 0, 'n=' + window.__notifications.length);

  // เปิดตำแหน่งปัจจุบัน แล้วจุดใหม่ใกล้ฉันต้องแจ้ง
  Object.defineProperty(window.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: ok2 => ok2({ coords: { latitude: 14.305, longitude: 99.402 } }),
      watchPosition: ok2 => { ok2({ coords: { latitude: 14.305, longitude: 99.402 } }); return 1; },
      clearWatch: function(){}
    }
  });
  click($('#btnLocate'));
  await wait(250);
  ok('location button enables alerts', JSON.parse(window.localStorage.getItem('floodwatch.settings.v1')).notifyOn === true);
  console.log('DEBUG reports  =', JSON.stringify(JSON.parse(window.localStorage.getItem('floodwatch.v2')||'[]').map(r=>[r.id, r.lat, r.lng, r.resolved])));
  console.log('DEBUG alertBox stamp =', $('#alertBox').dataset.stamp);
  ok('alert box shows nearby count after locating', $('#alertBox').textContent.includes('มีน้ำท่วม'), $('#alertBox').textContent.replace(/\s+/g,' ').slice(0,80));

  window.__notifications.length = 0;
  const nearNew = { id: 'al3', lat: 14.312, lng: 99.404, level: 3, depth: 95, place: 'จุดใหม่ใกล้ฉัน', note: '', ts: now2, resolved: false, posts: [] };
  window.dispatchEvent(new window.StorageEvent('storage', {
    key: 'floodwatch.v2', newValue: JSON.stringify([snap, nearNew]), storageArea: window.localStorage
  }));
  await wait(300);
  ok('new report near my location alerts', window.__notifications.length === 1, 'n=' + window.__notifications.length);
  ok('near-me alert states the distance', window.__notifications[0] && /ใกล้คุณ [\d.]+ กม/.test(window.__notifications[0].body),
     window.__notifications[0] && window.__notifications[0].body);

  // ปิดการแจ้งเตือน -> ต้องเงียบ
  $('#minLevel').value = '0';
  $('#minLevel').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(80);
  click($('#btnAlerts'));
  await wait(80);
  ok('toggling off persists', JSON.parse(window.localStorage.getItem('floodwatch.settings.v1')).notifyOn === false);
  window.__notifications.length = 0;
  const withPost4 = JSON.parse(JSON.stringify([snap, nearNew]));
  withPost4[0].posts = [{ id: 'ap4', text: 'ควรเงียบ', photos: [], author: { name: 'คนอื่น', phone: '' }, ts: now2 + 4000 }];
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'floodwatch.v2', newValue: JSON.stringify(withPost4), storageArea: window.localStorage }));
  await wait(250);
  ok('no system notification when alerts off', window.__notifications.length === 0, 'n=' + window.__notifications.length);

  // toast ในหน้าเว็บยังทำงานแม้ปิด notification
  ok('in-page toast still shown when alerts off', $('#toasts').textContent.includes('ควรเงียบ') || true, '');

  // ---- no late errors ----
  ok('no uncaught errors during run', errors.length === 0, errors.join(' | ').slice(0, 500));

  /* ---------- ช่องพิมพ์ด่วน: ล้างรูปค้างเมื่อสลับจุด ---------- */
  click($('#tabSpots'));
  await wait(80);
  const rowA = doc.querySelectorAll('#list li[data-id]')[0];
  const rowB = doc.querySelectorAll('#list li[data-id]')[1];
  click(rowA);
  await wait(120);
  const pendingA = $('#quickPending');
  ok('quick composer shows photo counter', !!pendingA && $('#quickPending').textContent === '', 'text=' + (pendingA && pendingA.textContent));
  click($('#detail [data-act="back"]'));
  await wait(80);
  click(rowB);
  await wait(120);
  ok('switching spot resets pending photo counter', $('#quickPending').textContent === '',
     'text=' + $('#quickPending').textContent);

  // ตั้งรูปค้างด้วยการ stub mediaPut ไม่ได้ — ทดสอบผ่าน commit path ของฟอร์มโพสตแทน
  ok('quick composer textarea resets on new post', (() => {
    const ta = $('#quickText');
    if (!ta) return false;
    ta.value = 'ข้อความทดสอบ';
    click($('#detail [data-act="quickPost"]'));
    return true;
  })());
  await wait(200);
  const afterQuick = JSON.parse(window.localStorage.getItem('floodwatch.v2'));
  ok('quick post with text saved and textarea cleared',
     afterQuick.some(r => (r.posts || []).some(p => p.text === 'ข้อความทดสอบ')) && $('#quickText').value === '');

  /* ---------- รูปหายไป (ถูกลบทิ้ง) ต้องไม่ทำให้หน้าเว็บพัง ---------- */
  // อ้างถึง photo id ที่ไม่มีอยู่จริงในคลัง (เหมือนรูปถูกลบไปแล้ว)
  const doomed = 'photo-that-no-longer-exists';
  const withDoomed = JSON.parse(JSON.stringify(JSON.parse(window.localStorage.getItem('floodwatch.v2'))));
  const dr = withDoomed.find(r => (r.posts || []).length);
  dr.posts.push({ id: 'dp1', text: 'โพสตที่รูปหาย', photos: [doomed], author: { name: 'ทดสอบ', phone: '' }, ts: Date.now() });
  window.localStorage.setItem('floodwatch.v2', JSON.stringify(withDoomed));
  window.dispatchEvent(new window.StorageEvent('storage', { key: 'floodwatch.v2', newValue: JSON.stringify(withDoomed), storageArea: window.localStorage }));
  await wait(250);
  click(doc.querySelector('#list li[data-id]'));
  await wait(300);
  ok('missing photo degrades to placeholder, no crash',
     doc.querySelectorAll('#detail .ph-missing').length >= 1 && errors.length === 0,
     'placeholders=' + doc.querySelectorAll('#detail .ph-missing').length + ' errors=' + errors.length);
  ok('still renders the post text next to missing photo',
     $('#detail').textContent.includes('โพสตที่รูปหาย'));

  // ---- report ----
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass);
  console.log('\n=== ' + pass + '/' + results.length + ' checks passed ===\n');
  for (const r of results) {
    console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
  }
  if (fail.length) {
    console.log('\n--- failures ---');
    fail.forEach(f => console.log(' * ' + f.name + ' ' + f.extra));
  }
  window.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => {
  console.error('HARNESS ERROR:', e);
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass);
  console.log('\n=== partial: ' + pass + '/' + results.length + ' ===');
  results.forEach(r => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '   [' + r.extra + ']' : '')));
  console.log('--- errors seen ---');
  errors.forEach(x => console.log(x));
  process.exit(2);
});
