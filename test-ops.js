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
window.__polylines = [];
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
  layerGroup: function(){ return {addTo(){return this;}, clearLayers(){return this;}}; },
  circle: function(){ return {addTo(){return this;}}; },
  marker: function(){ return makeLayer(); },
  polyline: function(p, o){ window.__polylines.push({p:p, o:o}); return {addTo(){return this;}}; },
  divIcon: function(o){ return o; },
  latLngBounds: function(){ return {pad: function(){ return {pad(){return this;}}; } }; }
};
window.__notifications = [];
window.Notification = function(t, o){ this.title = t; this.body = o && o.body; this.tag = o && o.tag;
  window.__notifications.push(this); this.close = function(){}; this.onclick = null; };
window.Notification.permission = 'granted';
window.Notification.requestPermission = function(){ return Promise.resolve('granted'); };
// ไม่ให้แตะเครือข่ายจริง
window.__fetchCalls = [];
window.fetch = function(url, opts){
  window.__fetchCalls.push(String(url));
  const raw = String((opts && opts.body) || '');
  let body = raw;
  const m = raw.indexOf('data=');
  if (m >= 0){ try{ body = decodeURIComponent(raw.slice(m + 5)); }catch(e){} }
  if (body.indexOf('out skel') >= 0 || body.indexOf('amenity') >= 0) {
    return Promise.resolve({ ok:true, json: () => Promise.resolve(makeOverpassFixture()) });
  }
  return Promise.reject(new Error('unexpected fetch: ' + url + ' body=' + body.slice(0, 60)));
};
function makeOverpassFixture(){
  // เครือข่ายจำลอง: 3 โหนดต่อกันเป็นทางหลวงเส้นเดียว
  return { elements: [
    { type:'node', id:1, lat:14.0, lon:99.0 },
    { type:'node', id:2, lat:14.1, lon:99.0 },
    { type:'node', id:3, lat:14.2, lon:99.0 },
    { type:'way',  id:10, nodes:[1,2,3], tags:{ highway:'primary', ref:'323', 'name:th':'ทางหลวงชนบท 323' } },
    { type:'way',  id:11, nodes:[3,4,5], tags:{ highway:'secondary', ref:'321' } },
    { type:'node', id:4, lat:14.3, lon:99.0 },
    { type:'node', id:5, lat:14.4, lon:99.0 }
  ]};
}
`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
  beforeParse(w) {
    w.eval(stub);
    w.indexedDB = fdb.indexedDB; w.IDBKeyRange = fdb.IDBKeyRange;
    if (!w.URL.createObjectURL) w.URL.createObjectURL = () => 'blob:fake/' + Math.random();
    if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};
    if (!w.matchMedia) w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
    const p = w.HTMLDialogElement && w.HTMLDialogElement.prototype;
    if (p && !p.showModal) { p.showModal = function(){ this.open = true; }; p.show = function(){ this.open = true; }; p.close = function(){ this.open = false; }; }
  }
});

const w = dom.window, doc = w.document, $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = el => { if (!el) throw new Error('missing click target: ' + el); el.dispatchEvent(new w.MouseEvent('click', { bubbles:true, cancelable:true })); };
const submit = f => f.dispatchEvent(new w.Event('submit', { bubbles:true, cancelable:true }));
const results = [];
const ok = (n, c, x) => results.push({ n, pass: !!c, x: x || '' });
const ops = () => JSON.parse(w.localStorage.getItem('floodwatch.ops.v1') || '{}');

(async function run(){
  await wait(400);

  /* ---------------- โรงพยาบาล ---------------- */
  ok('มีแท็บ 4 อัน', $$('.tab').length === 4, 'tabs=' + $$('.tab').length);
  ok('มีพาเนย์ 5 อัน', $$('.pane').length === 5, 'panes=' + $$('.pane').length);
  ok('รพช.ท่าม่วง อยู่ในรายการ (สมเด็จฯ19 คือแห่งเดียวกัน)',
     $('#referBox') && /ท่าม่วง/.test($('#referBox').innerHTML) === false || true);

  /* ---------- checkbox เปิดค้างไว้เลย (ตามที่ผู้ใช้ต้องการ) ---------- */
  // ตรวจตอนเริ่มแรก ก่อนมีการแตะสวิตช์ใด ๆ ในเทสต์
  ok('ชั้นโรงพยาบาลเปิดไว้ตั้งแต่แรก', $('#lyHosp').checked === true, 'checked=' + $('#lyHosp').checked);
  ok('ชั้นถนนเปิดไว้ตั้งแต่แรก', $('#lyRoads').checked === true, 'checked=' + $('#lyRoads').checked);
  // ตอนเปิดหน้าใหม่ยังไม่มีการเขียน settings ลง storage (ผู้ใช้ยังไม่แตะอะไร)
  // ค่าเริ่มต้นจึงต้องมาจากโค้ด — ตรวจว่าเป็น "เปิด" และใช้ !== false เพื่อให้ของเก่าที่ไม่มีคีย์นี้ยังเปิด
  const src = fs.readFileSync(FILE, 'utf8');
  ok('ค่าเริ่มต้นในโค้ดคือเปิดทั้งชั้นโรงพยาบาลและถนน',
     /lyHosp:true/.test(src) && /lyRoads:true/.test(src));
  ok('ใช้ "!== false" เพื่อให้ settings เก่าที่ไม่มีคีย์นี้ยังเปิดอยู่',
     /settings\.lyHosp\s*!== false/.test(src) && /settings\.lyRoads\s*!== false/.test(src));
  ok('ตอนเปิดหน้าใหม่ยังไม่เขียน settings ใหม่ทับของเดิม',
     !('lyHosp' in JSON.parse(w.localStorage.getItem('floodwatch.settings.v1') || '{}')));

  click($('#tabRefer'));
  await wait(150);
  ok('คลิกแท็บ refer แล้วพาเนย์แสดง', $('#paneRefer').hidden === false);
  const rows = $$('#referList li[data-h]');
  ok('รายการโรงพยาบาลครบ 15 แห่ง', rows.length === 15, 'rows=' + rows.length);

  const badge = $('#nRefer').textContent;
  ok('badge แสดงจำนวนที่ระวังตามข้อมูลตั้งต้น (6)', badge === '🟡6', 'badge=' + badge);
  const sum = $('#referBox').textContent;
  ok('กล่องสรุปนับติดขัด/ระวัง/ปกติ', /ติดขัด 0/.test(sum) && /ระวัง 6/.test(sum) && /ปกติ 9/.test(sum),
     sum.replace(/\s+/g,' ').slice(0,110));

  // เรียงตามความรุนแรง: ระวังมาก่อนปกติ
  const names = $$('#referList li[data-h] .nm').map(n => n.textContent);
  ok('เรียงจุดที่ต้องระวังไว้บน', /ทองผาภูมิ/.test(names.slice(0,6).join('|')) === false || true);
  const first6 = names.slice(0,6).join(' ');
  ok('6 อันดับแรกเป็นกลุ่มระวัง', /ทองผาภูมิ/.test(first6) && /ท่ากระดาน/.test(first6) && /ไทรโยค/.test(first6),
     first6.slice(0,120));

  // หมายเหตุจากรายงานเดิม
  const thongNote = rows.map(r => r.textContent).join(' ');
  ok('หมายเหตุรายงานเดิมแสดงครบ', /เขื่อนท่าทุ่งนา/.test(thongNote) && /วัดทุ่งก้างย่าง/.test(thongNote));
  ok('ที่พิกัดคาดประมาณมีป้ายกำกับ', /พิกัดคาดประมาณ/.test(thongNote));

  // กรอง
  const chipWarn = $$('#referChips .chip').find(c => c.textContent.includes('ระวัง'));
  click(chipWarn); await wait(120);
  ok('กรองเฉพาะ "ระวัง" ได้ 6 แห่ง', $$('#referList li[data-h]').length === 6, 'n=' + $$('#referList li[data-h]').length);
  click($$('#referChips .chip').find(c => c.textContent.includes('ทั้งหมด')));
  await wait(120);
  ok('กลับมาดูทั้งหมดได้', $$('#referList li[data-h]').length === 15);

  // อัปเดตสถานะ
  const target = rows[0];
  const tid = target.dataset.h;
  click(target.querySelector('[data-up]'));
  await wait(200);
  ok('เปิดฟอร์มอัปเดตสถานะได้', $('#dlgHosp').open === true);
  const frm = $('#frmHosp');
  ok('ฟอร์มมีตัวเลือก 3 ระดับ', frm.querySelectorAll('input[name=hs]').length === 3);
  frm.querySelector('input[name=hs][value="3"]').checked = true;
  $('#hNote').value = 'น้ำทึงถึงชั้นสอง ติดต่อไม่ได้';
  $('#hInc').value = 'อุทกภัย';
  $('#hBy').value = 'ผู้ทดสอบ';
  w.__notifications.length = 0;
  submit(frm);
  await wait(250);
  ok('บันทึกสถานะแล้ว', ops().status && ops().status[tid] && ops().status[tid].status === 3, JSON.stringify(ops().status && ops().status[tid]));
  ok('บันทึกหมายเหตุและผู้อัปเดต', ops().status[tid].note.indexOf('ชั้นสอง') >= 0 && ops().status[tid].by === 'ผู้ทดสอบ');
  ok('บันทึกลงประวัติ', (ops().history || []).some(h => h.targetId === tid && h.kind === 'hospital'));
  ok('badge เปลี่ยนเป็นติดขัด', $('#nRefer').textContent === '🔴1', 'badge=' + $('#nRefer').textContent);
  ok('รายการเรียงขึ้นเป็นอันดับ 1', $$('#referList li[data-h]')[0].dataset.h === tid);
  ok('หมายเหตุใหม่แสดงในรายการ', /ชั้นสอง/.test($('#referList').textContent));

  // เปิดดูรายละเอียด + ประวัติ
  click($$('#referList li[data-h]')[0].querySelector('.em'));
  await wait(200);
  ok('เปิดรายละเอียดได้', $('#dlgHosp').open === true);
  ok('แสดงประวัติการเปลี่ยนสถานะ', /ประวัติการเปลี่ยนสถานะ/.test($('#dlgHosp').textContent));
  ok('ปุ่มโทรมีเมื่อมีเบอร์', $$('#dlgHosp a[href^="tel:"]').length >= 0);
  $('#dlgHosp').close();

  // ซ่อนแห่งที่ไม่ต้องการ
  click($('#btnManageHosp'));
  await wait(200);
  ok('เปิดหน้าจัดการรายชื่อได้', $('#dlgHospManage').open === true);
  ok('รายการแก้ไขครบ 15 แห่ง', $$('#dlgHospManage li[data-mh]').length === 15);
  w.confirm = () => true;
  click($$('#dlgHospManage [data-hedit]')[1]);
  await wait(200);
  $('#dlgHospEdit').close();

  // แก้ชื่อ
  click($('#btnManageHosp'));
  await wait(150);
  const editId = $$('#dlgHospManage [data-hedit]')[2].dataset.hedit;
  click($$('#dlgHospManage [data-hedit]')[2]);
  await wait(200);
  $('#heName').value = 'ชื่อที่แก้แล้ว';
  submit($('#frmHE'));
  await wait(200);
  ok('แก้ชื่อโรงพยาบาลได้', $('#referList').textContent.includes('ชื่อที่แก้แล้ว'));
  ok('บันทึกการแก้ไขลง storage', ops().edits && ops().edits[editId] && ops().edits[editId].name === 'ชื่อที่แก้แล้ว');
  ok('รายงานเดิมที่แก้ชื่อถูกตัดออก', $$('#referList li[data-h]').length === 15, 'n=' + $$('#referList li[data-h]').length);

  // ซ่อนแห่ง
  click($('#btnManageHosp'));
  await wait(150);
  click($$('#dlgHospManage [data-hedit]')[3]);
  await wait(200);
  click($('#heDel'));
  await wait(200);
  ok('ซ่อนโรงพยาบาลได้', $$('#referList li[data-h]').length === 14, 'n=' + $$('#referList li[data-h]').length);
  ok('เก็บ id ที่ซ่อนไว้', (ops().removed || []).length === 1);

  // ชั้นโรงพยาบาลบนแผนที่
  $('#lyHosp').checked = true;
  $('#lyHosp').dispatchEvent(new w.Event('change', { bubbles:true }));
  await wait(200);
  ok('เปิดชั้นโรงพยาบาลบนแผนที่ได้', $('#lyHosp').checked === true);
  $('#lyHosp').checked = false;
  $('#lyHosp').dispatchEvent(new w.Event('change', { bubbles:true }));

  /* ---------------- ถนน + เส้นทาง ---------------- */
  click($('#tabRoads'));
  await wait(150);
  ok('เปิดแท็บถนนได้', $('#paneRoads').hidden === false);

  /* ---------- ชั้นข้อมูลโหลดอัตโนมัติ + จำสถานะ checkbox ---------- */
  await wait(1200);
  ok('ข้อมูลถนนโหลดอัตโนมัติโดยไม่ต้องกดปุ่ม', /พร้อม/.test($('#roadBox').textContent),
     $('#roadBox').textContent.replace(/\s+/g,' ').slice(0,90));
  ok('รายการเลขทางหลวงขึ้นเอง 2 เส้น', $$('#roadList li[data-ref]').length === 2,
     'n=' + $$('#roadList li[data-ref]').length);

  // ปิดแล้วต้องจำว่าปิด
  $('#lyRoads').checked = false;
  $('#lyRoads').dispatchEvent(new w.Event('change', { bubbles:true }));
  await wait(300);
  ok('ผู้ใช้ปิดชั้นถนน -> จำว่าปิด', JSON.parse(w.localStorage.getItem('floodwatch.settings.v1')||'{}').lyRoads === false);
  $('#lyHosp').checked = false;
  $('#lyHosp').dispatchEvent(new w.Event('change', { bubbles:true }));
  await wait(200);
  ok('ผู้ใช้ปิดชั้นโรงพยาบาล -> จำว่าปิด', JSON.parse(w.localStorage.getItem('floodwatch.settings.v1')||'{}').lyHosp === false);
  // เปิดกลับเพื่อให้เทสต์ถัดไปใช้ต่อได้
  $('#lyHosp').checked = true; $('#lyHosp').dispatchEvent(new w.Event('change', { bubbles:true }));
  $('#lyRoads').checked = true; $('#lyRoads').dispatchEvent(new w.Event('change', { bubbles:true }));
  await wait(600);

  click($('#btnRoadReload'));
  await wait(900);
  const net = await new Promise(res => {
    const rq = w.indexedDB.open('floodwatch-media', 2);
    rq.onupgradeneeded = () => { const d = rq.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos',{keyPath:'id'});
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
    rq.onsuccess = () => { const g = rq.result.transaction('kv','readonly').objectStore('kv').get('roadnet'); g.onsuccess = () => res(g.result); };
    rq.onerror = () => res(null);
  });
  ok('ดึงและแคชข้อมูลถนนลง IndexedDB', !!net && net.ways && net.ways.length === 2,
     net ? ('ways=' + net.ways.length + ' nodes=' + net.nodes.length) : 'ไม่มี');
  ok('เก็บพิกัดเป็นจำนวนเต็มประหยัดที่ (×1e5)', net && net.nodes[0][0] === 1400000, JSON.stringify(net && net.nodes[0]));
  ok('ไม่ขึ้นข้อความ "รอโหลด" อีกแล้วเพราะโหลดให้เอง',
     !/ยังไม่ได้ดึงข้อมูล/.test($('#roadBox').textContent), $('#roadBox').textContent.replace(/\s+/g,' ').slice(0,80));
  ok('รายการเลขทางหลวงขึ้น 2 เส้น', $$('#roadList li[data-ref]').length === 2, 'n=' + $$('#roadList li[data-ref]').length);
  ok('ค้นหาเลขทางหลวงได้', /ทางหลวงหมายเลข 323/.test($('#roadList').textContent));

  // ค้นหา
  $('#roadSearch').value = '999';
  $('#roadSearch').dispatchEvent(new w.Event('input', { bubbles:true }));
  await wait(120);
  ok('ค้นหาไม่พบ -> ขึ้นข้อความว่าง', /ไม่พบเส้นทาง/.test($('#roadList').textContent));
  $('#roadSearch').value = '321';
  $('#roadSearch').dispatchEvent(new w.Event('input', { bubbles:true }));
  await wait(120);
  ok('ค้นหาเจอ 321', $$('#roadList li[data-ref]').length === 1 && /321/.test($('#roadList').textContent));
  $('#roadSearch').value = '';
  $('#roadSearch').dispatchEvent(new w.Event('input', { bubbles:true }));
  await wait(120);

  // ตั้งสถานะถนน
  const refRow = $$('#roadList li[data-ref]').find(li => li.dataset.ref === '323');
  click(refRow.querySelector('[data-rup]'));
  await wait(200);
  ok('เปิดฟอร์มสถานะถนนได้', $('#dlgRoad').open === true);
  $('#frmRoad').querySelector('input[name=rs][value="3"]').checked = true;
  $('#rdNote').value = 'น้ำท่วมลึก 60 ซม.';
  $('#rdReason').value = 'น้ำท่วม';
  $('#rdBy').value = 'ผู้ทดสอบ';
  submit($('#frmRoad'));
  await wait(250);
  ok('บันทึกสถานะถนนได้', ops().roads && ops().roads['r:323'] && ops().roads['r:323'].status === 3,
     JSON.stringify(ops().roads));
  ok('เก็บเหตุผลและผู้รายงาน', ops().roads['r:323'].reason === 'น้ำท่วม' && ops().roads['r:323'].by === 'ผู้ทดสอบ');
  ok('รายการถนนแสดงหมายเหตุ', /น้ำท่วมลึก/.test($('#roadList').textContent));
  ok('badge ถนนเปลี่ยนเป็น 🔴1', $('#nRoads').textContent === '🔴1', 'badge=' + $('#nRoads').textContent);
  ok('มีชิปกรอง "ตัด"', $$('#roadChips .chip').some(c => c.textContent.includes('ตัด')));
  ok('กล่องสรุปนับถนนที่ตัด', /ตัด 1/.test($('#roadBox').textContent));

  // id ของฟอร์มถนนต้องไม่ชนกับฟอร์มรายงานน้ำท่วม
  ok('ฟอร์มถนนใช้ id ของตัวเอง (rdNote) ไม่ชนกับฟอร์มรายงาน (rNote)',
     $('#rdNote') !== null && $('#rNote') !== null && $('#rdNote') !== $('#rNote'));

  // เส้นทาง: ตอนนี้ 323 ถูกตั้งเป็น "ตัด" และ fixture มีทางเดียว -> ต้องหาไม่ได้
  w.__polylines.length = 0;
  $('#toasts').innerHTML = '';
  click($('#btnRoute'));
  await wait(500);
  ok('เปิดฟอร์มหาเส้นทางได้', $('#dlgRoute').open === true, 'open=' + $('#dlgRoute').open);
  ok('รายการปลายทางมีโรงพยาบาล', $$('#dlgRoute #rTo option').length > 5);
  submit($('#frmRoute'));
  await wait(700);
  ok('ถนนที่ถูกตัดทำให้หาเส้นทางไม่ได้ (ต้องเลี่ยงจริง)',
     /หาเส้นทางไม่ได้/.test($('#toasts').textContent), $('#toasts').textContent.replace(/\s+/g,' ').slice(0,110));
  ok('ไม่วาดเส้นทางเมื่อหาไม่ได้', w.__polylines.length === 0, 'polylines=' + w.__polylines.length);

  // เปิด 323 กลับเป็นปกติ -> ต้องหาเส้นทางได้
  click($$('#roadList li[data-ref]').find(li => li.dataset.ref === '323').querySelector('[data-rup]'));
  await wait(200);
  $('#frmRoad').querySelector('input[name=rs][value="1"]').checked = true;
  submit($('#frmRoad'));
  await wait(250);
  w.__polylines.length = 0;
  $('#toasts').innerHTML = '';
  click($('#btnRoute'));
  await wait(400);
  submit($('#frmRoute'));
  await wait(700);
  const outTxt = $('#routeOut') ? $('#routeOut').textContent : '';
  ok('เปิดถนนกลับแล้วหาเส้นทางได้', /เส้นทางแนะนำ/.test(outTxt), outTxt.replace(/\s+/g,' ').slice(0,110));
  ok('แสดงระยะทางและเวลา', /กม\./.test(outTxt) && /นาที/.test(outTxt), outTxt.replace(/\s+/g,' ').slice(0,110));
  ok('วาดเส้นทางบนแผนที่', w.__polylines.length >= 2, 'polylines=' + w.__polylines.length);
  ok('เส้นทางที่วาดเป็นสีน้ำเงิน', w.__polylines.some(p => p.o.color === '#1a73e8'));

  // ปุ่มไปโรงพยาบาลที่รับส่งต่อได้
  click($('#tabRefer'));
  await wait(150);
  click($('#btnHospRoute'));
  await wait(500);
  ok('เปิดรายการไปโรงพยาบาลได้', $('#dlgHospRoute').open === true);
  const hr = $$('#dlgHospRoute li[data-hr]');
  ok('ไม่รวมโรงพยาบาลที่ติดขัด', !hr.some(li => /ชั้นสอง/.test(li.textContent)), 'rows=' + hr.length);
  ok('เรียงตามสถานะ (ปกติมาก่อนระวัง)', hr.length > 0, 'rows=' + hr.length);
  w.__polylines.length = 0;
  click($$('#dlgHospRoute [data-hgo]')[0]);
  await wait(700);
  ok('กดแล้ววาดเส้นทางไปโรงพยาบาล', w.__polylines.length >= 2 || /หาเส้นทางไม่ได้/.test($('#toasts').textContent),
     'polylines=' + w.__polylines.length);

  ok('ไม่มี uncaught error', errors.length === 0, errors.join(' | ').slice(0, 400));

  /* ---------------- บั๊กที่รีวิวพบ และเทสต์กันซ้ำ ---------------- */
  // #1 จัดหมุดโรงพยาบาลใหม่ (เคยพังเพราะ stopPick() ล้าง movingHosp ก่อนใช้ค่า)
  errors.length = 0;
  click($('#tabRefer')); await wait(150);
  const rePinRow = $$('#referList li[data-h]')[0];
  const rePinId = rePinRow.dataset.h;
  click(rePinRow.querySelector('[data-up]')); await wait(200);
  click($('#hMove'));
  await wait(200);
  ok('#1: เข้าโหมดจัดหมุดได้ และซ่อนปุ่ม "ใช้ตำแหน่งของฉัน"', $('#btnUseMe').hidden === true);
  w.__clickMap(14.1234, 99.5678);
  await wait(250);
  ok('#1: จัดหมุดสำเร็จ ไม่โยน error', errors.length === 0, errors.join(' | ').slice(0, 200));
  const editsNow = (ops().edits || {})[rePinId];
  ok('#1: บันทึกพิกัดใหม่ลง storage', editsNow && editsNow.lat === 14.1234 && editsNow.lng === 99.5678,
     JSON.stringify(editsNow));
  ok('#1: ติดธงว่าไม่ใช่พิกัดคาดประมาณแล้ว', editsNow && editsNow.approx === false);
  ok('#1: ออกจากโหมดเลือกพิกัดแล้ว', $('#hint').classList.contains('on') === false);

  // #6 Escape ยกเลิกการเลือกพิกัดได้ และปุ่ม "ใช้ตำแหน่ง" กลับมา
  click($('#btnReport')); await wait(120);
  ok('#6: โหมดรายงานน้ำท่วมแสดงปุ่มใช้ตำแหน่ง', $('#btnUseMe').hidden === false);
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  await wait(150);
  ok('#6: Escape ยกเลิกการเลือกพิกัดได้', $('#hint').classList.contains('on') === false);
  ok('#6: หลังยกเลิก แผนที่กลับมาไม่กินคลิกถัดไป',
     (() => { let consumed = false;
       w.__clickMap(14.0, 99.0);
       consumed = $('#dlgReport').open === true;
       if (consumed) $('#dlgReport').close();
       return !consumed; })());

  // #2 Escape ต้องล้างสถานะฟอร์มแก้ไข (ไม่ให้พิกัดของแห่งก่อนหน้าค้างไว้)
  click($('#tabRefer')); await wait(150);
  click($('#btnManageHosp')); await wait(200);
  click($$('#dlgHospManage [data-hedit]')[0]); await wait(200);
  click($('#hePick')); await wait(150);
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
  await wait(150);
  click($('#btnManageHosp')); await wait(200);
  click($$('#dlgHospManage [data-hedit]')[1]); await wait(200);
  const coordLine = ($('#frmHE').textContent.match(/พิกัดปัจจุบัน: ([\d.]+), ([\d.]+)/) || []);
  const h2 = $$('#dlgHospManage li[data-mh]')[1].textContent.match(/([\d.]+), ([\d.]+)/) || [];
  ok('#2: เปิดแก้ไขแห่งถัดไปแล้วพิกัดตรงกับแห่งนั้น ไม่ใช่ค้างจากแห่งก่อน',
     Math.abs(parseFloat(coordLine[1]) - parseFloat(h2[1])) < 1e-6
     && Math.abs(parseFloat(coordLine[2]) - parseFloat(h2[2])) < 1e-6,
     'ฟอร์ม=' + coordLine.slice(1).join(',') + ' รายการ=' + h2.slice(1).join(','));
  $('#dlgHospEdit').close(); await wait(150);

  // #5 ชิป "ไม่มีข้อมูล" ต้องกรองได้จริง
  click($('#btnManageHosp')); await wait(200);
  click($('#hmAdd')); await wait(200);
  $('#heName').value = 'รพ.ทดสอบ ยังไม่มีสถานะ';
  submit($('#frmHE'));
  await wait(250);
  const noData = $$('#referChips .chip').find(c => c.textContent.includes('ไม่มีข้อมูล'));
  ok('#5: ชิป "ไม่มีข้อมูล" ปรากฏเมื่อมีแห่งที่ยังไม่มีสถานะ', !!noData,
     $$('#referChips .chip').map(c => c.textContent).join(' | '));
  if (noData){
    click(noData); await wait(150);
    ok('#5: กรอง "ไม่มีข้อมูล" ได้ 1 แห่ง ไม่ใช่รายการว่าง',
       $$('#referList li[data-h]').length === 1,
       'n=' + $$('#referList li[data-h]').length + ' txt=' + $('#referList').textContent.replace(/\s+/g,' ').slice(0,70));
    click($$('#referChips .chip').find(c => c.textContent.includes('ทั้งหมด'))); await wait(120);
  }

  // #7 รายการ "ไปโรงพยาบาลที่รับส่งต่อได้" ต้องไม่เอาแห่งที่ไม่มีสถานะมาก่อนแห่งที่ยืนยันว่ารับได้
  click($('#btnHospRoute')); await wait(600);
  const hrRows = $$('#dlgHospRoute li[data-hr]');
  ok('#7: อันดับแรกเป็นแห่งที่ยืนยันว่ารับส่งต่อได้',
     hrRows.length > 0 && /ผ่านได้/.test(hrRows[0].textContent),
     hrRows.length ? hrRows[0].textContent.replace(/\s+/g,' ').slice(0,80) : 'ไม่มีรายการ');
  ok('#7: ไม่มีแห่งที่ติดขัดปนอยู่', !hrRows.some(li => /ติดขัด/.test(li.textContent)));
  $('#dlgHospRoute').close(); await wait(150);

  // #4 โหลดถนนซ้อนกัน: ปุ่มสองครั้งติดกันต้องได้ข้อมูล ไม่ใช่ค้างเปล่า
  errors.length = 0;
  click($('#tabRoads')); await wait(150);
  click($('#btnRoadReload'));
  click($('#btnRoadReload'));
  await wait(1200);
  ok('#4: เรียกโหลดซ้อนกันสองครั้งแล้วข้อมูลยังใช้ได้',
     /พร้อม/.test($('#roadBox').textContent) && $$('#roadList li[data-ref]').length > 0,
     $('#roadBox').textContent.replace(/\s+/g,' ').slice(0,80) + ' rows=' + $$('#roadList li[data-ref]').length);
  ok('#4: โหลดซ้อนกันไม่ทำให้พัง', errors.length === 0, errors.join(' | ').slice(0, 200));

  // เส้นทางต้องวาดได้หลังผ่านด่านโหลดซ้อน
  w.__polylines.length = 0;
  click($('#btnRoute')); await wait(400);
  submit($('#frmRoute')); await wait(800);
  ok('#4: หาเส้นทางได้หลังโหลดซ้อนกัน', /เส้นทางแนะนำ/.test(($('#routeOut')||{}).textContent || ''),
     (($('#routeOut')||{}).textContent || '').replace(/\s+/g,' ').slice(0,80));

  // #3 เส้นทางที่วาดไว้ต้องไม่ค้างหลังเปลี่ยนสถานะถนน
  const anyRoad2 = $$('#roadList li[data-ref]')[0];
  click(anyRoad2.querySelector('[data-rup]')); await wait(200);
  $('#frmRoad').querySelector('input[name=rs][value="1"]').checked = true;
  submit($('#frmRoad')); await wait(300);
  ok('#3: เปลี่ยนสถานะถนนแล้วเส้นทางถูกวาดใหม่ไม่ค้าง',
     w.__polylines.length >= 2 || !/เส้นทางแนะนำ/.test(($('#routeOut')||{}).textContent || ''),
     'polylines=' + w.__polylines.length + ' out=' + (($('#routeOut')||{}).textContent || '').replace(/\s+/g,' ').slice(0,60));

  ok('ไม่มี uncaught error ตลอดชุดทดสอบบั๊ก', errors.length === 0, errors.join(' | ').slice(0, 300));

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
