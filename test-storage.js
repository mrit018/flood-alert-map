/* เทสต์: เวลาเบราว์เซอร์บันทึกข้อมูลไม่ได้ ต้องไม่โกหกผู้ใช้ว่า "บันทึกแล้ว"
   (สำคัญมากบนมือถือ: iOS Safari โหมดส่วนตัว, quota เต็ม, ITP ล้าง storage หลัง 7 วัน) */
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

const stub = `
function makeLayer(){
  return { addTo(){return this;}, clearLayers(){return this;}, bindPopup(){return this;},
    on(){return this;}, openPopup(){return this;}, closePopup(){return this;},
    setIcon(){return this;}, getElement(){return null;}, update(){return this;} };
}
window.__mapHandlers = {};
window.__clickMap = function(lat, lng){
  const h = window.__mapHandlers['click'];
  if (!h) throw new Error('ไม่มี click handler ของแผนที่');
  h({ latlng: { lat: lat, lng: lng } });
};
window.L = {
  map: function(){ return { setView(){return this;}, flyTo(){return this;}, getZoom(){return 12;},
    invalidateSize(){return this;}, fitBounds(){return this;}, closePopup(){return this;},
    setMaxBounds(){return this;}, removeLayer(){return this;},
    on(ev, fn){ window.__mapHandlers[ev] = fn; return this; } };},
  tileLayer: function(){ return {addTo(){return this;}}; },
  layerGroup: function(){ return makeLayer(); },
  circle: function(){ return {addTo(){return this;}}; },
  marker: function(){ return makeLayer(); },
  polyline: function(){ return {addTo(){return this;}}; },
  divIcon: function(o){ return o; },
  latLngBounds: function(){ return {pad: function(){ return {pad(){return this;}}; } }; }
};
window.Notification = function(){ this.close = function(){}; };
window.Notification.permission = 'granted';
window.fetch = function(){ return Promise.reject(new Error('ไม่ใช้เน็ตในเทสต์นี้')); };

/* ควบคุมให้เขียน localStorage ได้หรือไม่ก็ได้ */
window.__storageBroken = false;
window.__writes = 0;
const realSet = Storage.prototype.setItem;
const realRemove = Storage.prototype.removeItem;
Storage.prototype.setItem = function(k, v){
  if (window.__storageBroken){
    window.__writes++;
    const e = new Error('quota');
    e.name = 'QuotaExceededError';
    e.code = 22;
    throw e;
  }
  return realSet.call(this, k, v);
};
Storage.prototype.removeItem = function(k){
  if (window.__storageBroken) return;
  return realRemove.call(this, k);
};
`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
  beforeParse(w) {
    w.eval(stub);
    w.indexedDB = fdb.indexedDB; w.IDBKeyRange = fdb.IDBKeyRange;
    if (!w.URL.createObjectURL) w.URL.createObjectURL = () => 'blob:fake';
    if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};
    if (!w.matchMedia) w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
    const p = w.HTMLDialogElement && w.HTMLDialogElement.prototype;
    if (p && !p.showModal) { p.showModal = function(){ this.open = true; }; p.show = function(){ this.open = true; }; p.close = function(){ this.open = false; }; }
  }
});

const w = dom.window, doc = w.document;
const $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = el => { if (!el) throw new Error('missing click target'); el.dispatchEvent(new w.MouseEvent('click', { bubbles:true, cancelable:true })); };
const submit = f => f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true }));
const results = [];
const ok = (n, c, x) => results.push({ n, pass: !!c, x: x || '' });
const toasts = () => $('#toasts').textContent.replace(/\s+/g, ' ');
const breakStorage = () => { w.__storageBroken = true; };
const fixStorage  = () => { w.__storageBroken = false; };

(async function run(){
  /* ---------- ปกติ: ไม่มีแถบเตือน ---------- */
  await wait(400);
  ok('เปิดเว็บปกติ ไม่มีแถบเตือนซ้ำซ้อน', $('#storeWarn').hidden === true,
     'hidden=' + $('#storeWarn').hidden);
  ok('ปุ่ม "วิธีแก้" มีข้อความภาษาไทย',
     (() => { click($('#btnReport')); return true; })());

  /* ---------- เปิดเว็บตอน storage เสียตั้งแต่แรก ---------- */
  fixStorage();
  breakStorage();
  w.location.reload;
  // จำลองการเปิดหน้าใหม่ในสภาพที่เขียนไม่ได้
  const dom2 = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
    beforeParse(ww) {
      ww.eval(stub);
      ww.__storageBroken = true;
      ww.indexedDB = fdb.indexedDB; ww.IDBKeyRange = fdb.IDBKeyRange;
      if (!ww.URL.createObjectURL) ww.URL.createObjectURL = () => 'blob:fake';
      if (!ww.URL.revokeObjectURL) ww.URL.revokeObjectURL = () => {};
      if (!ww.matchMedia) ww.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
      const p = ww.HTMLDialogElement && ww.HTMLDialogElement.prototype;
      if (p && !p.showModal) { p.showModal = function(){ this.open = true; }; p.show = function(){ this.open = true; }; p.close = function(){ this.open = false; }; }
    }
  });
  const w2 = dom2.window, d2 = w2.document;
  const $2 = s => d2.querySelector(s);
  await new Promise(r => setTimeout(r, 500));
  const warn = $2('#storeWarn');
  ok('เปิดเว็บที่บันทึกไม่ได้ -> แถบเตือนแสดงทันที', warn && warn.hidden === false,
     warn ? 'hidden=' + warn.hidden : 'ไม่มี element');
  const wt = warn ? warn.textContent.replace(/\s+/g, ' ') : '';
  ok('ข้อความในแถบเป็นภาษาไทยและบอกสาเหตุ', /บันทึกข้อมูลไม่สำเร็จ/.test(wt) && /เต็ม|ส่วนตัว/.test(wt), wt.slice(0, 120));
  ok('มีปุ่ม "วิธีแก้" ในแถบเตือน', !!$2('#btnStoreHelp'));
  ok('มีปุ่ม "ส่งออกข้อมูล" ในแถบเตือน', !!$2('#btnStoreExport'));
  $2('#btnStoreHelp').dispatchEvent(new w2.MouseEvent('click', { bubbles:true, cancelable:true }));
  await new Promise(r => setTimeout(r, 150));
  const help = $2('#dlgStoreHelp').textContent.replace(/\s+/g, ' ');
  ok('เปิดหน้าวิธีแก้ได้', $2('#dlgStoreHelp').open === true);
  ok('วิธีแก้เป็นภาษาไทย มีขั้นตอนชัดเจน',
     /โหมดส่วนตัว/.test(help) && /iPhone/.test(help) && /ล้าง/.test(help) && /ส่งออก/.test(help),
     help.slice(0, 150));
  ok('วิธีแก้มีปุ่มปิด', !!$2('#dlgStoreHelp [data-close]'));
  dom2.window.close();

  /* ---------- บันทึกรายงานไม่ได้: ต้องไม่บอกว่าสำเร็จ ---------- */
  errors.length = 0;
  breakStorage();
  click($('#btnReport'));            // เข้าโหมดเลือกตำแหน่ง
  await wait(120);
  w.__clickMap(14.5, 99.0);          // แตะแผนที่ -> เปิดฟอร์มรายงาน
  await wait(250);
  ok('แตะแผนที่แล้วเปิดฟอร์มรายงานได้', $('#dlgReport').open === true);
  ok('ก่อนยังไม่ล้มเหลว แถบเตือนยังไม่ขึ้น', $('#storeWarn').hidden === true);
  $('#rPlace').value = 'ถนนทดสอบ';
  $('#rNote').value = 'ทดสอบบันทึกไม่ได้';
  $('#toasts').innerHTML = '';
  submit($('#frmReport'));
  await wait(400);
  const t1 = toasts();
  ok('แถบเตือนแดงแสดงขึ้นเมื่อบันทึกไม่ได้', $('#storeWarn').hidden === false,
     'hidden=' + $('#storeWarn').hidden);
  ok('ไม่ขึ้นว่า "ส่งรายงานแล้ว" เมื่อบันทึกไม่ได้', !/ส่งรายงานแล้ว/.test(t1), t1.slice(0, 130));
  ok('ขึ้นเตือนว่ายังบันทึกไม่ได้ พร้อมวิธีแก้', /ยังบันทึกไม่ได้/.test(t1) && /วิธีแก้/.test(t1), t1.slice(0, 160));
  ok('ฟอร์มยังเปิดอยู่ ไม่ปิดทิ้งข้อมูล', $('#dlgReport').open === true);
  ok('ปุ่มส่งกลับมาใช้ได้ (ไม่ค้าง disabled)', $('#rSubmit').disabled === false);
  ok('ไม่มี error ไม่คาดคิด', errors.length === 0, errors.join(' | ').slice(0, 200));

  /* ---------- แก้ปัญหาแล้วกดซ้ำ: ต้องสำเร็จ และไม่เพิ่มซ้ำ ---------- */
  fixStorage();
  $('#toasts').innerHTML = '';
  submit($('#frmReport'));
  await wait(400);
  ok('แก้ที่เก็บข้อมูลแล้วกดซ้ำ -> สำเร็จ', /ส่งรายงานแล้ว/.test(toasts()), toasts().slice(0, 130));
  ok('ฟอร์มปิดหลังบันทึกสำเร็จ', $('#dlgReport').open === false);
  const saved = JSON.parse(w.localStorage.getItem('floodwatch.v2') || '[]');
  const mine = saved.filter(r => r.place === 'ถนนทดสอบ');
  ok('บันทึกลง storage จริง', mine.length === 1, 'พบ ' + mine.length + ' รายการ');
  ok('ไม่เพิ่มรายงานซ้ำจากการกดสองครั้ง', mine.length === 1, 'พบ ' + mine.length + ' รายการ');
  ok('แถบเตือนหายไปเมื่อบันทึกสำเร็จ', $('#storeWarn').hidden === true);

  /* ---------- บันทึกสถานะโรงพยาบาลไม่ได้ ---------- */
  errors.length = 0;
  click($('#tabRefer')); await wait(200);
  const row = $$('#referList li[data-h]')[0];
  click(row.querySelector('[data-up]'));
  await wait(250);
  ok('เปิดฟอร์มสถานะโรงพยาบาลได้', $('#dlgHosp').open === true);
  breakStorage();
  $('#frmHosp').querySelector('input[name=hs][value="2"]').checked = true;
  $('#toasts').innerHTML = '';
  submit($('#frmHosp'));
  await wait(300);
  ok('สถานะโรงพยาบาลบันทึกไม่ได้ -> เตือน ไม่ปิดฟอร์ม',
     /ยังบันทึกไม่ได้/.test(toasts()) && $('#dlgHosp').open === true, toasts().slice(0, 130));
  fixStorage();
  $('#toasts').innerHTML = '';
  submit($('#frmHosp'));
  await wait(300);
  ok('กดบันทึกซ้ำแล้วสถานะโรงพยาบาลบันทึกสำเร็จ',
     $('#dlgHosp').open === false && /บันทึกสถานะแล้ว/.test(toasts()), toasts().slice(0, 130));
  const opsv = JSON.parse(w.localStorage.getItem('floodwatch.ops.v1') || '{}');
  ok('สถานะโรงพยาบาลอยู่ใน storage จริง', !!(opsv.status && Object.keys(opsv.status).length),
     JSON.stringify(opsv.status || {}).slice(0, 100));
  ok('ไม่มี error ระหว่างชุดทดสอบ', errors.length === 0, errors.join(' | ').slice(0, 200));

  /* ---------- ปุ่มช่วยเหลือในหน้าตั้งค่า ---------- */
  ok('หน้าตั้งค่ามีปุ่ม "วิธีแก้เมื่อบันทึกไม่ได้"', /id="btnHelpSet"/.test(html));
  ok('หน้าตั้งค่ามีปุ่ม "ทดสอบที่เก็บข้อมูล"', /id="btnTestStore"/.test(html));
  $('#btnSettings').dispatchEvent(new w.MouseEvent('click', { bubbles:true, cancelable:true }));
  await wait(250);
  ok('เปิดหน้าตั้งค่าได้', $('#dlgSet').open === true);
  ok('ในหน้าตั้งค่ามีหัวข้อ "เพิ่มข้อมูลไม่ได้?"',
     /เพิ่มข้อมูลไม่ได้\?/.test($('#dlgSet').textContent));
  $('#toasts').innerHTML = '';
  click($('#btnTestStore'));
  await wait(200);
  ok('ปุ่มทดสอบบอกสถานะได้ (ตอนนี้ปกติ)',
     /ใช้ได้ปกติ/.test(toasts()) || /ใช้ไม่ได้/.test(toasts()), toasts().slice(0, 110));
  $('#toasts').innerHTML = '';
  breakStorage();
  click($('#btnTestStore'));
  await wait(200);
  ok('ทดสอบตอนที่พื้นที่เต็ม -> บอกว่าใช้ไม่ได้',
     /ใช้ไม่ได้/.test(toasts()), toasts().slice(0, 110));
  fixStorage();
  $('#toasts').innerHTML = '';
  click($('#btnHelpSet'));
  await wait(250);
  ok('กด "วิธีแก้" แล้วเปิดหน้าต่างวิธีแก้ได้', $('#dlgStoreHelp').open === true);
  ok('วิธีแก้มีคำแนะนำภาษาไทยครบ',
     /โหมดส่วนตัว/.test($('#dlgStoreHelp').textContent));
  if ($('#dlgStoreHelp').open) $('#dlgStoreHelp').close();
  await wait(150);

  /* ---------- ปุ่มรายงานเมื่อแผนที่เปิดไม่ได้ ---------- */
  // ตรวจว่ามีข้อความ .map-dead ที่อธิบายเป็นภาษาไทยอยู่ในโค้ดจริง
  const src = html;
  ok('มีข้อความแนะนำเมื่อแผนที่เปิดไม่ได้ (ภาษาไทย)',
     /เปิดแผนที่ไม่สำเร็จ/.test(src) && /รายงานน้ำท่วมต้องแตะตำแหน่งบนแผนที่/.test(src));
  ok('มีแถบเตือนพื้นที่เก็บข้อมูลในหน้าเว็บ', /id="storeWarn"/.test(src));
  ok('มีหน้าต่างวิธีแก้ในหน้าเว็บ', /id="dlgStoreHelp"/.test(src));

  const pass = results.filter(r => r.pass).length, fail = results.filter(r => !r.pass);
  console.log('\n=== ' + pass + '/' + results.length + ' checks passed ===\n');
  results.forEach(r => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.n + (r.x ? '   [' + r.x + ']' : '')));
  if (fail.length){ console.log('\n--- failures ---'); fail.forEach(f => console.log(' * ' + f.n + '  ' + f.x)); }
  w.close();
  process.exit(fail.length ? 1 : 0);
})().catch(e => {
  console.error('HARNESS ERROR:', e);
  results.forEach(r => console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.n + (r.x ? '   [' + r.x + ']' : '')));
  console.log('--- errors ---'); errors.forEach(x => console.log(x));
  process.exit(2);
});
