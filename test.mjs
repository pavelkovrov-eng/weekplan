// Run: node --test test.mjs   ·   one test: node --test --test-name-pattern="dates" test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const html=readFileSync(new URL("./index.html",import.meta.url),'utf8');
const src=html.match(/<script id="core">([\s\S]*?)<\/script>/)?.[1];
if(!src)throw new Error('no <script id="core"> in page');
const names=[...src.matchAll(/^(?:const|function)\s+([\w$]+)/gm)].map(m=>m[1]);
const core=new Function(src+`\nreturn{${names.join(',')}}`)();

test('dates',()=>{
  assert.equal(core.addDays('2026-10-25',7),'2026-11-01');
  assert.equal(core.addDays('2026-12-28',7),'2027-01-04');
  assert.equal(core.dow('2026-10-18'),0);
  assert.equal(core.sunOf('2026-10-24'),'2026-10-18');
  assert.equal(core.sunOf('2026-10-25'),'2026-10-25');
  assert.equal(core.dm('2027-01-17'),'17.01');
  assert.equal(core.wkDiff('2026-10-18','2026-11-01'),2);
  assert.equal(core.wkDiff('2026-11-01','2026-10-18'),-2);
  assert.ok(core.isoOk('2026-02-28'));assert.ok(!core.isoOk('2026-02-30'));assert.ok(!core.isoOk('x'));assert.ok(!core.isoOk(undefined));
  assert.match(core.todayIso(),/^\d{4}-\d\d-\d\d$/);
});
test('existing helpers survive the split',()=>{
  assert.deepEqual(core.span('22:00','02:00'),[1320,1560]);
  assert.equal(core.tr(1320,1560),'22:00–02:00 (למחרת)');
  assert.equal(core.esc('<a>'),'&lt;a&gt;');
});
const A='2026-10-18';
test('the week-A/B rotation is gone',()=>{
  assert.equal(core.rot,undefined);assert.equal(core.anchorOf,undefined);
  assert.equal(core.WKN.A,'כל שבוע');assert.equal(core.WKN.both,'כל שבוע');
});
test('clampSun',()=>{
  assert.equal(core.clampSun('2026-10-04'),'2026-10-18');
  assert.equal(core.clampSun('2027-05-02'),'2027-03-07');
  assert.equal(core.clampSun('2026-11-08'),'2026-11-08');
});
test('baseDay',()=>{
  assert.equal(core.baseDay('2026-10-26',[]),1);
  assert.equal(core.baseDay('2026-10-27',[]),null);   // elections
  assert.equal(core.baseDay('2027-01-17',[]),2);      // make-up day runs Tuesday
  assert.equal(core.baseDay('2027-01-18',[]),null);   // after semester
  assert.equal(core.baseDay('2026-10-17',[]),null);   // before semester
  assert.equal(core.baseDay('2026-11-02',[{kind:'off',date:'2026-11-02'}]),null);
  assert.equal(core.baseDay('2027-01-17',[{kind:'off',date:'2027-01-17'}]),null);
});
test('evsForWeek',()=>{
  const items=[{id:'a',kind:'anchor',date:A,updated:1},
    {id:'r1',kind:'open',day:4,start:'07:00',end:'15:00',week:'A'},
    {id:'r2',kind:'close',day:4,start:'15:00',end:'23:00',week:'B'},
    {id:'r3',kind:'study',day:5,start:'10:00',end:'12:00',week:'both',skip:['2026-10-23']},
    {id:'o1',kind:'gm',date:'2026-10-24',start:'18:00',end:'20:00'},
    {id:'d1',kind:'due',date:'2026-10-22',start:'23:59'}];
  const w1=core.evsForWeek('2026-10-18',items);
  assert.deepEqual(w1.filter(e=>e.src==='user').map(e=>e.id).sort(),['o1','r1','r2']);   // A/B docs of the retired rotation are weekly; r3 skips 23.10
  assert.equal(w1.find(e=>e.id==='o1').date,'2026-10-24');
  assert.equal(w1.find(e=>e.id==='o1').week,'date');
  assert.equal(w1.find(e=>e.id==='o1').kind,'other'); // retired kind:'gm' falls back to other
  assert.equal(w1.filter(e=>e.src==='base').length,12);assert.ok(!w1.some(e=>e.key==='b10')); // BASE[10] OB lecture is self:1 (self-paced on Zoom), never drawn; indices stay put
  const w2=core.evsForWeek('2026-10-25',items);
  assert.deepEqual(w2.filter(e=>e.src==='user').map(e=>e.id).sort(),['r1','r2','r3']);
  assert.equal(w2.filter(e=>e.src==='base'&&e.d===2).length,0);
  const mk=core.evsForWeek('2027-01-17',items);
  assert.deepEqual(mk.filter(e=>e.src==='base').map(e=>e.d),[0,0,0]);
  const ex=core.evsForWeek('2027-01-17',[]).filter(e=>e.src==='exam');
  assert.equal(ex.length,2);const mi=ex.find(e=>e.date==='2027-01-22');assert.equal(mi.e-mi.s,180);assert.equal(mi.room,"מועד א'");assert.ok(ex.some(e=>e.date==='2027-01-18'&&e.course==='eng')); // English moed A 18.01 + micro 22.01
});
test('tolerates old and malformed docs',()=>{
  const w=core.evsForWeek('2026-10-18',[{id:'old',kind:'weird',day:1,start:'10:00',end:'11:00',week:'both'},
    {id:'bad',kind:'open',date:'2026-13-01',start:'10:00',end:'11:00'},{id:'nod',kind:'open',start:'10:00',end:'11:00'},
    {id:'a',kind:'anchor',date:'garbage'}]);
  assert.deepEqual(w.filter(e=>e.src==='user').map(e=>[e.id,e.kind]),[['old','other']]);
});
test('A/B docs of the retired rotation show every week, with or without an anchor doc',()=>{
  const L=[{id:'a',kind:'open',day:4,start:'07:00',end:'15:00',week:'A'},{id:'b',kind:'study',day:5,start:'10:00',end:'12:00',week:'both'},{id:'c',kind:'close',day:2,start:'18:00',end:'23:00',week:'B'}];
  for(const sun of ['2026-10-18','2026-10-25'])for(const extra of [[],[{id:'x',kind:'anchor',date:'2026-10-18',updated:1}]])
    assert.deepEqual(core.evsForWeek(sun,[...L,...extra]).filter(e=>e.src==='user').map(e=>e.id).sort(),['a','b','c']);
  assert.equal(core.lineTxt(core.evsForWeek('2026-10-18',L).find(e=>e.id==='a')).meta,'כל שבוע');
});
test('upcoming',()=>{
  const items=[{id:'d1',kind:'due',date:'2027-01-20',start:'23:59',title:'מטלה 3'},{id:'d2',kind:'due',date:'2027-01-21',title:'x',done:true}];
  const L=core.upcoming('2027-01-19',items,3);
  assert.deepEqual(L.map(x=>x.title),['מטלה 3','מבוא למיקרו','הסתברות וסטטיסטיקה']);
  assert.equal(L[0].daysLeft,1);assert.equal(L[1].tag,"מועד א'");assert.equal(L[0].id,'d1');
  assert.equal(core.upcoming('2027-03-09',[]).length,0);
});
test('stats + analyze with exams',()=>{
  const s=core.stats(core.evsForWeek('2027-01-17',[]));
  assert.equal(s.cls,330);assert.equal(s.ex,360);assert.equal(s.total,690);assert.equal(s.studyDays,1);
  const an=core.analyze(core.evsForWeek('2027-01-17',[{id:'s',kind:'open',date:'2027-01-22',start:'08:00',end:'12:00'}]));
  assert.equal(an.bad.length,1);assert.ok(an.bad[0].includes("מועד א'"));assert.ok(an.clash.has('x0'));
});
test('toDoc',()=>{
  const f={kind:'open',title:'',day:2,start:'07:00',end:'15:00',week:'date',note:'',updated:5};
  const one=core.toDoc(f,'2026-10-25');
  assert.deepEqual(Object.keys(one).sort(),['date','end','kind','note','start','title','updated']);
  assert.equal(one.date,'2026-10-27');
  const r=core.toDoc({...f,week:'A',skip:['2026-11-01']},'2026-10-25');
  assert.equal(r.week,'A');assert.equal(r.day,2);assert.deepEqual(r.skip,['2026-11-01']);assert.equal(r.date,undefined);
  assert.deepEqual(core.toDoc({...f,week:'both'},'2026-10-25').skip,[]);
});
test('toDoc due',()=>{
  const d=core.toDoc({kind:'due',title:'מטלה',day:4,start:'',end:'',week:'A',note:'',updated:1},'2026-10-25');
  assert.deepEqual(d,{kind:'due',title:'מטלה',note:'',updated:1,date:'2026-10-29',start:'23:59',done:false});
  assert.equal(core.toDoc({kind:'due',title:'מטלה',day:4,start:'23:59',week:'A',note:'',updated:1,done:true},'2026-10-25').done,true);
  assert.equal(core.KINDS.due.label,'הגשה');
  assert.equal(core.evsForWeek('2026-10-25',[{id:'x',kind:'due',date:'2026-10-29',start:'12:00',end:'13:00'}]).filter(e=>e.src==='user').length,0);
});
test('ics',()=>{
  assert.equal(core.icsEsc('a,b;c\\d\ne'),'a\\,b\\;c\\\\d\\ne');
  const long='SUMMARY:'+'א'.repeat(60),f=core.icsFold(long);
  f.split('\r\n').forEach(l=>assert.ok(new TextEncoder().encode(l).length<=75));
  assert.equal(f.split('\r\n').map((l,i)=>i?l.slice(1):l).join(''),long);
  assert.equal(core.icsDT('2026-10-22',1560),'20261023T020000');
  assert.equal(core.icsDT('2026-10-24',1560),'20261025T020000'); // Sat-night shift on the DST-end night
  const items=[{id:'a',kind:'anchor',date:'2026-10-18',updated:1},{id:'n',kind:'close',day:4,start:'18:00',end:'02:00',week:'both'},{id:'d',kind:'due',date:'2026-11-05',start:'23:59',title:'מטלה, 1'}];
  const ics=core.buildIcs(items,'20261008T000000Z');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('BEGIN:VTIMEZONE'));assert.ok(!/[^\r]\n/.test(ics));
  assert.ok(ics.includes('DTSTART;TZID=Asia/Jerusalem:20261022T180000\r\nDTEND;TZID=Asia/Jerusalem:20261023T020000'));
  assert.ok(ics.includes('SUMMARY:הגשה: מטלה\\, 1'));
  assert.ok(ics.includes('DTSTART;TZID=Asia/Jerusalem:20261105T232900'));
  assert.ok(!ics.includes('DTSTART;TZID=Asia/Jerusalem:20261027T'),'no classes on election day');
  assert.equal(ics.match(/BEGIN:VEVENT/g).length,156+14+21+1);
  const early=core.semEvents([{id:'e',kind:'due',date:'2026-11-05',start:'00:15'}]).find(x=>x.uid==='ue-2026-11-05');
  assert.ok(early.s>=0&&early.e>early.s);
});
test('untitled deadline summary',()=>{
  assert.equal(core.semEvents([{id:'q',kind:'due',date:'2026-11-05',start:'12:00'}]).find(x=>x.uid==='uq-2026-11-05').summary,'הגשה');
  assert.equal(core.semEvents([{id:'q',kind:'due',date:'2026-11-05',start:'12:00',title:'מטלה'}]).find(x=>x.uid==='uq-2026-11-05').summary,'הגשה: מטלה');
});
test('zip',()=>{
  assert.equal(core.crc32(new TextEncoder().encode('123456789')),0xCBF43926);
  const dir=mkdtempSync(join(tmpdir(),'wp-')),p=join(dir,'t.zip'),text='BEGIN:VCALENDAR\r\nשלום\r\nEND:VCALENDAR\r\n';
  writeFileSync(p,core.zip1('weekplan-semA.ics',text));
  assert.equal(execFileSync('unzip',['-p',p,'weekplan-semA.ics']).toString('utf8'),text);
});
test('csv',()=>{
  const csv=core.buildCsv([{id:'n',kind:'close',day:4,start:'18:00',end:'02:00',week:'both',title:'סגירה "ערב"'}]);
  const lines=csv.trim().split('\r\n');
  assert.equal(lines[0],'Subject,Start Date,Start Time,End Date,End Time,Description,Location');
  assert.ok(lines.includes('"סגירה ""ערב""","10/22/2026","6:00 PM","10/23/2026","2:00 AM","",""'));
  assert.ok(lines.includes('"מבחן: מבוא למיקרו · מועד א\'","01/22/2027","9:00 AM","01/22/2027","12:00 PM","",""'));
  assert.equal(lines.length,1+156+14+21);
  assert.equal(core.ampm(0),'12:00 AM');assert.equal(core.ampm(720),'12:00 PM');
});
test('detach',()=>{
  const prev={id:'r1',kind:'close',title:'סגירה',day:4,start:'15:00',end:'23:00',week:'A',note:'n',skip:['2026-10-22'],updated:1};
  const f={kind:'close',title:'סגירה',day:4,start:'16:00',end:'23:00',week:'date',note:'n',updated:9};
  const{one,series}=core.detach(prev,f,'2026-11-01','2026-11-05');
  assert.deepEqual(series,{kind:'close',title:'סגירה',day:4,start:'15:00',end:'23:00',week:'A',note:'n',skip:['2026-10-22','2026-11-05'],updated:9});
  assert.equal(series.id,undefined);assert.equal(series.date,undefined);
  assert.deepEqual(Object.keys(one).sort(),['date','end','kind','note','start','title','updated']);
  assert.equal(one.date,'2026-11-05');assert.equal(one.start,'16:00');
  assert.equal(core.detach({...prev,skip:undefined},f,'2026-11-01','2026-11-05').series.skip.join(),'2026-11-05');
  const due=core.detach(prev,{...f,kind:'due',week:'A',done:false},'2026-11-01','2026-11-05');
  assert.deepEqual(due.one,{kind:'due',title:'סגירה',note:'n',updated:9,date:'2026-11-05',start:'16:00',done:false});
  assert.equal(due.series.week,'A');assert.deepEqual(due.series.skip,['2026-10-22','2026-11-05']);
});
test('late-night rule looks at the next Sunday',()=>{
  const run=(sun,date)=>{const items=[{id:'s',kind:'close',date,start:'18:00',end:'01:00'}];
    return core.analyze(core.evsForWeek(sun,items),core.evsForWeek(core.addDays(sun,7),items).filter(e=>e.d===0)).soft};
  assert.equal(run('2027-01-17','2027-01-23').length,0); // next Sunday 24.01 is empty; 17.01 (6 days earlier) must not count
  const w=run('2027-01-10','2027-01-16');                // next Sunday 17.01 is the make-up day, first class 10:15
  assert.equal(w.length,1);assert.ok(w[0].includes('מבוא למיקרו')&&w[0].includes('10:15')&&w[0].includes(core.DAYS[0]));
});
test('every course maps to a color class',()=>{
  const ids=new Set(Object.values(core.COURSE));
  assert.equal(ids.size,7);
  [...core.BASE.map(b=>b.t),...core.EXAMS.map(x=>x.c)].forEach(t=>assert.ok(core.COURSE[t],'no COURSE entry for '+t));
  const evs=core.evsForWeek('2027-01-17',[]);
  assert.ok(evs.filter(e=>e.src==='base'||e.src==='exam').every(e=>e.course===core.COURSE[e.title]));
  assert.equal(evs.find(e=>e.src==='exam'&&e.date==='2027-01-22').course,'micro');assert.equal(evs.find(e=>e.src==='exam'&&e.date==='2027-01-18').course,'eng');
  assert.ok(core.evsForWeek('2026-10-18',[]).filter(e=>e.src==='base').every(e=>ids.has(e.course)));
});
const cx=(date,base)=>({id:'c'+date+base,kind:'cancel',date,base,updated:1});
test('cancel flags only that date and base index',()=>{
  const items=[cx('2026-10-19',5)];
  const w=core.evsForWeek('2026-10-18',items);
  assert.deepEqual(w.filter(e=>e.cancelled).map(e=>e.key),['b5']);
  assert.equal(w.filter(e=>e.src==='base').length,12);
  assert.equal(core.evsForWeek('2026-10-25',items).filter(e=>e.cancelled).length,0);
  assert.equal(core.evsForWeek('2026-10-18',[cx('2026-10-19',4)]).filter(e=>e.cancelled).map(e=>e.key).join(),'b4');
  assert.equal(core.cancelOf('2026-10-19',5,items).id,items[0].id);
  assert.equal(core.cancelOf('2026-10-19',6,items),undefined);
  assert.equal(core.cancelOf('2026-10-26',5,items),undefined);
});
test('a cancel doc never renders as a user event',()=>{
  const d={...cx('2026-10-19',5),start:'10:00',end:'11:00',week:'both',day:1};
  assert.equal(core.evsForWeek('2026-10-18',[d]).filter(e=>e.src==='user').length,0);
});
test('stats skips cancelled classes',()=>{
  const all=core.stats(core.evsForWeek('2026-10-18',[]));
  const one=core.stats(core.evsForWeek('2026-10-18',[cx('2026-10-19',5)]));
  assert.equal(all.cls-one.cls,90);assert.equal(one.total,all.total-90);assert.equal(one.studyDays,all.studyDays);
  const wed=core.stats(core.evsForWeek('2026-10-18',[10,11,12].map(i=>cx('2026-10-21',i))));
  assert.equal(wed.studyDays,all.studyDays-1);assert.ok(wed.freeNames.includes(core.DAYS[3]));
});
test('cancelled class does not clash or crowd a shift',()=>{
  const run=(from,to,cancel)=>{const items=[{id:'s',kind:'open',date:'2026-10-19',start:from,end:to}].concat(cancel?[cx('2026-10-19',5)]:[]);
    return core.analyze(core.evsForWeek('2026-10-18',items))};
  assert.equal(run('10:30','12:00',false).bad.length,1);
  const a=run('10:30','12:00',true);assert.equal(a.bad.length,0);assert.equal(a.soft.length,0);assert.equal(a.clash.size,0);
  assert.equal(run('12:10','13:30',false).soft.length,1);                 // 10 min after the micro lecture
  assert.equal(run('12:10','13:30',true).soft.length,0);
});
test('cancelled Sunday class does not feed the Saturday late-night rule',()=>{
  const sat={id:'s',kind:'close',date:'2026-10-24',start:'18:00',end:'01:00'};
  const run=items=>core.analyze(core.evsForWeek('2026-10-18',items),core.evsForWeek('2026-10-25',items).filter(e=>e.d===0)).soft.length;
  assert.equal(run([sat]),1);                              // 10:15 class, 9h15 after midnight shift end
  assert.equal(run([sat,cx('2026-10-25',0)]),0);           // next class is 12:00
});
test('export omits a cancelled class',()=>{
  const items=[cx('2026-10-19',5)];
  assert.equal(core.semEvents(items).length,core.semEvents([]).length-1);
  assert.ok(!core.semEvents(items).some(x=>x.uid==='b5-2026-10-19'));assert.ok(core.semEvents([]).some(x=>x.uid==='b5-2026-10-19'));
  assert.equal(core.buildIcs(items,'20261008T000000Z').match(/BEGIN:VEVENT/g).length,156+14-1);
  assert.equal(core.buildCsv(items).trim().split('\r\n').length,1+156+14-1);
});
test('cancel works on the make-up day with the base index',()=>{
  const items=[cx('2027-01-17',7)];                         // BASE[7] = Tuesday micro tutorial
  const w=core.evsForWeek('2027-01-17',items);
  assert.deepEqual(w.filter(e=>e.cancelled).map(e=>e.key),['b7']);
  assert.equal(core.stats(w).cls,330-90);
  assert.equal(core.semEvents(items).length,core.semEvents([]).length-1);
  assert.equal(core.evsForWeek('2026-10-20',items).filter(e=>e.cancelled).length,0);
});
test('month helpers',()=>{
  assert.equal(core.MONTHS.length,12);assert.equal(core.MONTHS[9],'אוקטובר');
  assert.equal(core.ymOf('2026-10-18'),'2026-10');
  assert.equal(core.addMonths('2026-12',1),'2027-01');assert.equal(core.addMonths('2027-01',-1),'2026-12');
  assert.equal(core.addMonths('2026-10',0),'2026-10');assert.equal(core.addMonths('2026-10',-10),'2025-12');assert.equal(core.addMonths('2026-10',17),'2028-03');
  assert.deepEqual(core.monthSuns('2026-10'),['2026-09-27','2026-10-04','2026-10-11','2026-10-18','2026-10-25']);
  assert.deepEqual(core.monthSuns('2027-02'),['2027-01-31','2027-02-07','2027-02-14','2027-02-21','2027-02-28']);
  assert.equal(core.monthSuns('2027-01').length,6);assert.equal(core.monthSuns('2027-01')[0],'2026-12-27');assert.equal(core.monthSuns('2027-01')[5],'2027-01-31');
  assert.deepEqual(core.monthSuns('2027-03').slice(-1),['2027-03-28']);
});
test('clampYm',()=>{
  assert.equal(core.clampYm('2026-09'),'2026-10');assert.equal(core.clampYm('2027-05'),'2027-03');
  assert.equal(core.clampYm('2026-10'),'2026-10');assert.equal(core.clampYm('2027-03'),'2027-03');assert.equal(core.clampYm('2026-12'),'2026-12');
});
test('every course has a short month-view name',()=>{
  for(const id of Object.values(core.COURSE))assert.ok(core.CSHORT[id],id);
  assert.equal(core.CSHORT.data,'נתונים ו-AI');
});
test('b64enc/b64dec: UTF-8 safe, tolerate GitHub newlines',()=>{
  const he='שלום עולם — ✓ 😀 "x"\n';
  assert.equal(core.b64enc('abc'),'YWJj');assert.equal(core.b64enc(''),'');
  assert.equal(core.b64enc(he),Buffer.from(he).toString('base64'));
  assert.equal(core.b64dec(core.b64enc(he)),he);
  const wrapped=Buffer.from(he.repeat(8)).toString('base64').replace(/(.{60})/g,'$1\n'); // GitHub wraps content at 60 chars
  assert.ok(wrapped.includes('\n'));assert.equal(core.b64dec(wrapped),he.repeat(8));
  const big='א'.repeat(20000);assert.equal(core.b64dec(core.b64enc(big)),big); // past the chunk size
});
test('storeToItems/itemsToStore',()=>{
  const st={v:1,items:{a1:{kind:'open',day:4,week:'A',start:'07:00',end:'15:00'},b2:{kind:'due',date:'2026-10-22',title:'עבודה'}}};
  const it=core.storeToItems(st);
  assert.deepEqual(it,[{kind:'open',day:4,week:'A',start:'07:00',end:'15:00',id:'a1'},{kind:'due',date:'2026-10-22',title:'עבודה',id:'b2'}]);
  assert.deepEqual(core.itemsToStore(it),st);
  assert.deepEqual(core.itemsToStore([]),{v:1,items:{}});
  for(const bad of [null,undefined,{},{items:null},{items:[1]},'x'])assert.deepEqual(core.storeToItems(bad),[]);
  assert.deepEqual(core.storeToItems({v:1,items:{a:null,b:3,c:{kind:'x'}}}),[{kind:'x',id:'c'}]);
});
test('applyOp: set / replace / delete, never mutates',()=>{
  const st={v:1,items:{a:{kind:'open'},b:{kind:'close'}}},snap=JSON.stringify(st);
  assert.deepEqual(core.applyOp(st,{id:'c',doc:{kind:'due'}}).items,{a:{kind:'open'},b:{kind:'close'},c:{kind:'due'}});
  assert.deepEqual(core.applyOp(st,{id:'a',doc:{kind:'study',id:'a'}}).items.a,{kind:'study'}); // id lives in the key, not the doc
  assert.deepEqual(core.applyOp(st,{id:'a',doc:null}),{v:1,items:{b:{kind:'close'}}});
  assert.deepEqual(core.applyOp(st,{id:'zz',doc:null}),st);
  assert.deepEqual(core.applyOp(null,{id:'a',doc:{kind:'x'}}),{v:1,items:{a:{kind:'x'}}});
  assert.equal(JSON.stringify(st),snap);
});
test('clampDay / pickDay: the navigable days are SEM.start..SEM.last',()=>{
  assert.equal(core.clampDay('2026-10-11'),'2026-10-18');assert.equal(core.clampDay('2027-05-01'),'2027-03-13');
  assert.equal(core.clampDay('2026-11-04'),'2026-11-04');assert.equal(core.clampDay('2027-03-13'),'2027-03-13');
  assert.equal(core.sunOf(core.clampDay('2027-05-01')),core.lastSun);
  const wk=['2026-11-01','2026-11-07'];
  assert.equal(core.pickDay('2026-11-03',...wk,'2026-11-05'),'2026-11-03'); // the pick is inside the period: keep it
  assert.equal(core.pickDay('2026-11-10',...wk,'2026-11-05'),'2026-11-05'); // else today, if inside
  assert.equal(core.pickDay('2026-11-10',...wk,'2026-12-05'),'2026-11-01'); // else the first day
  assert.equal(core.pickDay('2026-10-14','2026-10-11','2026-10-17','2026-10-12'),'2026-10-18'); // always clamped
});
test('swipeDir: >=50px, mostly horizontal; Hebrew/RTL, a swipe to the right is the next day',()=>{
  assert.equal(core.swipeDir(60,5),1);assert.equal(core.swipeDir(-60,-5),-1);
  assert.equal(core.swipeDir(49,0),0);assert.equal(core.swipeDir(50,0),1);
  assert.equal(core.swipeDir(80,60),0);assert.equal(core.swipeDir(90,60),1);assert.equal(core.swipeDir(0,-120),0);
});
test('dayLines: one day, ordered by time, deadlines included',()=>{
  const items=[{id:'a',kind:'anchor',date:A,updated:1},
    {id:'o',kind:'open',day:1,start:'07:00',end:'09:00',week:'both'},
    {id:'c',kind:'close',day:1,start:'16:00',end:'23:00',week:'A'},
    {id:'d1',kind:'due',date:'2026-10-19',start:'12:00',title:'מטלה 1',note:'ב-Moodle'},
    {id:'d2',kind:'due',date:'2026-10-19'},
    {id:'d3',kind:'due',date:'2026-10-20',start:'10:00'}];
  const L=core.dayLines('2026-10-19',items);
  assert.deepEqual(L.map(l=>l.key),['uo','b4','b5','dd1','b6','uc','dd2']);
  assert.deepEqual(L.map(l=>l.s),[420,510,630,720,840,960,1439]);
  assert.equal(L.every(l=>l.date==='2026-10-19'),true);
  const d=L.find(l=>l.id==='d1');assert.deepEqual([d.src,d.title,d.note,d.done,d.e],['due','מטלה 1','ב-Moodle',false,720]);
  assert.equal(L.find(l=>l.id==='d2').title,'');assert.equal(L.find(l=>l.id==='d2').s,1439);
  // cancelled classes stay in the list, flagged; items of the other week type and other days stay out
  const cx=core.dayLines('2026-10-19',[...items,{id:'k',kind:'cancel',date:'2026-10-19',base:5}]);
  assert.deepEqual(cx.filter(l=>l.cancelled).map(l=>l.key),['b5']);
  assert.equal(core.dayLines('2026-10-26',items).some(l=>l.id==='c'),true);  // a week-A doc of the retired rotation is weekly now
  assert.deepEqual(core.dayLines('2026-10-27',[]),[]);                       // election day: no classes
  assert.equal(core.dayLines('2026-10-27',[{id:'off',kind:'off',date:'2026-10-27'}]).length,0);
  assert.deepEqual(core.dayLines('2027-01-17',[]).map(l=>l.key),['b7','b8','b9']); // make-up day: Sunday runs Tuesday's timetable
});
test('lineTxt: colour, title and meta of a list line',()=>{
  const ev=d=>core.evsForWeek('2026-10-18',[{id:'a',kind:'anchor',date:A,updated:1},{id:'u',kind:'open',day:4,start:'07:00',end:'15:00',week:'both',note:'חנות'},{id:'v',kind:'study',date:'2026-10-24',start:'10:00',end:'12:00'}]).find(d);
  assert.deepEqual(core.lineTxt(ev(e=>e.key==='b0')),{col:'--c-stat',ttl:'הסתברות וסטטיסטיקה · תרגיל',meta:'כלכלה 103'});
  assert.deepEqual(core.lineTxt(ev(e=>e.key==='b12')),{col:'--c-eng',ttl:"אנגלית מתקדמים א' · אנגלית",meta:'חדר טרם שובץ'});
  assert.deepEqual(core.lineTxt(ev(e=>e.id==='u')),{col:'--open-bd',ttl:'משמרת פתיחה',meta:'כל שבוע · חנות'});
  assert.deepEqual(core.lineTxt(ev(e=>e.id==='v')),{col:'--study-bd',ttl:'למידה עצמית',meta:'חד-פעמי'});
  const x=core.evsForWeek('2027-01-17',[]).find(e=>e.src==='exam'&&e.date==='2027-01-22');
  assert.deepEqual(core.lineTxt(x),{col:'--c-micro',ttl:'מבוא למיקרו · מבחן',meta:"מועד א'"});
  const d=core.dayLines('2026-10-27',[{id:'d1',kind:'due',date:'2026-10-27',title:'מטלה',note:'n'},{id:'d2',kind:'due',date:'2026-10-27'}]); // election day: only deadlines
  assert.deepEqual(core.lineTxt(d[0]),{col:'--bad-bd',ttl:'הגשה: מטלה',meta:'n'});
  assert.deepEqual(core.lineTxt(d[1]),{col:'--bad-bd',ttl:'הגשה',meta:''});
});
test('DAYI: one initial per weekday',()=>{
  assert.equal(core.DAYI.length,7);assert.equal(core.DAYI[0],'א');assert.equal(core.DAYI[6],'ש');
});
test('storeValid: only {v:1,items:{…}} is a store',()=>{
  assert.ok(core.storeValid({v:1,items:{}}));assert.ok(core.storeValid({v:1,items:{a:{kind:'x'}}}));
  for(const bad of [null,undefined,[],'x',3,{},{items:{}},{v:2,items:{}},{v:1},{v:1,items:null},{v:1,items:[]},{v:1,items:'x'}])assert.ok(!core.storeValid(bad),JSON.stringify(bad));
});
test('opNoop: an op that changes nothing needs no commit',()=>{
  const st={v:1,items:{a:{kind:'open',day:4},b:{kind:'close'}}};
  assert.ok(core.opNoop(st,{id:'zz',doc:null}));                          // delete of a missing id
  assert.ok(core.opNoop(st,{id:'a',doc:{kind:'open',day:4}}));            // identical set
  assert.ok(core.opNoop(st,{id:'a',doc:{kind:'open',day:4,id:'a'}}));     // the id is not part of the doc
  assert.ok(!core.opNoop(st,{id:'a',doc:{kind:'open',day:5}}));
  assert.ok(!core.opNoop(st,{id:'c',doc:{kind:'open',day:4}}));
  assert.ok(!core.opNoop(st,{id:'a',doc:null}));
  assert.ok(core.opNoop({v:1,items:{}},{id:'a',doc:null}));
});
test('dmy + courseOk + dueLbl: course short name precedes the deadline title',()=>{
  assert.equal(core.dmy('2026-10-18'),'18.10.26');assert.equal(core.dmy('2027-03-13'),'13.03.27');
  assert.ok(core.courseOk('micro'));assert.ok(core.courseOk('eng'));
  for(const bad of ['','nope',undefined,null,3,'constructor','__proto__','toString'])assert.ok(!core.courseOk(bad),String(bad));
  assert.equal(core.dueName({title:'מטלה 1',course:'micro'}),'מיקרו · מטלה 1');
  assert.equal(core.dueName({title:'',course:'micro'}),'מיקרו');
  assert.equal(core.dueName({title:'מטלה 1'}),'מטלה 1');assert.equal(core.dueName({title:'מטלה 1',course:'nope'}),'מטלה 1');assert.equal(core.dueName({}),'');
  assert.equal(core.dueLbl({title:'מטלה 1',course:'micro'}),'הגשה: מיקרו · מטלה 1');
  assert.equal(core.dueLbl({title:'',course:'micro'}),'הגשה: מיקרו');
  assert.equal(core.dueLbl({title:'מטלה 1'}),'הגשה: מטלה 1');assert.equal(core.dueLbl({}),'הגשה');
  assert.equal(core.dueCls({course:'micro'}),'cd c-micro');assert.equal(core.dueCls({course:'nope'}),'');assert.equal(core.dueCls({}),'');
});
test('toDoc with a picked date: due and one-off follow f.date, not the shown week',()=>{
  const due={kind:'due',title:'מטלה',day:4,date:'2026-11-10',start:'',end:'',week:'A',note:'',updated:1};
  assert.equal(core.toDoc(due,'2026-10-25').date,'2026-11-10');                              // a date three weeks past the dialog's week
  const one=core.toDoc({kind:'open',title:'',day:4,date:'2027-03-13',start:'07:00',end:'15:00',week:'date',note:'',updated:5},'2026-10-25');
  assert.equal(one.date,'2027-03-13');assert.deepEqual(Object.keys(one).sort(),['date','end','kind','note','start','title','updated']);
  assert.equal(core.toDoc({...due,date:'2026-02-30'},'2026-10-25').date,'2026-10-29');         // not a valid ISO date: the old weekday-in-week rule
  assert.equal(core.toDoc({...due,date:''},'2026-10-25').date,'2026-10-29');assert.equal(core.toDoc({...due,date:undefined},'2026-10-25').date,'2026-10-29');
  const rec=core.toDoc({kind:'open',title:'',day:2,date:'2026-12-01',start:'07:00',end:'15:00',week:'A',note:'',updated:5},'2026-10-25');
  assert.equal(rec.date,undefined);assert.equal(rec.day,2);                                    // recurring ignores the date
});
test('toDoc: course on a deadline, omitted when none or unknown',()=>{
  const f={kind:'due',title:'מטלה',day:4,start:'23:59',week:'A',note:'',updated:1};
  assert.equal(core.toDoc({...f,course:'micro'},'2026-10-25').course,'micro');
  for(const c of ['',undefined,'nope','constructor'])assert.ok(!('course' in core.toDoc({...f,course:c},'2026-10-25')),String(c));
  assert.deepEqual(core.toDoc({...f,course:'math'},'2026-10-25'),{kind:'due',title:'מטלה',note:'',updated:1,date:'2026-10-29',start:'23:59',done:false,course:'math'});
  assert.ok(!('course' in core.toDoc({kind:'open',title:'',day:2,start:'07:00',end:'15:00',week:'date',note:'',updated:5,course:'micro'},'2026-10-25')));  // only a deadline has a course
  assert.ok(!('course' in core.toDoc({kind:'open',title:'',day:2,start:'07:00',end:'15:00',week:'both',note:'',updated:5,course:'micro'},'2026-10-25')));
});
test('detach with a picked date: the new doc gets it, the series skips the occurrence',()=>{
  const prev={id:'r1',kind:'close',title:'סגירה',day:4,start:'15:00',end:'23:00',week:'A',note:'',skip:[],updated:1};
  const f={kind:'close',title:'סגירה',day:2,date:'2026-12-08',start:'16:00',end:'23:00',week:'date',note:'',updated:9};
  const{one,series}=core.detach(prev,f,'2026-11-01','2026-11-05');
  assert.equal(one.date,'2026-12-08');assert.deepEqual(series.skip,['2026-11-05']);assert.equal(series.week,'A');
  const due=core.detach(prev,{...f,kind:'due',course:'acc',done:false},'2026-11-01','2026-11-05');
  assert.equal(due.one.date,'2026-12-08');assert.equal(due.one.course,'acc');assert.equal(due.one.kind,'due');
  assert.equal(core.detach(prev,{...f,date:undefined},'2026-11-01','2026-11-05').one.date,'2026-11-03');   // fallback: sun + day
});
test('detach clash check: the series stays in the compared items, minus the moved occurrence',()=>{ // what hint() does for "only on this date" on a series occurrence
  const series={id:'r1',kind:'close',title:'',day:4,start:'15:00',end:'23:00',week:'both',note:'',updated:1},occ='2026-11-05';
  const hits=(its,skip)=>core.evsForWeek('2026-11-08',its,skip).filter(o=>o.d===4&&900<o.e&&o.s<1380);              // a 16:00-23:00 block on Thu 12.11
  const its=[{...series,skip:[occ]}];                                                                                   // the series as it is after the save
  assert.equal(hits([series],'r1').length,0);                                                                           // old check: the whole series dropped, no clash seen
  assert.equal(hits(its,null).length,1);                                                                                // fixed check: the series' own 12.11 occurrence clashes
  const{one,series:ser}=core.detach(series,{kind:'close',title:'',day:4,date:'2026-11-12',start:'16:00',end:'23:00',week:'date',note:'',updated:2,done:false},'2026-11-01',occ);
  assert.ok(core.analyze(core.evsForWeek('2026-11-08',[{...one,id:'n1'},{...ser,id:'r1'}])).bad.length>0);             // and the saved result really does clash
  assert.equal(core.evsForWeek('2026-11-01',its).filter(o=>o.d===4).length,0);                                          // the moved occurrence itself (05.11) is gone, so moving it within its own week is no false clash
});
test('upcoming carries the course of a deadline',()=>{
  const items=[{id:'d1',kind:'due',date:'2027-01-20',start:'23:59',title:'מטלה 3',course:'micro'},{id:'d2',kind:'due',date:'2027-01-20',start:'23:58',course:'math'},
    {id:'d3',kind:'due',date:'2027-01-20',start:'23:57',title:'בלי',course:'nope'},{id:'d4',kind:'due',date:'2027-01-20',start:'23:56'}];
  const L=core.upcoming('2027-01-19',items,10),by=id=>L.find(x=>x.id===id);
  assert.equal(by('d1').course,'micro');assert.equal(by('d1').title,'מיקרו · מטלה 3');assert.equal(by('d1').tag,'הגשה');
  assert.equal(by('d2').course,'math');assert.equal(by('d2').title,"מתמטיקה");                // no title: just the short name
  assert.ok(!by('d3').course);assert.equal(by('d3').title,'בלי');                             // unknown id: treated as none
  assert.ok(!by('d4').course);assert.equal(by('d4').title,'הגשה');                             // as before
  assert.ok(L.filter(x=>x.exam).every(x=>!x.course));
});
test('dayLines + lineTxt: a deadline with a course takes its colour and name',()=>{
  const d=core.dayLines('2026-10-27',[{id:'a',kind:'due',date:'2026-10-27',title:'מטלה',note:'n',course:'micro'},{id:'b',kind:'due',date:'2026-10-27',course:'ob'},
    {id:'c',kind:'due',date:'2026-10-27',title:'x',course:'nope'},{id:'e',kind:'due',date:'2026-10-27',title:'y'}]);
  const L=Object.fromEntries(d.map(l=>[l.id,l]));
  assert.equal(L.a.title,'מטלה');assert.equal(L.a.course,'micro');
  assert.deepEqual(core.lineTxt(L.a),{col:'--c-micro',ttl:'הגשה: מיקרו · מטלה',meta:'n'});
  assert.deepEqual(core.lineTxt(L.b),{col:'--c-ob',ttl:'הגשה: התנהגות ארגונית',meta:''});
  assert.deepEqual(core.lineTxt(L.c),{col:'--bad-bd',ttl:'הגשה: x',meta:''});
  assert.deepEqual(core.lineTxt(L.e),{col:'--bad-bd',ttl:'הגשה: y',meta:''});
});
test('export: the course short name goes into the deadline title',()=>{
  const items=[{id:'d',kind:'due',date:'2026-11-05',start:'23:59',title:'מטלה, 1',course:'micro'},{id:'e',kind:'due',date:'2026-11-06',start:'23:59',course:'acc'},{id:'f',kind:'due',date:'2026-11-07',start:'23:59',title:'בלי',course:'nope'}];
  const sm=id=>core.semEvents(items).find(x=>x.uid.startsWith('u'+id+'-')).summary;
  assert.equal(sm('d'),'הגשה: מיקרו · מטלה, 1');assert.equal(sm('e'),'הגשה: חשבונאות');assert.equal(sm('f'),'הגשה: בלי');
  assert.ok(core.buildIcs(items,'20261008T000000Z').includes('SUMMARY:הגשה: מיקרו · מטלה\\, 1'));
  assert.ok(core.buildCsv(items).split('\r\n').includes('"הגשה: מיקרו · מטלה, 1","11/05/2026","11:29 PM","11/05/2026","11:59 PM","",""'));
});

test('shiftMonths: monthly shift hours over the semester',()=>{
  const A={id:'a',kind:'anchor',date:'2026-10-18',updated:1};
  const sh=(id,o)=>({id,kind:'open',title:'',start:'08:00',end:'16:00',note:'',updated:1,...o});
  const none=core.shiftMonths([]);
  assert.deepEqual(none.rows.map(r=>r.ym),['2026-10','2026-11','2026-12','2027-01','2027-02','2027-03']);
  assert.equal(none.min,0);assert.equal(none.n,0);assert.ok(none.rows.every(r=>r.min===0&&r.n===0));
  // a "both" shift on Mondays: Mondays from 19.10.26 to 08.03.27
  const mon=core.shiftMonths([sh('m',{day:1,week:'both'})]);
  assert.equal(mon.rows.find(r=>r.ym==='2026-10').n,2);   // 19.10, 26.10
  assert.equal(mon.rows.find(r=>r.ym==='2026-11').n,5);   // 2,9,16,23,30
  assert.equal(mon.n,mon.rows.reduce((a,r)=>a+r.n,0));assert.equal(mon.min,mon.n*480);
  // A/B docs of the retired rotation count every week, anchor or not
  assert.equal(core.shiftMonths([sh('x',{day:1,week:'A'})]).n,mon.n);
  const ab=core.shiftMonths([A,sh('x',{day:1,week:'A'}),sh('y',{day:2,week:'B'})]);
  let want=0;for(let sun='2026-10-18';sun<='2027-03-13';sun=core.addDays(sun,7))want+=1;
  assert.equal(ab.n,2*want);                               // Monday and Tuesday, every week
  assert.ok(ab.rows.find(r=>r.ym==='2026-10').n===4);      // 19, 20, 26, 27.10
  // skipped, one-off, non-shift kinds, overnight
  const sk=core.shiftMonths([sh('m',{day:1,week:'both',skip:['2026-10-19']})]);
  assert.equal(sk.rows.find(r=>r.ym==='2026-10').n,1);
  const one=core.shiftMonths([sh('o',{date:'2026-12-31',end:'02:00',kind:'close',start:'18:00'})]);
  assert.equal(one.rows.find(r=>r.ym==='2026-12').n,1);assert.equal(one.rows.find(r=>r.ym==='2026-12').min,480);assert.equal(one.rows.find(r=>r.ym==='2027-01').n,0); // counted in the month it starts
  assert.equal(core.shiftMonths([sh('s',{day:1,week:'both',kind:'study'}),sh('d',{day:1,week:'both',kind:'other'})]).n,0);
  assert.equal(core.shiftMonths([sh('late',{date:'2027-03-20'}),sh('early',{date:'2026-09-30'})]).n,0); // outside the counted range
  const pre=core.shiftMonths([sh('p1',{date:'2026-10-01',start:'20:18',end:'03:23'}),sh('p2',{date:'2026-10-17'}),sh('r',{day:1,week:'both'})]);
  assert.equal(pre.rows[0].n,2+2);assert.equal(pre.rows[0].min,(425+480)+480*2); // one-offs from 1.10 (20:18-03:23 = 7h05); the recurring Monday series only from 19.10, so 19.10 + 26.10
});

const MOODLE=`נובמבר 2026דצמבר   ◀︎
אירוע אחד, 1/11/20261
  [יש להגיש את 'תרגיל 1 - מאזן'](https://mama.mta.ac.il/mod/assign/view.php?id=31872)
אין אירועים, 3/11/20263
3 אירועים, 9/11/20269
  [יש להגיש את 'הגשת תעודת סיום קורס אקסל למתחילים קמפוס IL - הגשת חובה'](https://mama.mta.ac.il/mod/assign/view.php?id=28781)
  [יש להגיש את 'הגשת 2 קובצי תרגול'](https://mama.mta.ac.il/mod/assign/view.php?id=29563)
  [יש להגיש את 'הגשת תרגיל 1'](https://mama.mta.ac.il/mod/assign/view.php?id=33609)
אירוע אחד, 12/11/202612
  [יש להגיש את 'מטלה 3- המשך עקומת התמורה'](https://mama.mta.ac.il/mod/assign/view.php?id=34072)
אירוע אחד, 19/11/202619
  יש להגיש את 'מטלה א''`;
test('parseMoodle: dates glued to a day number, several events a day, links or plain text',()=>{
  const L=core.parseMoodle(MOODLE);
  assert.deepEqual(L.map(x=>x.date+' '+x.title),[
    '2026-11-01 תרגיל 1 - מאזן',
    '2026-11-09 הגשת תעודת סיום קורס אקסל למתחילים קמפוס IL - הגשת חובה',
    '2026-11-09 הגשת 2 קובצי תרגול',
    '2026-11-09 הגשת תרגיל 1',
    '2026-11-12 מטלה 3- המשך עקומת התמורה',
    "2026-11-19 מטלה א'"]);                                  // "20261" -> 2026; a title that ends in an apostrophe survives
  assert.deepEqual(core.parseMoodle(''),[]);assert.deepEqual(core.parseMoodle(undefined),[]);
  assert.deepEqual(core.parseMoodle("יש להגיש את 'x'"),[]);                  // no date line yet: nothing to attach it to
  assert.deepEqual(core.parseMoodle("אירוע אחד, 31/02/2026\nיש להגיש את 'x'"),[]); // an impossible date
  assert.equal(core.parseMoodle("1/12/2026\nיש להגיש את 'x'\nיש להגיש את 'x'").length,1); // the same line twice on a day is one deadline
  assert.deepEqual(core.parseMoodle("2/12/2026 יש להגיש את 'y'"),[{date:'2026-12-02',title:'y'}]); // date and title on one line
});
test('guessCourse: from the title, empty when unknown',()=>{
  const g=core.guessCourse;
  assert.equal(g('תרגיל 1 - מאזן'),'acc');assert.equal(g('תרגיל 4 - פקודות יומן'),'acc');
  assert.equal(g('מטלה 3- המשך עקומת התמורה'),'micro');assert.equal(g('מטלה 4- גורמי ייצור משלימים'),'micro');
  assert.equal(g('הגשת תעודת סיום קורס אקסל למתחילים'),'data');assert.equal(g('הגשה מיון, סינון, תרשימים'),'data');
  assert.equal(g('הגשת קובץ אתגר סדנת כלי עיבוד וניתוח נתונים'),'data');assert.equal(g('הגשת קובץ אתגר סדנת אקסל מתקדמים'),'data');
  assert.equal(g('מטלה 1'),'');assert.equal(g(''),'');assert.equal(g(undefined),'');
});
test('deadline status: two states, done is the only stored flag',()=>{
  const d=core.dueSt;
  assert.equal(d({}),'todo');assert.equal(d({done:true}),'done');assert.equal(d({status:'doing'}),'todo');assert.equal(d({status:'done'}),'todo');assert.equal(d(undefined),'todo');
  assert.deepEqual(Object.keys(core.STAT),['todo','done']);
  const f={kind:'due',title:'מטלה',day:4,start:'23:59',week:'A',note:'',updated:1};
  assert.deepEqual(core.toDoc({...f,status:'done'},'2026-10-25'),{kind:'due',title:'מטלה',note:'',updated:1,date:'2026-10-29',start:'23:59',done:true});
  assert.deepEqual(core.toDoc({...f,status:'todo'},'2026-10-25'),{kind:'due',title:'מטלה',note:'',updated:1,date:'2026-10-29',start:'23:59',done:false});
  assert.equal(core.toDoc({...f,status:'todo',done:true},'2026-10-25').done,false);   // the dialog's status wins over a carried done flag
  assert.equal(core.toDoc({...f,status:'zzz',done:true},'2026-10-25').done,true);     // an unknown status falls back to the done flag
  assert.ok(!('status' in core.toDoc({...f,status:'done'},'2026-10-25')));
  const dl={kind:'due',date:'2026-11-10'};
  assert.equal(core.dueLate(dl,'2026-11-11'),true);assert.equal(core.dueLate(dl,'2026-11-10'),false);
  assert.equal(core.dueLate({...dl,done:true},'2026-11-11'),false);
  assert.equal(core.dueLate({kind:'open',date:'2026-11-10'},'2026-11-11'),false);
  assert.equal(core.dayLines('2026-11-10',[{id:'a',kind:'due',date:'2026-11-10',title:'x',done:true}]).find(l=>l.id==='a').st,'done');
});
test('submitted: the record under what is coming, newest first',()=>{
  const items=[{id:'a',kind:'due',date:'2026-11-01',title:'ישנה',done:true},{id:'b',kind:'due',date:'2026-11-12',title:'חדשה',done:true,course:'micro'},
    {id:'c',kind:'due',date:'2026-11-05',title:'פתוחה'},{id:'d',kind:'open',date:'2026-11-06',done:true},{id:'e',kind:'due',date:'bad',done:true}];
  const S=core.submitted(items);
  assert.deepEqual(S.map(x=>x.id),['b','a']);assert.equal(S[0].title,'מיקרו · חדשה');assert.equal(S[0].course,'micro');assert.equal(S[0].st,'done');
  assert.deepEqual(core.submitted([]),[]);
});
test('upcoming: late deadlines first (all of them), then the next n',()=>{
  const items=[
    {id:'l1',kind:'due',date:'2026-11-12',title:'ישנה'},{id:'l2',kind:'due',date:'2026-11-01',title:'ישנה מאוד'},
    {id:'ok',kind:'due',date:'2026-11-05',title:'הוגשה',done:true},{id:'f1',kind:'due',date:'2026-11-15',title:'קרובה'},{id:'f2',kind:'due',date:'2026-11-16',title:'אחריה'}];
  const L=core.upcoming('2026-11-14',items,1);
  assert.deepEqual(L.map(x=>x.id||x.key),['l2','l1','f1']);                    // late oldest first, then n=1 upcoming (the exams are in 2027)
  assert.deepEqual(L.map(x=>x.daysLeft),[-13,-2,1]);assert.deepEqual(L.map(x=>!!x.late),[true,true,false]);
  assert.equal(L[0].st,'todo');assert.equal(core.upcoming('2026-11-14',[{id:'z',kind:'due',date:'2026-11-01',done:true}],6).some(x=>x.id==='z'),false);
});
test('parseMoodle: a date inside a title or a link URL does not move the day block; CRLF',()=>{
  const t=`אירוע אחד, 15/11/2026\r\n  [יש להגיש את 'דוח עד 1/12/2026'](https://x/3/4/2026/y)\r\nאירוע אחד, 16/11/2026\r\n  [יש להגיש את 'ב'](https://x)`;
  assert.deepEqual(core.parseMoodle(t),[{date:'2026-11-15',title:'דוח עד 1/12/2026'},{date:'2026-11-16',title:'ב'}]);
  assert.equal(core.parseMoodle("1/12/2026\n"+Array.from({length:3000},(_,i)=>"יש להגיש את 'a"+i+"'").join('\n')).length,3000); // many rows: no quadratic dedupe
});
test('ghWhy + ghMsg: which part of the key to fix',()=>{
  const w=core.ghWhy;
  assert.equal(w('read',401),'token');assert.equal(w('repo',401),'token');assert.equal(w('write',401),'token');
  assert.equal(w('repo',404),'repo');assert.equal(w('repo',403),'repo');            // the private repo is not visible to the key
  assert.equal(w('read',403),'perm');                                              // the repo is visible but Contents is not granted
  assert.equal(w('write',403),'write');assert.equal(w('write',404),'write');        // Contents read-only
  assert.equal(w('read',403,true),'rate');assert.equal(w('write',429,true),'rate');
  assert.equal(w('read',500),'');assert.equal(w('write',409),'');
  for(const k of ['token','repo','perm','write'])assert.match(core.ghMsg(k,'o','r',403),/\(קוד 403\)$/);
  assert.match(core.ghMsg('repo','pavelkovrov-eng','weekplan-data'),/pavelkovrov-eng\/weekplan-data/);
  assert.match(core.ghMsg('perm','o','r'),/Read and write/);assert.match(core.ghMsg('write','o','r'),/Read-only/);
  assert.equal(core.ghMsg('',  'o','r'),'');
  assert.match(core.ghMsg('public','pavelkovrov-eng','weekplan'),/ציבורי.*weekplan-data/);assert.ok(core.GH_AUTH.includes('public'));
});
