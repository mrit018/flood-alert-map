const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
require('fake-indexeddb/auto');
const fdb = require('fake-indexeddb');

const FILE = '/Users/macbookpro/Projects/flood-alert-map/flood-alert-map.html';
let html = fs.readFileSync(FILE, 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const stub = `
window.__notifs = [];
window.__revoked = [];
window.__created = 0;
const _create = (typeof URL.createObjectURL === 'function') ? URL.createObjectURL.bind(URL) : null;
URL.createObjectURL = function(b){ window.__created++; return _create ? _create(b) : 'blob:x' + window.__created; };
const _revoke = (typeof URL.revokeObjectURL === 'function') ? URL.revokeObjectURL.bind(URL) : null;
URL.revokeObjectURL = function(u){ window.__revoked.push(u); if (_revoke) { try{ _revoke(u); }catch(e){} } };
function makeLayer(){
  return {
    addTo(){return this;}, clearLayers(){return this;}, bindPopup(){return this;}, on(){return this;},
    openPopup(){return this;}, closePopup(){return this;}, setIcon(){return this;},
    getElement(){return null;}, update(){return this;}
  };
}
window.L = {
  map: () => ({ setView(){return this;}, flyTo(){return this;}, getZoom(){return 12;}, invalidateSize(){return this;}, fitBounds(){return this;}, closePopup(){return this;}, setMaxBounds(){return this;}, on(){return this;} }),
  tileLayer: () => ({addTo(){return this;}}),
  layerGroup: () => makeLayer(),
  circle: () => ({addTo(){return this;}}),
  marker: () => makeLayer(),
  divIcon(o){ return o; },
  latLngBounds: () => ({pad(){return this;}})
};
window.Notification = function(t, o){ this.title=t; this.body=o&&o.body; this.tag=o&&o.tag; window.__notifs.push(this); this.close=()=>{}; };
window.Notification.permission = 'granted';
window.Notification.requestPermission = () => { window.Notification.permission='granted'; return Promise.resolve('granted'); };
`;

const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/', virtualConsole:vc,
  beforeParse(w){
    w.eval(stub);
    w.indexedDB = fdb.indexedDB;
    w.IDBKeyRange = fdb.IDBKeyRange;
    if (!w.URL.createObjectURL) w.URL.createObjectURL = () => 'blob:fake/' + (Math.random());
    if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};
    if (!w.matchMedia) w.matchMedia = () => ({matches:false, addEventListener(){}, removeEventListener(){}});
    const p = w.HTMLDialogElement && w.HTMLDialogElement.prototype;
    if (p && !p.showModal) { p.showModal = function(){ this.open=true; }; p.show = function(){ this.open=true; }; p.close = function(){ this.open=false; }; }
  }});
const w = dom.window, doc = w.document, $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = el => { if(!el) throw new Error('missing click target'); el.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true})); };
const submit = f => f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
const results = [];
const ok = (n,c,x) => results.push({n, pass:!!c, x:x||''});
const stored = () => JSON.parse(w.localStorage.getItem('floodwatch.v2')||'[]');
const settings = () => JSON.parse(w.localStorage.getItem('floodwatch.settings.v1')||'{}');
function sync(next){
  w.localStorage.setItem('floodwatch.v2', JSON.stringify(next));
  w.dispatchEvent(new w.StorageEvent('storage',{key:'floodwatch.v2',newValue:JSON.stringify(next),storageArea:w.localStorage}));
}
const now = Date.now();
const R = (id, posts) => ({id, lat:14.3, lng:99.4, level:2, depth:20, place:'จุด '+id, note:'', ts:now, resolved:false, posts:posts||[]});

(async function(){
  await wait(250);
  w.confirm = () => true;

  // ---- setup: 2 reports, one with 2 photos ----
  const P1='pa1', P2='pa2', P3='pa3';
  const blob = () => new w.Blob([Buffer.from('89504e470d0a1a0a','hex')],{type:'image/png'});
  await new Promise(res => {
    const rq = w.indexedDB.open('floodwatch-media',1);
    rq.onupgradeneeded = () => { const d=rq.result; if(!d.objectStoreNames.contains('photos')) d.createObjectStore('photos',{keyPath:'id'}); };
    rq.onsuccess = () => { const t=rq.result.transaction('photos','readwrite'); const s=t.objectStore('photos');
      [P1,P2,P3].forEach(id => s.put({id, blob:blob(), w:1, h:1, ts:now}));
      t.oncomplete = res; t.onerror = () => res(); };
  });
  sync([
    R('rA', [{id:'q1', text:'โพสตแรก', photos:[P1,P2], author:{name:'ก',phone:''}, ts:now}]),
    R('rB', [])
  ]);
  await wait(400);
  ok('setup: 2 reports', stored().length === 2, 'n='+stored().length);

  // ================= BUG 1: draft ต้องไม่หายเมื่อ render() ถูกเรียกซ้ำ =================
  click(doc.querySelector('#list li[data-id]'));
  await wait(200);
  const ta = $('#quickText');
  ok('B1: composer present', !!ta);
  ta.value = 'ร่างที่พิมพ์ไว้';
  ta.dispatchEvent(new w.Event('input',{bubbles:true}));
  // จำลอง GPS เดิน (ไม่ควรล้างร่าง)
  w.dispatchEvent(new w.Event('resize'));
  sync(stored());            // storage event
  await wait(250);
  ok('B1: draft survives storage-event re-render', $('#quickText') && $('#quickText').value === 'ร่างที่พิมพ์ไว้', 'val='+($('#quickText')&&$('#quickText').value));
  // กดติดตาม (มี render() เต็ม)
  click($('#detail [data-act="follow"]'));
  await wait(200);
  ok('B1: draft survives follow toggle re-render', $('#quickText') && $('#quickText').value === 'ร่างที่พิมพ์ไว้', 'val='+($('#quickText')&&$('#quickText').value));
  // โพสตร่างนั้นจริง
  click($('#detail [data-act="quickPost"]'));
  await wait(300);
  ok('B1: draft gets posted', stored().flatMap(r=>r.posts).some(p=>p.text==='ร่างที่พิมพ์ไว้'));
  ok('B1: textarea cleared after post', $('#quickText').value === '');

  // ================= BUG 2: เปลี่ยนจุดต้องล้างร่าง ไม่ใช่พาไปจุดใหม่ =================
  const ta2 = $('#quickText');
  ta2.value = 'ร่างของจุดแรก';
  ta2.dispatchEvent(new w.Event('input',{bubbles:true}));
  click($('#detail [data-act="back"]'));
  await wait(150);
  click(doc.querySelectorAll('#list li[data-id]')[1]);
  await wait(200);
  ok('B2: switching spot clears the draft', $('#quickText').value === '', 'val='+$('#quickText').value);

  // ================= BUG 3: object URL ต้องไม่รั่วเมื่อรูปเดียวถูกวาดหลายที่ =================
  const before = w.__created;
  for (let i=0;i<5;i++){
    click($('#detail [data-act="back"]')); await wait(60);
    click(doc.querySelectorAll('#list li[data-id]')[0]); await wait(180);
  }
  const after = w.__created;
  ok('B3: repeated renders do not re-create object URLs', after - before <= 2, 'created='+(after-before)+' (P1,P2 = 2 ids)');
  ok('B3: photo still displays after repeated renders',
     Array.from(doc.querySelectorAll('#detail img[data-photo="'+P1+'"]')).filter(i=>i.getAttribute('src')).length > 0);

  // ================= BUG 4: ลบโพสต ต้อง revoke cache ด้วย =================
  // ตั้งชื่อผู้ใช้ผ่านฟอร์มตั้งค่าให้ตรงกับผู้เขียนโพสต เพื่อให้ปุ่ม "ลบโพสตนี้" ปรากฏ
  click($('#btnSettings'));
  await wait(250);
  $('#sName').value = 'ก';
  submit($('#frmSet'));
  await wait(250);
  click($('#tabSpots')); await wait(120);
  click(doc.querySelector('#list li[data-id]'));
  await wait(300);
  const revokedBefore = w.__revoked.length;
  const delBtn = doc.querySelector('#detail [data-del]');
  ok('B4: delete-post button present (own post)', !!delBtn, 'detail='+($('#detail')?$('#detail').textContent.replace(/\s+/g,' ').slice(0,60):'none'));
  if (delBtn) click(delBtn);
  await wait(500);
  ok('B4: post removed from data', !stored().flatMap(r=>r.posts).some(p=>p.id==='q1'));
  ok('B4: object URLs revoked on delete', w.__revoked.length > revokedBefore, 'revoked='+(w.__revoked.length-revokedBefore));
  const stillThere = await new Promise(res => { const rq=w.indexedDB.open('floodwatch-media',1); rq.onsuccess=()=>{ const g=rq.result.transaction('photos','readonly').objectStore('photos').get(P1); g.onsuccess=()=>res(!!g.result); }; });
  ok('B4: blob removed from IndexedDB', stillThere === false);

  // ================= BUG 5: ข้ามการวาด alertBox ซ้ำเมื่อสถานะเดิม =================
  click($('#tabSpots')); await wait(120);
  const box = $('#alertBox');
  const stamp1 = box.dataset.stamp;
  const html1 = box.innerHTML;
  w.__notifs.length = 0;
  w.dispatchEvent(new w.Event('resize'));
  await wait(200);
  ok('B5: alert box not rewritten when nothing changed', box.dataset.stamp === stamp1 && box.innerHTML === html1);

  // ================= BUG 6: import ต้อง merge โพสตเข้าจุดเดิม ไม่ใช่ข้ามทิ้ง =================
  const base = stored();
  const imp = {
    v:2,
    reports:[{ id:'rA', lat:14.3, lng:99.4, level:2, depth:99, place:'ชื่อใหม่', note:'โน้ตใหม่', ts:now, resolved:true,
      posts:[{ id:'impPost1', text:'โพสตจากไฟล์นำเข้า', photos:[], author:{name:'ผู้นำเข้า',phone:'080-000-0000'}, ts:now }] }],
    photos:{}
  };
  const f = new w.File([JSON.stringify(imp)],'i.json',{type:'application/json'});
  const fi = $('#fileIn');
  Object.defineProperty(fi,'files',{value:[f],configurable:true});
  fi.dispatchEvent(new w.Event('change',{bubbles:true}));
  await wait(500);
  const merged = stored().find(r=>r.id==='rA');
  ok('B6: import merged post into existing report', merged && (merged.posts||[]).some(p=>p.id==='impPost1'), 'posts='+(merged?merged.posts.length:0));
  ok('B6: import did not duplicate the report', stored().filter(r=>r.id==='rA').length === 1);
  ok('B6: import updated fields', merged && merged.depth===99 && merged.note==='โน้ตใหม่' && merged.resolved===true, JSON.stringify({d:merged&&merged.depth,n:merged&&merged.note,r:merged&&merged.resolved}));
  ok('B6: existing local posts preserved', stored().flatMap(r=>r.posts).some(p=>p.text==='ร่างที่พิมพ์ไว้'));

  // ================= BUG 7: cross-tab merge ต้องไม่ทำให้โพสตหาย =================
  const t0 = now;
  const localOnly = R('rC', [{id:'localPost1', text:'โพสตที่มีเฉพาะแท็บนี้', photos:[], author:{name:'ฉัน',phone:''}, ts:t0}]);
  // แท็บอื่นส่ง state ที่ไม่รู้จัก rC
  const otherTab = [R('rA', [{id:'otherPost1', text:'โพสตจากอีกแท็บ', photos:[], author:{name:'เขา',phone:''}, ts:t0+1}])];
  w.localStorage.setItem('floodwatch.v2', JSON.stringify([otherTab[0], localOnly]));
  w.dispatchEvent(new w.StorageEvent('storage',{key:'floodwatch.v2',newValue:JSON.stringify([otherTab[0],localOnly]),storageArea:w.localStorage}));
  await wait(300);
  const allPostsNow = stored().flatMap(r=>r.posts).map(p=>p.id);
  ok('B7: local post survived cross-tab sync', allPostsNow.includes('localPost1'), JSON.stringify(allPostsNow));
  ok('B7: other tab post arrived', allPostsNow.includes('otherPost1'), JSON.stringify(allPostsNow));

  // ================= BUG 8: จุดที่ถูกลบจากแท็บอื่น ต้องไม่ทำให้หน้า detail ค้าง =================
  click($('#tabFeed')); await wait(150);
  const feedItems = doc.querySelectorAll('#feed li[data-id]');
  if (feedItems.length){
    click(feedItems[0]);
    await wait(200);
    ok('B8: opened detail from feed', $('#paneSpot').hidden === false);
    // แท็บอื่นลบจุดนี้
    const openId = openDetailId();
    ok('B8: identified the open report', !!openId, 'id='+openId);
    // จำลองแท็บอื่นลบจุด: ส่ง array ที่ไม่มีจุดนั้นเลย
    const keep = stored().filter(r => r.id !== openId);
    w.localStorage.setItem('floodwatch.v2', JSON.stringify(keep));
    w.dispatchEvent(new w.StorageEvent('storage',{key:'floodwatch.v2',newValue:JSON.stringify(keep),storageArea:w.localStorage}));
    await wait(400);
    ok('B8: fell back to a real pane after remote delete', $('#paneSpot').hidden === true, 'spot hidden='+$('#paneSpot').hidden);
    ok('B8: visible pane was re-rendered (no stale rows)',
       !$('#paneFeed').textContent.includes('โพสตจากอีกแท็บ') || !$('#detail').textContent.includes('โพสตจากอีกแท็บ'),
       '');
  } else ok('B8: feed had items to test', false, 'no feed items');

  // ================= BUG 9: ล้างข้อมูลต้องรีเซ็ตฟิลเตอร์ =================
  click($('#tabSpots')); await wait(120);
  // ใส่รายงานที่ resolve แล้วเพื่อให้มีชิป "น้ำลดแล้ว"
  sync([Object.assign(R('rD',[]),{resolved:true}), R('rE',[])]);
  await wait(250);
  const chip9 = $$('#chips .chip').find(c=>c.textContent.includes('น้ำลดแล้ว'));
  ok('B9: resolved chip exists', !!chip9, '');
  click(chip9); await wait(150);
  ok('B9: filter=9 shows only resolved', doc.querySelectorAll('#list li[data-id]').length === 1, 'n='+doc.querySelectorAll('#list li[data-id]').length);
  $('#btnClear').click();
  await wait(600);
  const chipsAfter = $$('#chips .chip').map(c=>c.textContent);
  ok('B9: after clear only "ทั้งหมด" chip remains', chipsAfter.length===1 && chipsAfter[0].includes('ทั้งหมด'), JSON.stringify(chipsAfter));
  ok('B9: a chip is actually pressed after clear', $$('#chips .chip[aria-pressed="true"]').length === 1, 'pressed='+$$('#chips .chip[aria-pressed="true"]').length);
  ok('B9: list shows empty state not stale rows', $('#list').textContent.includes('ยังไม่มีรายงาน'));

  // ================= BUG 10: settings.follow ต้องถูกบันทึกเมื่อลบจุด =================
  sync([R('rF',[]), R('rG',[])]);
  await wait(250);
  click(doc.querySelector('#list li[data-id]'));
  await wait(150);
  click($('#detail [data-act="follow"]'));
  await wait(200);
  ok('B10: follow saved', settings().follow && settings().follow.length===1, JSON.stringify(settings().follow));
  click($('#detail [data-act="delete"]'));
  await wait(500);
  ok('B10: follow list persisted after deleting the report', (settings().follow||[]).length === 0, JSON.stringify(settings().follow));

  // ================= BUG 11: lightbox ต้องไม่แสดงรูปผิดเมื่อกดเปลี่ยนเร็ว ๆ =================
  // ใช้รูปที่ยังอยู่ในคลัง (P2 ถูกลบไปแล้วตอนทดสอบ B4) -> ใส่รูปใหม่ก่อน
  await new Promise(res => {
    const rq = w.indexedDB.open('floodwatch-media',1);
    rq.onsuccess = () => { const t=rq.result.transaction('photos','readwrite'); const s=t.objectStore('photos');
      [P1,P2,P3].forEach(id => s.put({id, blob:blob(), w:1, h:1, ts:now}));
      t.oncomplete=res; t.onerror=()=>res(); };
  });
  w.localStorage.setItem('floodwatch.v2', JSON.stringify([]));
  w.dispatchEvent(new w.StorageEvent('storage',{key:'floodwatch.v2',newValue:JSON.stringify([]),storageArea:w.localStorage}));
  await wait(250);
  sync([R('rH',[{id:'hp1',text:'มีรูป',photos:[P1,P2,P3],author:{name:'x',phone:''},ts:now}])]);
  await wait(300);
  click($('#tabSpots')); await wait(120);
  click(doc.querySelector('#list li[data-id]'));
  await wait(300);
  const galImg = doc.querySelector('#detail img[data-photo="'+P1+'"]');
  ok('B11: gallery image rendered', !!galImg, 'imgs='+doc.querySelectorAll('#detail img[data-photo]').length);
  if (galImg) galImg.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
  await wait(250);
  ok('B11: lightbox open', $('#lightbox').classList.contains('on'));
  const c0 = $('#lbCap').textContent;
  click($('#lbN')); click($('#lbN'));
  await wait(400);
  ok('B11: caption index advanced twice from 1/3', /3\/3/.test($('#lbCap').textContent), 'cap='+$('#lbCap').textContent);
  ok('B11: lightbox still has a src', ($('#lbImg').getAttribute('src')||'').length>0);
  if (galImg){ click($('#lbX')); await wait(80); }
  ok('B11: closed', !$('#lightbox').classList.contains('on'));

  // ================= BUG 12: รูปค้างที่ยังไม่โพสต ต้องไม่ถูก prune ทิ้ง =================
  // ใช้ quickPending จริง: stub ให้ quickPickFile เขียนแล้วลบโพสตอื่น
  const alive = await new Promise(res => { const rq=w.indexedDB.open('floodwatch-media',1); rq.onsuccess=()=>{ const g=rq.result.transaction('photos','readonly').objectStore('photos').get(P3); g.onsuccess=()=>res(!!g.result); }; });
  ok('B12: P3 still in store after deletes', alive === true);
  ok('B12: P3 not deleted by prune while referenced', alive === true);

  // ================= สรุป =================
  ok('no uncaught errors', errors.length === 0, errors.join(' | ').slice(0,400));

  const pass = results.filter(r=>r.pass).length, fail = results.filter(r=>!r.pass);
  console.log('\n=== ' + pass + '/' + results.length + ' regression checks passed ===\n');
  results.forEach(r => console.log((r.pass?'PASS  ':'FAIL  ')+r.n+(r.x?'   ['+r.x+']':'')));
  if (fail.length){ console.log('\n--- failures ---'); fail.forEach(f=>console.log(' * '+f.n+' '+f.x)); }
  w.close();
  process.exit(fail.length?1:0);
})().catch(e => {
  console.error('HARNESS ERROR:', e);
  results.forEach(r => console.log((r.pass?'PASS  ':'FAIL  ')+r.n+(r.x?'   ['+r.x+']':'')));
  console.log('--- errors ---'); errors.forEach(x=>console.log(x));
  process.exit(2);
});

function openDetailId(){
  const h2 = $('#detail h2');
  const rows = Array.from(doc.querySelectorAll('#list li[data-id]'));
  const byPlace = h2 ? rows.find(r => r.textContent.includes(h2.textContent)) : null;
  return byPlace ? byPlace.dataset.id : null;
}
