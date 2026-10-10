# תאריכים אמיתיים, מבחנים והגשות, ייצוא ליומן — תוכנית מימוש

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** הדף מציג שבוע קלנדרי אמיתי: הרוטציה א'/ב' מחושבת מעוגן, ימים בלי לימודים ויום ההשלמה מסומנים, יש מבחנים והגשות עם ספירה לאחור, פריטים חד-פעמיים ודילוגים, וייצוא של כל הסמסטר ל-Google (CSV) ול-Apple (`.ics` בתוך zip).

**Architecture:** קובץ HTML יחיד. הלוגיקה הטהורה עוברת ל-`<script id="core">`, בלי גישה ל-DOM ברמה העליונה, כך שאפשר לבדוק אותה ב-Node. הסקריפט השני מטפל בתצוגה, בדיאלוג ובשמירה. כל נתוני המשתמש נשמרים באוסף `items` אחד, וסוג המסמך נקבע לפי השדות שבו. הנתונים האקדמיים (SEM/CAL/EXAMS) נעולים בקוד, כמו `BASE`.

**Tech Stack:** HTML/CSS/JS בלי ספריות. `window.claude` עם `db`, `user` ו-`downloads`. הבדיקות רצות ב-`node:test` (Node 26).

**Spec:** `docs/superpowers/specs/2026-10-08-real-dates-design.md`

## Global Constraints

- קובץ אחד: `תכנון השבוע בסמסטר א'.html`. בלי build ובלי תלויות חדשות. בשורת הפקודה צריך לשים את שם הקובץ במירכאות כפולות.
- כל הטקסט בממשק בעברית, RTL. כל מחרוזת שמגיעה מהמשתמש עוברת `esc()` לפני `innerHTML`.
- צבע חדש מוגדר בשלושה מקומות: `:root`, `@media (prefers-color-scheme:dark){:root:not([data-theme="light"])`, ו-`:root[data-theme="dark"]`.
- ב-`<script id="core">` יש רק הגדרות `const`/`function`. אין קריאה ל-DOM או ל-`localStorage` ברמה העליונה.
- מסמכים קיימים ב-db (עם `week`, בלי `date` ובלי `skip`) חייבים להמשיך לעבוד בלי מיגרציה.
- קוד דחוס בסגנון הקיים: עוזרים קצרים (`$`, `fm`, `tr`), ביטויים ארוכים בשורה אחת.
- בפרסום: `capabilities: {db:{}, user:{}, downloads:true}`. אובייקט לא ריק מחליף את כל ההצהרה הקודמת, אז שלושתם חייבים להופיע.
- הבדיקות: `node --test test.mjs`. בדיקה בודדת: `node --test --test-name-pattern="<name>" test.mjs`.

## Review Focus

1. **מסמכים ישנים או פגומים ב-db החי.** `kind` לא מוכר, `date` לא תקין, או מסמך בלי `week` ובלי `date`: המסמך מוצג כ"אחר" או מדולג, והדף לא קורס. הבדיקה ב-Task 2: `tolerates old and malformed docs`.
2. **עוד לא נקבע עוגן.** מוצגים רק פריטי "שני השבועות", יש באנר, ושום דבר לא נשבר. הבדיקה ב-Task 2: `no anchor: only both-weeks items`.
3. **משמרת לילה במוצאי שבת, בלילה שבו עוברים לשעון חורף (24→25.10).** DTEND צריך ליפול ב-25.10 בשעה 02:00 מקומית. הבדיקה ב-Task 6: `ics`.
4. **פתיחת הדף מחוץ לטווח.** היום (8.10) הוא לפני הסמסטר, ויכול להיות גם תאריך אחרי 07.03. הדף צריך לעבור לשבוע הקרוב בטווח, ו"מה מתקרב" ריק בלי שגיאה. הבדיקה ב-Task 2: `clampSun` ו-`upcoming`.
5. **עברית, גרשיים, פסיקים ושורות חדשות בכותרות** ב-CSV וב-ICS: escape נכון וקיפול שורות לפי בתים. הבדיקה ב-Task 6: `ics` ו-`csv`.

---

### Task 0: git לפני שמתחילים

**Files:** כל התיקייה.

- [ ] **Step 1: init + snapshot**

```bash
cd /Users/pavelkovrov/Desktop/WeekPlan && git init && git add -A && git commit -m "chore: snapshot week planner before real-dates work"
```
Expected: `[main (root-commit) …]` או `[master …]`, ו-3 קבצים (HTML, ‏CLAUDE.md, ‏docs).

---

### Task 1: פיצול `core` + עזרי תאריכים + רתמת בדיקות

**Files:**
- Modify: `תכנון השבוע בסמסטר א'.html:321-362` (פותחים `<script id="core">` סביב הקבועים והעזרים)
- Create: `test.mjs`

**Interfaces:**
- Produces: `D0(iso)→ms`, `isoOf(ms)→iso`, `isoOk(s)→bool`, `addDays(iso,n)→iso`, `dow(iso)→0..6`, `sunOf(iso)→iso`, `dayDiff(a,b)→int`, `wkDiff(a,b)→int`, `dm(iso)→'25.10'`, `todayIso()→iso` (Asia/Jerusalem). כל ה-`const` וה-`function` ב-core זמינים כגלובליים לסקריפט השני, וב-`test.mjs` דרך `core.<name>`.

- [ ] **Step 1: כתיבת בדיקה שנכשלת** — יוצרים `test.mjs`:

```js
// Run: node --test test.mjs   ·   one test: node --test --test-name-pattern="dates" test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL("./תכנון השבוע בסמסטר א'.html",import.meta.url),'utf8');
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
```

- [ ] **Step 2: להריץ ולוודא כישלון**

Run: `cd /Users/pavelkovrov/Desktop/WeekPlan && node --test test.mjs`
Expected: FAIL עם `no <script id="core"> in page`

- [ ] **Step 3: מימוש.** ב-HTML מחליפים את פתיחת הסקריפט:

old:
```
<script>
const DAYS=['ראשון',
```
new:
```
<script id="core">
const DAYS=['ראשון',
```

ואת המעבר מהעזרים למצב האפליקציה (השורה `const tr=…`, שורה ריקה, `let items=…`):

old:
```
const tr=(s,e)=>fm(s)+'–'+fm(e)+(e>1440?' (למחרת)':'');

let items=[]
```
new:
```
const tr=(s,e)=>fm(s)+'–'+fm(e)+(e>1440?' (למחרת)':'');

/* ---------- dates: ISO yyyy-mm-dd, UTC math so DST never shifts a day ---------- */
const D0=iso=>{const[y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d)};
const isoOf=t=>new Date(t).toISOString().slice(0,10);
const isoOk=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&isoOf(D0(s))===s;
const addDays=(iso,n)=>isoOf(D0(iso)+n*864e5);
const dow=iso=>new Date(D0(iso)).getUTCDay();
const sunOf=iso=>addDays(iso,-dow(iso));
const dayDiff=(a,b)=>Math.round((D0(b)-D0(a))/864e5);
const wkDiff=(a,b)=>Math.round(dayDiff(a,b)/7);
const dm=iso=>iso.slice(8)+'.'+iso.slice(5,7);
const todayIso=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date());
</script>
<script>
let items=[]
```

- [ ] **Step 4: להריץ ולוודא הצלחה**

Run: `node --test test.mjs`
Expected: `# pass 2`, ‏`# fail 0`

- [ ] **Step 5: Commit**

```bash
git add test.mjs "תכנון השבוע בסמסטר א'.html" && git commit -m "refactor: split pure core script, add date helpers and node tests"
```

---

### Task 2: מודל — לוח אקדמי, רוטציה, שבוע מתוארך

**Files:**
- Modify: `תכנון השבוע בסמסטר א'.html`: מוסיפים ל-core לפני `</script>` הראשון, ומוחקים מהסקריפט השני את `analyze` ואת `stats`
- Test: `test.mjs`

**Interfaces:**
- Consumes: עזרי התאריכים מ-Task 1, ‏`BASE`, ‏`KINDS`, ‏`BKIND`, ‏`span`, ‏`toMin`, ‏`okTime`.
- Produces:
  - `SEM={start,end,last}`, `CAL{iso:{off?,as?,label}}`, `EXAMS[{c,m,date,s}]`, `EXAM_MIN=180`, `SPECIAL{due,off,anchor}`.
  - `isRec(doc)→bool`, `lastSun`, `clampSun(sun)→sun`.
  - `anchorOf(items)→iso|null`, `rot(sun,anchor)→'A'|'B'|null`, `offDoc(iso,items)→doc|undefined`, `baseDay(iso,items)→0..6|null`.
  - `evsForWeek(sun,items,skipId?)→Event[]`, כאשר `Event={src:'base'|'exam'|'user', key, d, date, s, e, title, kind, room?, moed?, id?, note?, week?:'A'|'B'|'both'|'date'}`.
  - `upcoming(today,items,n=6)→[{key,date,time,title,tag,exam?,id?,daysLeft}]`.
  - `analyze(evs)→{bad,soft,clash:Set}`, `stats(evs)→{cls,ex,sh,shN,st,oth,studyDays,freeNames,total}`.

- [ ] **Step 1: בדיקות שנכשלות** — מוסיפים בסוף `test.mjs`:

```js
const A='2026-10-18';
test('rot',()=>{
  assert.equal(core.rot('2026-10-18',A),'A');assert.equal(core.rot('2026-10-25',A),'B');
  assert.equal(core.rot('2026-10-11',A),'B');assert.equal(core.rot('2026-10-04',A),'A');
  assert.equal(core.rot('2026-10-18',null),null);
  assert.equal(core.anchorOf([{kind:'anchor',date:'2026-10-18',updated:1},{kind:'anchor',date:'2026-10-25',updated:2}]),'2026-10-25');
  assert.equal(core.anchorOf([]),null);
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
  assert.deepEqual(w1.filter(e=>e.src==='user').map(e=>e.id).sort(),['o1','r1']);
  assert.equal(w1.find(e=>e.id==='o1').date,'2026-10-24');
  assert.equal(w1.find(e=>e.id==='o1').week,'date');
  assert.equal(w1.filter(e=>e.src==='base').length,13);
  const w2=core.evsForWeek('2026-10-25',items);
  assert.deepEqual(w2.filter(e=>e.src==='user').map(e=>e.id).sort(),['r2','r3']);
  assert.equal(w2.filter(e=>e.src==='base'&&e.d===2).length,0);
  const mk=core.evsForWeek('2027-01-17',items);
  assert.deepEqual(mk.filter(e=>e.src==='base').map(e=>e.d),[0,0,0]);
  const ex=core.evsForWeek('2027-01-17',[]).filter(e=>e.src==='exam');
  assert.equal(ex.length,1);assert.equal(ex[0].date,'2027-01-22');assert.equal(ex[0].e-ex[0].s,180);assert.equal(ex[0].room,"מועד א'");
});
test('tolerates old and malformed docs',()=>{
  const w=core.evsForWeek('2026-10-18',[{id:'old',kind:'weird',day:1,start:'10:00',end:'11:00',week:'both'},
    {id:'bad',kind:'open',date:'2026-13-01',start:'10:00',end:'11:00'},{id:'nod',kind:'open',start:'10:00',end:'11:00'},
    {id:'a',kind:'anchor',date:'garbage'}]);
  assert.deepEqual(w.filter(e=>e.src==='user').map(e=>[e.id,e.kind]),[['old','other']]);
});
test('no anchor: only both-weeks items',()=>{
  const w=core.evsForWeek('2026-10-18',[{id:'a',kind:'open',day:4,start:'07:00',end:'15:00',week:'A'},{id:'b',kind:'study',day:5,start:'10:00',end:'12:00',week:'both'}]);
  assert.deepEqual(w.filter(e=>e.src==='user').map(e=>e.id),['b']);
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
  assert.equal(s.cls,330);assert.equal(s.ex,180);assert.equal(s.total,510);assert.equal(s.studyDays,1);
  const an=core.analyze(core.evsForWeek('2027-01-17',[{id:'s',kind:'open',date:'2027-01-22',start:'08:00',end:'12:00'}]));
  assert.equal(an.bad.length,1);assert.ok(an.bad[0].includes("מועד א'"));assert.ok(an.clash.has('x0'));
});
```

- [ ] **Step 2: להריץ ולוודא כישלון**

Run: `node --test test.mjs`
Expected: FAIL. ‏`core.rot is not a function` ושגיאות דומות

- [ ] **Step 3: מימוש ב-core.** מוסיפים לפני `</script>` של core (אחרי `todayIso`):

```js
/* ---------- academic calendar: MTA תשפ"ז, locked like BASE ---------- */
const SEM={start:'2026-10-18',end:'2027-01-15',last:'2027-03-13'};
const CAL={
  '2026-10-27':{off:1,label:'בחירות לכנסת (משוער)'},
  '2027-01-17':{as:2,label:'יום השלמה · מערכת של שלישי'}
};
const EXAMS=[ // mtamn.mta.ac.il exam search, תשפ"ז. Live system: dates can still move.
 {c:'מבוא למיקרו',m:'א',date:'2027-01-22',s:'09:00'},{c:'מבוא למיקרו',m:'ב',date:'2027-02-18',s:'09:00'},
 {c:'הסתברות וסטטיסטיקה',m:'א',date:'2027-01-27',s:'09:00'},{c:'הסתברות וסטטיסטיקה',m:'ב',date:'2027-02-22',s:'09:00'},
 {c:"מתמטיקה א'",m:'א',date:'2027-02-01',s:'09:00'},{c:"מתמטיקה א'",m:'ב',date:'2027-02-26',s:'09:00'},
 {c:'כלי ניתוח נתונים ו-AI',m:'א',date:'2027-02-05',s:'09:00'},{c:'כלי ניתוח נתונים ו-AI',m:'ב',date:'2027-03-01',s:'14:00'},
 {c:"חשבונאות א'",m:'א',date:'2027-02-10',s:'09:00'},{c:"חשבונאות א'",m:'ב',date:'2027-03-05',s:'09:00'},
 {c:'יסודות התנהגות ארגונית',m:'א',date:'2027-02-14',s:'14:00'},{c:'יסודות התנהגות ארגונית',m:'ב',date:'2027-03-08',s:'14:00'}
];
const EXAM_MIN=180; // ponytail: assumed 3h; the listing gives start time only
const SPECIAL={due:1,off:1,anchor:1};
const isRec=x=>x.week==='A'||x.week==='B'||x.week==='both';
const lastSun=sunOf(SEM.last);
const clampSun=s=>s<SEM.start?SEM.start:s>lastSun?lastSun:s; // own line: test.mjs exports only the first name per const

/* ---------- model ---------- */
function anchorOf(items){const a=items.filter(x=>x.kind==='anchor'&&isoOk(x.date)).sort((p,q)=>(q.updated||0)-(p.updated||0))[0];return a?a.date:null}
function rot(sun,anchor){return anchor?(((wkDiff(sunOf(anchor),sun)%2)+2)%2?'B':'A'):null}
function offDoc(iso,items){return items.find(x=>x.kind==='off'&&x.date===iso)}
function baseDay(iso,items){
  if(offDoc(iso,items))return null;
  const c=CAL[iso];
  if(c&&c.as!=null)return c.as;
  if(iso<SEM.start||iso>SEM.end||c&&c.off)return null;
  return dow(iso);
}
function evsForWeek(sun,items,skipId){
  const out=[],wk=rot(sun,anchorOf(items));
  for(let d=0;d<7;d++){
    const date=addDays(sun,d),bd=baseDay(date,items);
    if(bd!=null)BASE.forEach((b,i)=>{if(b.d!==bd)return;const[s,e]=span(b.s,b.e);out.push({src:'base',key:'b'+i,d,date,s,e,title:b.t,kind:b.k,room:b.r})});
    EXAMS.forEach((x,i)=>{if(x.date!==date)return;const s=toMin(x.s);out.push({src:'exam',key:'x'+i,d,date,s,e:s+EXAM_MIN,title:x.c,kind:'exam',moed:x.m,room:'מועד '+x.m+"'"})});
  }
  items.forEach(it=>{
    if(it.id===skipId||SPECIAL[it.kind])return;
    if(!okTime(it.start)||!okTime(it.end))return;
    let d,date;
    if(isRec(it)){
      if(!(it.week==='both'||it.week===wk))return;
      d=Number(it.day);if(!(d>=0&&d<=6))return;date=addDays(sun,d);
      if(Array.isArray(it.skip)&&it.skip.includes(date))return;
    }else if(isoOk(it.date)&&sunOf(it.date)===sun){date=it.date;d=dow(date)}
    else return;
    const[s,e]=span(it.start,it.end),kind=KINDS[it.kind]?it.kind:'other';
    out.push({src:'user',key:'u'+it.id,id:it.id,d,date,s,e,title:it.title||KINDS[kind].label,kind,note:it.note||'',week:isRec(it)?it.week:'date'});
  });
  return out;
}
function upcoming(today,items,n=6){
  return EXAMS.map((x,i)=>({key:'x'+i,date:x.date,time:x.s,title:x.c,tag:'מועד '+x.m+"'",exam:1}))
    .concat(items.filter(x=>x.kind==='due'&&isoOk(x.date)&&!x.done).map(x=>({key:'u'+x.id,id:x.id,date:x.date,time:okTime(x.start)?x.start:'23:59',title:x.title||'הגשה',tag:'הגשה'})))
    .filter(x=>x.date>=today).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:a.time<b.time?-1:a.time>b.time?1:0)
    .slice(0,n).map(x=>({...x,daysLeft:dayDiff(today,x.date)}));
}
function analyze(evs){
  const bad=[],soft=[],clash=new Set();
  const lbl=o=>o.src==='base'?' · '+(BKIND[o.kind]||'אנגלית'):o.src==='exam'?' · '+o.room:'';
  for(let i=0;i<evs.length;i++)for(let j=i+1;j<evs.length;j++){
    const a=evs[i],b=evs[j];
    if(a.d!==b.d||a.src!=='user'&&b.src!=='user')continue;
    if(a.s<b.e&&b.s<a.e){
      clash.add(a.key);clash.add(b.key);
      const u=a.src==='user'?a:b,o=u===a?b:a;
      bad.push(`חפיפה ב${DAYS[u.d]}: ${u.title} ${tr(u.s,u.e)} ו${o.title}${lbl(o)} ${tr(o.s,o.e)}`);
    }
  }
  evs.filter(e=>e.src==='user').forEach(u=>{
    let best=null;
    if(u.kind!=='study')evs.forEach(b=>{
      if(b.src==='user'||b.d!==u.d)return;
      const g=u.s>=b.e?u.s-b.e:(b.s>=u.e?b.s-u.e:null);
      if(g!==null&&g<30&&(!best||g<best.g))best={g,b,after:u.s>=b.e};
    });
    if(best&&!clash.has(u.key)){
      const gap=best.g?`רק ${best.g} דק'`:'אין הפסקה';
      soft.push(best.after
        ?`ב${DAYS[u.d]}: ${gap} בין סוף ${best.b.title} (${fm(best.b.e)}) לתחילת ${u.title}. זה לא משאיר זמן לנסיעה.`
        :`ב${DAYS[u.d]}: ${gap} בין סוף ${u.title} לתחילת ${best.b.title} (${fm(best.b.s)}).`);
    }
    if(u.e>=1320){
      const nd=(u.d+1)%7, nx=evs.filter(x=>x.d===nd).sort((p,q)=>p.s-q.s)[0];
      if(nx){const g=1440+nx.s-u.e; if(g<600)soft.push(`ב${DAYS[u.d]}: ${u.title} עד ${fm(u.e)}, ו${nx.title} ב${DAYS[nd]} מ-${fm(nx.s)}. ${hrs(g)} שעות ביניהם, כולל נסיעה ושינה.`)}
    }
  });
  return{bad,soft,clash};
}
function stats(evs){
  let cls=0,ex=0,sh=0,shN=0,st=0,oth=0;
  evs.forEach(e=>{const m=e.e-e.s;if(e.src==='base')cls+=m;else if(e.src==='exam')ex+=m;else if(KINDS[e.kind].shift){sh+=m;shN++}else if(e.kind==='study')st+=m;else oth+=m});
  const freeNames=DAYS.filter((_,i)=>!evs.some(e=>e.d===i));
  const studyDays=new Set(evs.filter(e=>e.src==='base').map(e=>e.d)).size;
  return{cls,ex,sh,shN,st,oth,studyDays,freeNames,total:cls+ex+sh+st+oth};
}
```

אחר כך, בסקריפט השני, מוחקים את הטווח מ-`function analyze(evs){` ועד השורה שלפני `/* ---------- render ---------- */`. הטווח כולל את `analyze` ואת `stats`. ‏`evsFor` נשאר בינתיים, כי `render` עדיין משתמש בו.

- [ ] **Step 4: להריץ ולוודא הצלחה**

Run: `node --test test.mjs`
Expected: `# fail 0` (‏10 בדיקות)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: academic calendar, rotation anchor and dated week model in core"
```

---

### Task 3: ניווט לפי תאריך, גריד מתוארך ומבחנים בתצוגה

**Files:**
- Modify: `תכנון השבוע בסמסטר א'.html` (CSS, ‏markup של הסרגל, ‏legend, ‏footer והסקריפט השני)
- Create: `.claude/launch.json`

**Interfaces:**
- Consumes: כל מה ש-Task 2 מייצא.
- Produces: גלובלים בסקריפט השני: `viewSun` (יום ראשון של השבוע המוצג), `go(sun)`, `setAnchor('A'|'B')`, `dayHead(date,i,baseEvs)→html`, `saveItem(id,data,msg?)`. ‏`WKN.date='תאריך אחד'`.

- [ ] **Step 1: טוקנים.** מוסיפים אחרי כל אחת משלוש השורות `--night:` (`:root`, ‏dark media, ‏`[data-theme="dark"]`):

ב-`:root` (בהיר):
```css
  --exam-bg:#1e293b; --exam-bd:#0f172a; --exam-tx:#f8fafc; --exam-edge:#334155;
```
בשני בלוקי הכהה:
```css
  --exam-bg:#e2e8f0; --exam-bd:#f8fafc; --exam-tx:#0f172a; --exam-edge:#cbd5e1;
```

- [ ] **Step 2: CSS.** מוחקים את ארבע שורות `.seg …` (‏`.seg{`, ‏`.seg button{`, ‏`.seg button[aria-pressed="true"]{`, ‏`.seg button small{`), ומוסיפים אחרי השורה `.blk.u-other{…}`:

```css
.blk.k-exam{background:var(--exam-bg);border-color:var(--exam-edge);border-left-color:var(--exam-bd);color:var(--exam-tx)}
.blk.k-exam .nm{color:var(--exam-tx)}
.blk.k-exam.m2{opacity:.55}
.dh .cal{display:block;font-size:10.5px;font-weight:600;color:var(--soft-tx)}
.nav{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;background:var(--bg-card);border:1px solid var(--border-dark);border-radius:12px;padding:4px}
.nav>button{border:0;background:transparent;padding:7px 12px;border-radius:9px;font-weight:700;cursor:pointer;color:var(--text-muted)}
.nav>button:hover{background:var(--bg-sunk);color:var(--ink)}
.nav>button:disabled{opacity:.35;cursor:not-allowed;background:transparent}
.nav .wkl{font-family:var(--font-mono);font-weight:600;font-size:14px;color:var(--ink);padding-inline:6px;font-variant-numeric:tabular-nums}
.nav>.rot,.nav>.rot:hover{background:var(--ink);color:var(--bg-card)}
.anc{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;margin-bottom:18px;background:var(--accent-soft);color:var(--accent-text);border:1px solid var(--accent);font-size:14px}
.anc b{flex:1 1 220px}
```

- [ ] **Step 3: Markup.** מחליפים את בלוק `.seg`:

old:
```html
  <div class="seg" role="group" aria-label="בחירת שבוע ברוטציה">
    <button type="button" id="wkA" aria-pressed="true">שבוע א'<small id="cA"></small></button>
    <button type="button" id="wkB" aria-pressed="false">שבוע ב'<small id="cB"></small></button>
  </div>
```
new:
```html
  <div class="nav" role="group" aria-label="בחירת שבוע">
    <button type="button" id="prev" aria-label="שבוע קודם">→</button>
    <span class="wkl" id="wkLabel"></span>
    <button type="button" class="rot" id="rotBtn" title="החלפה בין שבוע א' לשבוע ב'"></button>
    <button type="button" id="next" aria-label="שבוע הבא">←</button>
    <button type="button" id="todayBtn">היום</button>
  </div>
```
מוסיפים מיד אחרי ה-`</div>` שסוגר את `.bar`:
```html
<div class="anc" id="anc" hidden><b>איזה שבוע ברוטציה זה, <span id="ancWk"></span>?</b><button type="button" class="btn" data-anchor="A">שבוע א'</button><button type="button" class="btn" data-anchor="B">שבוע ב'</button></div>
```
ב-legend, אחרי השורה של "אנגלית" ולפני `<span class="sep">`:
```html
    <span><i style="background:var(--exam-bg);border-color:var(--exam-bd)"></i>מבחן</span>
```
מחליפים את תוכן `<p class="sub">` ב-:
`מערכת הלימודים קבועה ונעולה. משמרות, אימונים ושעות למידה מוסיפים מעליה, קבוע לפי שבוע א'/ב' או לתאריך אחד.`
ואת `<footer>…</footer>` ב-:
```html
<footer>בסיס נעול: מקבץ ב' + אנגלית מתקדמים א' · לוח שנה ומועדי בחינות: האקדמית ת"א-יפו תשפ"ז (מועדים עלולים להשתנות) · מבחן מוצג כ-3 שעות</footer>
```

- [ ] **Step 4: Core.** משנים את `WKN`:

old: `const WKN={A:"שבוע א'",B:"שבוע ב'",both:'שני השבועות'};`
new: `const WKN={A:"שבוע א'",B:"שבוע ב'",both:'שני השבועות',date:'תאריך אחד'};`

ואת `BCOLOR`:

old: `const BCOLOR={lec:'--lec-bd',tut:'--tut-bd',lab:'--lab-bd',eng:'--eng-bd'};`
new: `const BCOLOR={lec:'--lec-bd',tut:'--tut-bd',lab:'--lab-bd',eng:'--eng-bd',exam:'--exam-bd'};`

ומסירים את `LS_WEEK`:

old: `const PPM=0.8, LS_ITEMS='wp.items.v1', LS_WEEK='wp.week';`
new: `const PPM=0.8, LS_ITEMS='wp.items.v1';`

- [ ] **Step 5: מצב.** בסקריפט השני:

old:
```js
let items=[], viewWeek='A', mode='loading', db=null, editing=null, timesTouched=false, delArmed=0;
try{const w=localStorage.getItem(LS_WEEK);if(w==='A'||w==='B')viewWeek=w}catch(e){}
```
new:
```js
let items=[], viewSun=clampSun(sunOf(todayIso())), mode='loading', db=null, editing=null, timesTouched=false, delArmed=0;
function go(sun){viewSun=clampSun(sun);render()}
```
מוחקים את הטווח מ-`/* ---------- model ---------- */` ועד השורה שלפני `/* ---------- render ---------- */`. בטווח נשאר רק `evsFor`.

- [ ] **Step 6: render.** מחליפים את כל `function render(){…}`:

```js
function render(){
  const anchor=anchorOf(items), wk=rot(viewSun,anchor), evs=evsForWeek(viewSun,items), an=analyze(evs), stt=stats(evs);
  const rng=dm(viewSun)+'–'+dm(addDays(viewSun,6)), edit=mode==='db'||mode==='local';
  $('#wkLabel').textContent=rng;$('#ancWk').textContent=rng;
  $('#rotBtn').textContent=wk?WKN[wk]:'';$('#rotBtn').hidden=!wk;$('#rotBtn').disabled=!edit;
  $('#prev').disabled=viewSun<=SEM.start;$('#next').disabled=viewSun>=lastSun;
  $('#anc').hidden=!!anchor||!edit;
  $('#gridTitle').textContent='שבוע '+rng+(wk?' · '+WKN[wk]:'');
  $('#agLead').textContent=`כל מה שמתוכנן בשבוע ${rng}, לפי סדר.`;
  renderStore(); renderSum(stt,an); renderAtt(an); renderGrid(evs,an.clash); renderAgenda(evs,an.clash);
  $('#addBtn').disabled=!edit;
}
```

ב-`renderSum` מחליפים שתי שורות:

old: `    ['שעות הוראה',hrs(s.cls),'4 ימי לימודים'],`
new: ``    ['שעות הוראה',hrs(s.cls),s.studyDays?`${s.studyDays} ימי לימודים`:'אין לימודים השבוע'],``

old: ``    ['סה"כ מחויב',hrs(s.total),s.oth?`כולל ${hrs(s.oth)} ש' אחר`:'שעות בשבוע'],``
new: ``    ['סה"כ מחויב',hrs(s.total),[s.ex?`${hrs(s.ex)} ש' מבחנים`:'',s.oth?`${hrs(s.oth)} ש' אחר`:''].filter(Boolean).join(' · ')||'שעות בשבוע'],``

ב-`renderAtt`: מחליפים את `ב${WKN[viewWeek]}.` ב-`בשבוע הזה.`

- [ ] **Step 7: גריד.** מוסיפים לפני `function renderGrid`:

```js
function dayHead(date,i,base){
  const c=CAL[date];
  const sub=base.length?fm(Math.min(...base.map(e=>e.s)))+'–'+fm(Math.max(...base.map(e=>e.e))):'אין לימודים';
  return esc(DAYS[i])+' '+dm(date)+'<small>'+sub+'</small>'+(c?`<span class="cal">${esc(c.label)}</span>`:'');
}
```
בתוך `renderGrid`:

old:
```js
  DAYS.forEach((d,i)=>{
    const base=evs.filter(e=>e.src==='base'&&e.d===i), h=document.createElement('div');
    h.className='dh'+(i>=4?' wk':'');
    const sub=base.length?fm(Math.min(...base.map(e=>e.s)))+'–'+fm(Math.max(...base.map(e=>e.e))):'אין לימודים';
    h.innerHTML=esc(d)+'<small>'+sub+'</small>';g.appendChild(h);
  });
```
new:
```js
  DAYS.forEach((d,i)=>{
    const h=document.createElement('div');
    h.className='dh'+(i>=4?' wk':'');
    h.innerHTML=dayHead(addDays(viewSun,i),i,evs.filter(e=>e.src==='base'&&e.d===i));g.appendChild(h);
  });
```
old: `      else b.className='blk base k-'+ev.kind;`
new: `      else b.className='blk base k-'+ev.kind+(ev.moed==='ב'?' m2':'');`

old:
```js
      if(ev.src==='base'){
        const kl=BKIND[ev.kind];
```
new:
```js
      if(ev.src!=='user'){
        const kl=ev.src==='exam'?'מבחן':BKIND[ev.kind];
```

- [ ] **Step 8: אג'נדה.** מחליפים את כל `function renderAgenda(evs,clash){…}`:

```js
function renderAgenda(evs,clash){
  const edit=mode==='db'||mode==='local';
  $('#agenda').innerHTML=DAYS.map((d,i)=>{
    const date=addDays(viewSun,i),c=CAL[date],dn=`${d} ${dm(date)}`;
    const list=evs.filter(e=>e.d===i).sort((a,b)=>a.s-b.s),base=list.filter(e=>e.src==='base');
    const sub=base.length?`לימודים ${fm(base[0].s)}–${fm(Math.max(...base.map(e=>e.e)))}`:(c?c.label:list.length?'אין לימודים':'');
    if(!list.length)return`<div class="day free"><div class="dn">${dn}${c?`<small>${esc(c.label)}</small>`:''}</div><div class="none">יום פנוי לגמרי</div></div>`;
    return`<div class="day"><div class="dn">${dn}<small>${esc(sub)}</small></div><ul>${list.map(e=>{
      const u=e.src==='user',col=u?KINDS[e.kind].color:BCOLOR[e.kind];
      const kl=u?KINDS[e.kind].short:e.src==='exam'?'מבחן':(BKIND[e.kind]||'אנגלית');
      const meta=u?[e.week==='both'?'כל שבוע':e.week==='date'?'חד-פעמי':'',e.note].filter(Boolean).join(' · '):e.room;
      const ttl=u&&e.title===KINDS[e.kind].label?e.title:e.title+' · '+kl;
      return`<li><span class="t">${tr(e.s,e.e)}</span><span><span class="dot" style="background:var(${col})"></span><b>${esc(ttl)}</b>${clash.has(e.key)?'<span class="tag-clash">התנגשות</span>':''}${meta?` <span class="meta">· ${esc(meta)}</span>`:''}${u&&edit?`<button type="button" class="edit-link" data-edit="${esc(e.id)}">עריכה</button>`:''}</span></li>`;
    }).join('')}</ul></div>`;
  }).join('');
}
```

- [ ] **Step 9: דיאלוג ושמירה.** ב-`openAdd`:

old: `  setWeek(viewWeek);`
new: `  setWeek(rot(viewSun,anchorOf(items))||'both');`

old: `  $('#dlgTitle').textContent='הוספה ל'+WKN[viewWeek];`
new: `  $('#dlgTitle').textContent='הוספה';`

ב-`openEdit`:

old: `setWeek(it.week||viewWeek);`
new: `setWeek(isRec(it)?it.week:'date');`

ב-`getWeek`:

old: `||viewWeek;`
new: `||'both';`

ב-`hint()` מחליפים את השורות מ-`const weeks=` ועד `weeks.forEach(…);`:

```js
  const anchor=anchorOf(items),hits=[];
  const suns=d.week==='date'?[viewSun]:[viewSun,addDays(viewSun,7)].filter(w=>d.week==='both'||rot(w,anchor)===d.week);
  suns.forEach(w=>evsForWeek(w,items,editing).forEach(o=>{if(o.d===d.day&&s<o.e&&o.s<e){const t=`${o.title} (${tr(o.s,o.e)})`;if(!hits.includes(t))hits.push(t)}}));
```
ב-`hint()`, החלק ‎`const[s,e]=span(d.start,d.end);`‎ נשאר. מוחקים ממנו רק את ‎`const weeks=…;const hits=[];`‎.

מחליפים את כל `async function saveItem(id,data){…}`:

```js
async function saveItem(id,data,msg){
  if(mode==='db'){
    const ok=await dbCall(()=>id?db.collection('items').doc(id).set(data):db.collection('items').add(data));
    if(ok)toast(msg||(id?'עודכן':'נוסף'));return ok;
  }
  if(mode==='local'){
    if(id){const i=items.findIndex(x=>x.id===id);if(i>=0)items[i]={...data,id}}
    else items.push({...data,id:'l'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)});
    const ok=saveLocal();render();toast(ok?(msg||(id?'עודכן':'נוסף')):'הדפדפן חוסם שמירה. הפריט יימחק ברענון.');return true;
  }
  return false;
}
```

מחליפים את שתי שורות ה-listener של `#wkA` ו-`#wkB` ב-:

```js
$('#prev').addEventListener('click',()=>go(addDays(viewSun,-7)));
$('#next').addEventListener('click',()=>go(addDays(viewSun,7)));
$('#todayBtn').addEventListener('click',()=>go(sunOf(todayIso())));
$('#rotBtn').addEventListener('click',()=>setAnchor(rot(viewSun,anchorOf(items))==='A'?'B':'A'));
$('#anc').addEventListener('click',x=>{const b=x.target.closest('[data-anchor]');if(b)setAnchor(b.dataset.anchor)});
async function setAnchor(w){
  if(!(mode==='db'||mode==='local'))return;
  const cur=items.filter(x=>x.kind==='anchor').sort((p,q)=>(q.updated||0)-(p.updated||0))[0];
  await saveItem(cur?cur.id:null,{kind:'anchor',date:w==='A'?viewSun:addDays(viewSun,-7),updated:Date.now()},`השבוע ${dm(viewSun)} הוא ${WKN[w]}`);
}
```

- [ ] **Step 10: בדיקות יחידה עדיין עוברות**

Run: `node --test test.mjs`
Expected: `# fail 0`. אם יש `ReferenceError: viewWeek`, נשארה הפניה ישנה: `grep -n viewWeek "תכנון השבוע בסמסטר א'.html"` צריך להחזיר 0 שורות.

- [ ] **Step 11: Preview.** יוצרים `.claude/launch.json`:

```json
{"version":"0.0.1","configurations":[{"name":"weekplan","runtimeExecutable":"python3","runtimeArgs":["-m","http.server","8765"],"port":8765}]}
```
מריצים `preview_start` עם `name:"weekplan"`, ועוברים (`navigate`) לכתובת `http://localhost:8765/` + הפלט של
`node -e "console.log(encodeURIComponent(\"תכנון השבוע בסמסטר א'.html\"))"`.

- [ ] **Step 12: אימות ויזואלי** (במצב localStorage). בודקים עם `read_page` או `get_page_text`, וצילום מסך אחד בסוף:
  1. הדף נפתח על "18.10–24.10". היום 8.10 נופל לפני הסמסטר, אז הוא עובר לשבוע הראשון. הבאנר "איזה שבוע ברוטציה זה" מוצג, וכפתור `→` מושבת.
  2. לוחצים על "שבוע א'": הבאנר נעלם והתג מציג "שבוע א'". לוחצים `←`: התג מציג "שבוע ב'", הטווח "25.10–31.10", ובכותרת שלישי מופיע "שלישי 27.10 · אין לימודים · בחירות לכנסת (משוער)".
  3. מנווטים ל-"17.01–23.01": ראשון מציג 3 שיעורים של שלישי עם "יום השלמה". שישי 22.01 מציג בלוק מבחן כהה "מבוא למיקרו · מבחן · מועד א'". בקונסול (`read_console_messages`, ‏onlyErrors) אין שגיאות.
  4. מנווטים עד הסוף: "07.03–13.03" וכפתור `←` מושבת. לוחצים "היום": חוזר ל-18.10.

- [ ] **Step 13: Commit**

```bash
git add -A && git commit -m "feat: date-based week navigation, rotation anchor, exams in grid"
```

---

### Task 4: פריטים חד-פעמיים, דילוג וביטול לימודים

**Files:**
- Modify: `תכנון השבוע בסמסטר א'.html` (core: ‏`toDoc`; ‏markup הדיאלוג; ‏CSS; והסקריפט השני: ‏`dayHead`, ‏`openAdd`, ‏`openEdit`, ‏`hint`, ‏submit, ‏listeners)
- Test: `test.mjs`

**Interfaces:**
- Consumes: `isRec`, `offDoc`, `addDays`, `sunOf`, `dow`, `saveItem(id,data,msg)`, `removeItem(id)`.
- Produces: `toDoc(form,sun)→doc` ב-core. גלובלים חדשים בסקריפט השני: `editSun` ו-`syncFields()`.

- [ ] **Step 1: בדיקה שנכשלת**

```js
test('toDoc',()=>{
  const f={kind:'open',title:'',day:2,start:'07:00',end:'15:00',week:'date',note:'',updated:5};
  const one=core.toDoc(f,'2026-10-25');
  assert.deepEqual(Object.keys(one).sort(),['date','end','kind','note','start','title','updated']);
  assert.equal(one.date,'2026-10-27');
  const r=core.toDoc({...f,week:'A',skip:['2026-11-01']},'2026-10-25');
  assert.equal(r.week,'A');assert.equal(r.day,2);assert.deepEqual(r.skip,['2026-11-01']);assert.equal(r.date,undefined);
  assert.deepEqual(core.toDoc({...f,week:'both'},'2026-10-25').skip,[]);
});
```

- [ ] **Step 2:** `node --test --test-name-pattern=toDoc test.mjs` → FAIL ‏`core.toDoc is not a function`

- [ ] **Step 3: core.** מוסיפים אחרי `stats`:

```js
function toDoc(f,sun){
  const b={kind:f.kind,title:f.title,note:f.note,updated:f.updated};
  if(f.week==='date')return{...b,date:addDays(sun,f.day),start:f.start,end:f.end};
  return{...b,day:f.day,start:f.start,end:f.end,week:f.week,skip:f.skip||[]};
}
```

- [ ] **Step 4:** `node --test test.mjs` → `# fail 0`

- [ ] **Step 5: Markup הדיאלוג.**

old: `        <label><input type="radio" name="fWeek" value="both" id="fwBoth">שני השבועות</label>`
new:
```html
        <label><input type="radio" name="fWeek" value="both" id="fwBoth">שני השבועות</label>
        <label><input type="radio" name="fWeek" value="date" id="fwDate"><span id="fwDateTxt">רק בתאריך הזה</span></label>
```
old: `      <span class="sp"></span>`
new:
```html
      <button type="button" class="btn" id="fSkip" hidden></button>
      <span class="sp"></span>
```
CSS, אחרי השורה `.dh .cal{…}`:
```css
.dh .hl{display:block;margin:2px auto 0;border:0;background:none;padding:0;font-size:10.5px;font-weight:600;color:var(--accent-text);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
```

- [ ] **Step 6: dayHead עם ביטול לימודים.** מחליפים את כל `function dayHead`:

```js
function dayHead(date,i,base){
  const c=CAL[date],off=offDoc(date,items),edit=mode==='db'||mode==='local';
  const sub=base.length?fm(Math.min(...base.map(e=>e.s)))+'–'+fm(Math.max(...base.map(e=>e.e))):off?'לימודים בוטלו':'אין לימודים';
  const tgl=!edit?'':off?`<button type="button" class="hl" data-unoff="${esc(off.id)}">החזרת לימודים</button>`:base.length?`<button type="button" class="hl" data-off="${date}">ביטול לימודים</button>`:'';
  return esc(DAYS[i])+' '+dm(date)+'<small>'+sub+'</small>'+(c?`<span class="cal">${esc(c.label)}</span>`:'')+tgl;
}
```
ומוסיפים listener אחד (ליד `$('#agenda').addEventListener`):
```js
$('#grid').addEventListener('click',x=>{
  const on=x.target.closest('[data-off]'),un=x.target.closest('[data-unoff]');
  if(on)saveItem(null,{kind:'off',date:on.dataset.off,title:'אין לימודים',updated:Date.now()},'בוטלו הלימודים ב-'+dm(on.dataset.off));
  if(un)removeItem(un.dataset.unoff);
});
```

- [ ] **Step 7: דיאלוג.** משנים את הצהרת המצב:

old: `let items=[], viewSun=clampSun(sunOf(todayIso())), mode='loading',`
new: `let items=[], viewSun=clampSun(sunOf(todayIso())), editSun=null, mode='loading',`

מוסיפים אחרי `function setWeek`:
```js
function syncFields(){$('#fwDateTxt').textContent='רק ב-'+dm(addDays(editSun,Number($('#fDay').value)))}
```
מחליפים את כל `function openAdd(pre={}){…}`:
```js
function openAdd(pre={}){
  editing=null;timesTouched=pre.start!=null;editSun=viewSun;
  const kind=pre.kind||'open',last=lastOf(kind);
  setKind(kind);$('#fTitle').value='';$('#fNote').value='';
  $('#fDay').value=String(pre.day!=null?pre.day:4);
  if(pre.start!=null){const dur=last?span(last.start,last.end).reduce((a,b)=>b-a):180;$('#fStart').value=fm(pre.start);$('#fEnd').value=fm(pre.start+dur)}
  else if(last){$('#fStart').value=last.start;$('#fEnd').value=last.end}
  else{$('#fStart').value='18:00';$('#fEnd').value='21:00'}
  setWeek(rot(viewSun,anchorOf(items))||'both');
  $('#dlgTitle').textContent='הוספה';$('#fDel').hidden=true;$('#fSkip').hidden=true;resetDel();$('#fErr').hidden=true;
  syncFields();hint();dlg.showModal();
}
```
מחליפים את כל `function openEdit(id){…}`:
```js
function openEdit(id){
  const it=items.find(x=>x.id===id);if(!it)return;
  if(!(mode==='db'||mode==='local')){toast('הדף פתוח לצפייה בלבד');return}
  editing=id;timesTouched=true;editSun=it.date?sunOf(it.date):viewSun;
  setKind(KINDS[it.kind]?it.kind:'other');$('#fTitle').value=it.title&&it.title!==KINDS[it.kind]?.label?it.title:'';
  $('#fDay').value=String(it.date?dow(it.date):it.day);$('#fStart').value=it.start||'';$('#fEnd').value=it.end||'';$('#fNote').value=it.note||'';
  const rec=isRec(it),date=rec?addDays(viewSun,Number(it.day)):'';
  setWeek(rec?it.week:'date');
  $('#fSkip').hidden=!rec;$('#fSkip').dataset.date=date;$('#fSkip').textContent=rec?'דילוג ב-'+dm(date):'';
  $('#dlgTitle').textContent='עריכה';$('#fDel').hidden=false;resetDel();$('#fErr').hidden=true;
  syncFields();hint();dlg.showModal();
}
```
ב-`hint()` מחליפים את `viewSun` ב-`editSun` בכל שלושת המופעים שבשורת `const suns=`.

ב-listener של `input` בטופס:

old: `  hint();\n});` (השורה האחרונה של `frm.addEventListener('input',…)`)
new: `  syncFields();hint();\n});`

מחליפים את כל `frm.addEventListener('submit',…)`:
```js
frm.addEventListener('submit',async x=>{
  x.preventDefault();const d=readForm(),err=validate(d);
  if(err){$('#fErr').textContent=err;$('#fErr').hidden=false;return}
  const prev=editing&&items.find(it=>it.id===editing);
  const doc=toDoc({...d,skip:prev&&isRec(prev)?prev.skip:undefined},editSun);
  $('#fSave').disabled=true;
  const ok=await saveItem(editing,doc,editing?'עודכן':doc.date?'נוסף ל-'+dm(doc.date):'נוסף ל'+WKN[doc.week]);
  $('#fSave').disabled=false;if(ok)dlg.close();
});
```
מוסיפים את ה-listener של הדילוג:
```js
$('#fSkip').addEventListener('click',async()=>{
  const it=items.find(x=>x.id===editing),date=$('#fSkip').dataset.date;if(!it||!date)return;
  const{id,...rest}=it;dlg.close();
  await saveItem(id,{...rest,skip:[...(it.skip||[]),date],updated:Date.now()},'דילוג ב-'+dm(date));
});
```

- [ ] **Step 8:** `node --test test.mjs` → `# fail 0`

- [ ] **Step 9: אימות ויזואלי** (preview, אחרי רענון):
  1. בשבוע 18.10 (א'), לוחצים על שטח פנוי בחמישי 18:00 ומוסיפים "פתיחה" עם האפשרות "רק ב-22.10". הבלוק מופיע ב-22.10. מנווטים לשבוע 01.11: הבלוק לא מופיע שם.
  2. מוסיפים "סגירה" קבועה לשבוע א' בשישי. עורכים אותה ולוחצים "דילוג ב-23.10": היא נעלמת מ-23.10 ומופיעה שוב ב-06.11.
  3. בכותרת שני 19.10 לוחצים "ביטול לימודים": השיעורים נעלמים והכותרת מציגה "לימודים בוטלו" ו"החזרת לימודים". לוחצים "החזרת לימודים": השיעורים חוזרים.
  4. אין שגיאות בקונסול.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: one-off items, per-date skip, manual class cancellation"
```

---

### Task 5: הגשות ו"מה מתקרב"

**Files:**
- Modify: `תכנון השבוע בסמסטר א'.html` (core: ‏`KINDS`, ‏`toDoc`; ‏markup: כרטיס `#up`; ‏CSS; והסקריפט השני: ‏`dayHead`, ‏`renderAgenda`, ‏`render`, ‏`validate`, ‏`hint`, ‏`syncFields`, ‏input listener)
- Test: `test.mjs`

**Interfaces:**
- Consumes: `upcoming`, `toDoc`, `saveItem`, `go`.
- Produces: `KINDS.due`, `renderUp()`, `toggleDone(id)`.

- [ ] **Step 1: בדיקה שנכשלת**

```js
test('toDoc due',()=>{
  const d=core.toDoc({kind:'due',title:'מטלה',day:4,start:'',end:'',week:'A',note:'',updated:1},'2026-10-25');
  assert.deepEqual(d,{kind:'due',title:'מטלה',note:'',updated:1,date:'2026-10-29',start:'23:59',done:false});
  assert.equal(core.KINDS.due.label,'הגשה');
  assert.equal(core.evsForWeek('2026-10-25',[{id:'x',kind:'due',date:'2026-10-29',start:'12:00',end:'13:00'}]).filter(e=>e.src==='user').length,0);
});
```

- [ ] **Step 2:** `node --test --test-name-pattern="toDoc due" test.mjs` → FAIL (‏deepEqual: חסר `done`, ויש `week`)

- [ ] **Step 3: core.** ב-`KINDS`, לפני `other:`:
```js
  due:{label:'הגשה',short:'הגשה',color:'--bad-bd'},
```
ב-`toDoc`, שורה ראשונה אחרי `const b=…;`:
```js
  if(f.kind==='due')return{...b,date:addDays(sun,f.day),start:okTime(f.start)?f.start:'23:59',done:!!f.done};
```

- [ ] **Step 4:** `node --test test.mjs` → `# fail 0`

- [ ] **Step 5: Markup + CSS.** לפני `<div class="sum" id="sum"></div>`:
```html
<section class="card" id="upCard">
  <h2>מה מתקרב</h2>
  <ol class="uplist" id="up"></ol>
</section>
```
עוטפים את שדה "באיזה שבוע" ב-id:

old: `    <div class="fld">\n      <span class="lbl" id="wkLbl">באיזה שבוע</span>`
new: `    <div class="fld" id="fWeekF">\n      <span class="lbl" id="wkLbl">באיזה שבוע</span>`

CSS, אחרי `.dh .hl{…}`:
```css
.uplist{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.uplist li{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.uplist .none{color:var(--text-faint);font-size:14px}
.upgo{flex:1 1 280px;display:grid;grid-template-columns:96px 104px minmax(0,1fr) auto;gap:10px;align-items:baseline;text-align:right;border:1px solid var(--border-light);background:var(--bg-sunk);border-radius:10px;padding:9px 12px;cursor:pointer;font:inherit;color:inherit}
.upgo:hover{border-color:var(--border-dark)}
.upgo .dl{font-weight:800;color:var(--ink)}
.upgo .dt{font-family:var(--font-mono);font-size:12.5px;color:var(--text-muted)}
.upgo .tg{font-size:11.5px;font-weight:700;padding:1px 9px;border-radius:999px;border:1px solid var(--border-dark);color:var(--text-muted);white-space:nowrap}
.chk{display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer}
.dh .due{display:block;font-size:10.5px;font-weight:700;color:var(--bad-tx)}
.done{text-decoration:line-through;opacity:.6}
@media (max-width:640px){.upgo{grid-template-columns:auto auto}.upgo b{grid-column:1/-1}}
```

- [ ] **Step 6: render.** ב-`dayHead` מחליפים את שורת ה-`return`:
```js
  return esc(DAYS[i])+' '+dm(date)+'<small>'+sub+'</small>'+(c?`<span class="cal">${esc(c.label)}</span>`:'')
    +items.filter(x=>x.kind==='due'&&x.date===date).map(x=>`<span class="due${x.done?' done':''}">הגשה: ${esc(x.title||'')}</span>`).join('')+tgl;
```
מחליפים את כל `function renderAgenda(evs,clash){…}`:
```js
function renderAgenda(evs,clash){
  const edit=mode==='db'||mode==='local';
  $('#agenda').innerHTML=DAYS.map((d,i)=>{
    const date=addDays(viewSun,i),c=CAL[date],dn=`${d} ${dm(date)}`;
    const list=evs.filter(e=>e.d===i).sort((a,b)=>a.s-b.s),base=list.filter(e=>e.src==='base');
    const dues=items.filter(x=>x.kind==='due'&&x.date===date);
    const sub=base.length?`לימודים ${fm(base[0].s)}–${fm(Math.max(...base.map(e=>e.e)))}`:(c?c.label:list.length?'אין לימודים':'');
    if(!list.length&&!dues.length)return`<div class="day free"><div class="dn">${dn}${c?`<small>${esc(c.label)}</small>`:''}</div><div class="none">יום פנוי לגמרי</div></div>`;
    return`<div class="day"><div class="dn">${dn}<small>${esc(sub)}</small></div><ul>${dues.map(x=>
      `<li><span class="t">עד ${esc(okTime(x.start)?x.start:'23:59')}</span><span><label class="chk${x.done?' done':''}"><input type="checkbox" data-done="${esc(x.id)}"${x.done?' checked':''}${edit?'':' disabled'}><b>הגשה: ${esc(x.title||'')}</b></label>${x.note?` <span class="meta">· ${esc(x.note)}</span>`:''}${edit?`<button type="button" class="edit-link" data-edit="${esc(x.id)}">עריכה</button>`:''}</span></li>`).join('')
    }${list.map(e=>{
      const u=e.src==='user',col=u?KINDS[e.kind].color:BCOLOR[e.kind];
      const kl=u?KINDS[e.kind].short:e.src==='exam'?'מבחן':(BKIND[e.kind]||'אנגלית');
      const meta=u?[e.week==='both'?'כל שבוע':e.week==='date'?'חד-פעמי':'',e.note].filter(Boolean).join(' · '):e.room;
      const ttl=u&&e.title===KINDS[e.kind].label?e.title:e.title+' · '+kl;
      return`<li><span class="t">${tr(e.s,e.e)}</span><span><span class="dot" style="background:var(${col})"></span><b>${esc(ttl)}</b>${clash.has(e.key)?'<span class="tag-clash">התנגשות</span>':''}${meta?` <span class="meta">· ${esc(meta)}</span>`:''}${u&&edit?`<button type="button" class="edit-link" data-edit="${esc(e.id)}">עריכה</button>`:''}</span></li>`;
    }).join('')}</ul></div>`;
  }).join('');
}
```
מוסיפים אחרי `renderAgenda`:
```js
function renderUp(){
  const L=upcoming(todayIso(),items),edit=mode==='db'||mode==='local';
  $('#up').innerHTML=L.length?L.map(x=>`<li><button type="button" class="upgo" data-go="${x.date}"><span class="dl">${x.daysLeft===0?'היום':x.daysLeft===1?'מחר':'עוד '+x.daysLeft+' ימים'}</span><span class="dt">${dm(x.date)} · ${esc(x.time)}</span><b>${esc(x.title)}</b><span class="tg">${esc(x.tag)}</span></button>${x.id&&edit?`<label class="chk"><input type="checkbox" data-done="${esc(x.id)}">הוגש</label>`:''}</li>`).join(''):'<li class="none">אין מבחנים או הגשות קרובים.</li>';
}
async function toggleDone(id){
  const it=items.find(x=>x.id===id);if(!it)return;
  const{id:_,...rest}=it;await saveItem(id,{...rest,done:!it.done,updated:Date.now()},it.done?'סומן כלא הוגש':'סומן כהוגש');
}
$('#up').addEventListener('click',x=>{const b=x.target.closest('[data-go]');if(b)go(sunOf(b.dataset.go))});
document.addEventListener('change',x=>{const c=x.target.closest('[data-done]');if(c)toggleDone(c.dataset.done)});
```
ב-`render()`:

old: `  renderStore(); renderSum(stt,an);`
new: `  renderStore(); renderUp(); renderSum(stt,an);`

- [ ] **Step 7: דיאלוג.** מחליפים את `syncFields`:
```js
function syncFields(){
  const due=getKind()==='due';
  $('#fEnd').closest('.fld').hidden=due;$('#fWeekF').hidden=due;
  $('#fwDateTxt').textContent='רק ב-'+dm(addDays(editSun,Number($('#fDay').value)));
}
```
שורה ראשונה בגוף `validate(d)`:
```js
  if(d.kind==='due')return okTime(d.start)?'':'צריך שעת הגשה.';
```
אחרי `const d=readForm(),h=$('#fHint');` ב-`hint()`:
```js
  if(d.kind==='due'){h.className='hint';h.textContent=`הגשה ב-${dm(addDays(editSun,d.day))} עד ${okTime(d.start)?d.start:'23:59'}`;return}
```
ב-listener של `input`:

old: `  if(x.target.name==='fKind'&&!editing&&!timesTouched){const l=lastOf(getKind());if(l){$('#fStart').value=l.start;$('#fEnd').value=l.end}}`
new: `  if(x.target.name==='fKind'&&!editing&&!timesTouched){const l=lastOf(getKind());if(getKind()==='due')$('#fStart').value='23:59';else if(l){$('#fStart').value=l.start;$('#fEnd').value=l.end}}`

- [ ] **Step 8:** `node --test test.mjs` → `# fail 0`

- [ ] **Step 9: אימות ויזואלי:**
  1. "מה מתקרב" מציג 6 פריטים. הראשון "עוד 106 ימים · 22.01 · 09:00 · מבוא למיקרו · מועד א'", כי 22.01.27 פחות 08.10.26 הם 106 ימים. ביום אחר, `daysLeft` צריך להתאים ל-`dayDiff`.
  2. מוסיפים "הגשה" "מטלה 1" ביום חמישי בשבוע 18.10. שדות הסיום והשבוע מוסתרים, והשעה 23:59. ההגשה מופיעה בכותרת חמישי 22.10, באג'נדה עם תיבת סימון, ובראש "מה מתקרב".
  3. מסמנים "הוגש": ההגשה נעלמת מ"מה מתקרב", ובאג'נדה מוצגת עם קו חוצה.
  4. לחיצה על פריט מבחן ב"מה מתקרב" עוברת לשבוע 17.01.
  5. אין שגיאות בקונסול.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: deadlines with done toggle and upcoming countdown"
```

---

### Task 6: ייצוא ליומן (CSV ל-Google, ‏`.ics` בתוך zip)

**Files:**
- Modify: `תכנון השבוע בסמסטר א'.html` (core: הייצוא; ‏markup: כרטיס ייצוא; ‏CSS; והסקריפט השני: `offer` ו-init)
- Test: `test.mjs`

**Interfaces:**
- Consumes: `evsForWeek`, `SEM`, `BKIND`, `toMin`, `okTime`, `isoOk`, `addDays`, `pad`.
- Produces (core): `semEvents(items)→[{uid,date,s,e,summary,location,desc}]`, `icsEsc(s)`, `icsFold(line)`, `icsDT(iso,min)→'YYYYMMDDTHHMMSS'`, `buildIcs(items,stamp)→string`, `crc32(bytes)→uint`, `zip1(name,text)→Uint8Array`, `usDate(iso)`, `ampm(min)`, `buildCsv(items)→string`. בסקריפט השני: `offer(filename,data)` ו-`dl`.

- [ ] **Step 1: בדיקות שנכשלות**

```js
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
  assert.equal(ics.match(/BEGIN:VEVENT/g).length,169+12+21+1);
  const early=core.semEvents([{id:'e',kind:'due',date:'2026-11-05',start:'00:15'}]).find(x=>x.uid==='ue-2026-11-05');
  assert.ok(early.s>=0&&early.e>early.s);
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
  assert.equal(lines.length,1+169+12+21);
  assert.equal(core.ampm(0),'12:00 AM');assert.equal(core.ampm(720),'12:00 PM');
});
```
את שורות ה-`import` מעבירים לראש `test.mjs`, ליד שאר ה-imports.

- [ ] **Step 2:** `node --test test.mjs` → FAIL ‏`core.icsEsc is not a function`

- [ ] **Step 3: core.** מוסיפים אחרי `toDoc`:

```js
/* ---------- calendar export: whole semester through the last exam ---------- */
function semEvents(items){
  const out=[];
  for(let sun=SEM.start;sun<=SEM.last;sun=addDays(sun,7))evsForWeek(sun,items).forEach(x=>out.push({uid:x.key+'-'+x.date,date:x.date,s:x.s,e:x.e,
    summary:x.src==='base'?x.title+(BKIND[x.kind]?' · '+BKIND[x.kind]:''):x.src==='exam'?'מבחן: '+x.title+' · '+x.room:x.title,
    location:x.src==='base'?x.room:'',desc:x.note||''}));
  items.filter(x=>x.kind==='due'&&isoOk(x.date)&&!x.done).forEach(x=>{const s=Math.max(30,toMin(okTime(x.start)?x.start:'23:59'));
    out.push({uid:'u'+x.id+'-'+x.date,date:x.date,s:s-30,e:s,summary:'הגשה: '+(x.title||''),location:'',desc:x.note||''})});
  return out;
}
const icsEsc=s=>String(s??'').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
function icsFold(line){ // RFC 5545: max 75 octets per line, continuation starts with a space
  const enc=new TextEncoder();if(enc.encode(line).length<=75)return line;
  const out=[];let cur='',n=0;
  for(const ch of line){const b=enc.encode(ch).length;if(n+b>75){out.push(cur);cur=' ';n=1}cur+=ch;n+=b}
  out.push(cur);return out.join('\r\n');
}
const icsDT=(iso,min)=>addDays(iso,Math.floor(min/1440)).replace(/-/g,'')+'T'+pad(Math.floor(min%1440/60))+pad(min%60)+'00';
const VTZ=['BEGIN:VTIMEZONE','TZID:Asia/Jerusalem',
  'BEGIN:STANDARD','DTSTART:19701025T020000','TZOFFSETFROM:+0300','TZOFFSETTO:+0200','TZNAME:IST','RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU','END:STANDARD',
  'BEGIN:DAYLIGHT','DTSTART:19700327T020000','TZOFFSETFROM:+0200','TZOFFSETTO:+0300','TZNAME:IDT','RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=23,24,25,26,27,28,29;BYDAY=FR','END:DAYLIGHT',
  'END:VTIMEZONE'];
function buildIcs(items,stamp){
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//weekplan//he','CALSCALE:GREGORIAN',"X-WR-CALNAME:סמסטר א' תשפ\"ז",...VTZ];
  semEvents(items).forEach(x=>{
    L.push('BEGIN:VEVENT','UID:'+x.uid+'@weekplan','DTSTAMP:'+stamp,'DTSTART;TZID=Asia/Jerusalem:'+icsDT(x.date,x.s),'DTEND;TZID=Asia/Jerusalem:'+icsDT(x.date,x.e),'SUMMARY:'+icsEsc(x.summary));
    if(x.location)L.push('LOCATION:'+icsEsc(x.location));if(x.desc)L.push('DESCRIPTION:'+icsEsc(x.desc));
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR');return L.map(icsFold).join('\r\n')+'\r\n';
}
function crc32(b){
  let t=crc32.t;if(!t){t=crc32.t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}}
  let c=~0;for(let i=0;i<b.length;i++)c=t[(c^b[i])&255]^(c>>>8);return(~c)>>>0;
}
function zip1(name,text){ // ponytail: one stored (uncompressed) file — .ics is not on the downloads allowlist, .zip is
  const enc=new TextEncoder(),n=enc.encode(name),d=enc.encode(text),crc=crc32(d),L=30+n.length+d.length,C=46+n.length;
  const buf=new Uint8Array(L+C+22),v=new DataView(buf.buffer),u32=(o,x)=>v.setUint32(o,x,true),u16=(o,x)=>v.setUint16(o,x,true);
  u32(0,0x04034b50);u16(4,20);u16(12,33);u32(14,crc);u32(18,d.length);u32(22,d.length);u16(26,n.length);buf.set(n,30);buf.set(d,30+n.length);
  u32(L,0x02014b50);u16(L+4,20);u16(L+6,20);u16(L+14,33);u32(L+16,crc);u32(L+20,d.length);u32(L+24,d.length);u16(L+28,n.length);buf.set(n,L+46);
  const E=L+C;u32(E,0x06054b50);u16(E+8,1);u16(E+10,1);u32(E+12,C);u32(E+16,L);
  return buf;
}
const usDate=iso=>iso.slice(5,7)+'/'+iso.slice(8)+'/'+iso.slice(0,4);
const ampm=m=>{m%=1440;const h=Math.floor(m/60);return((h+11)%12+1)+':'+pad(m%60)+' '+(h<12?'AM':'PM')};
function buildCsv(items){ // Google Calendar import format; times are read in the target calendar's zone (Israel)
  const q=s=>'"'+String(s??'').replace(/"/g,'""')+'"';
  return['Subject,Start Date,Start Time,End Date,End Time,Description,Location'].concat(semEvents(items).map(x=>
    [x.summary,usDate(x.date),ampm(x.s),usDate(addDays(x.date,Math.floor(x.e/1440))),ampm(x.e),x.desc,x.location].map(q).join(','))).join('\r\n')+'\r\n';
}
```

- [ ] **Step 4:** `node --test test.mjs` → `# fail 0`

- [ ] **Step 5: Markup + CSS.** לפני `<footer>`:
```html
<section class="card">
  <h2>ייצוא ליומן</h2>
  <p class="lead">כל הסמסטר עד סוף המבחנים: שיעורים, משמרות לפי שבוע א'/ב', פריטים חד-פעמיים, מבחנים והגשות. ייבוא חוזר יוצר כפילויות, אז כדאי לייבא ליומן נפרד ולמחוק אותו לפני ייבוא מחדש.</p>
  <div class="exp">
    <div><button type="button" class="btn pri" id="expCsv">Google Calendar · CSV</button><p>ב-Google Calendar: הגדרות ← ייבוא וייצוא ← ייבוא. בוחרים את הקובץ ואת היומן.</p></div>
    <div><button type="button" class="btn pri" id="expIcs">Apple ויומנים אחרים · ics בתוך zip</button><p>פותחים את ה-zip ולוחצים פעמיים על weekplan-semA.ics.</p></div>
  </div>
</section>
```
CSS:
```css
.exp{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.exp p{margin:6px 0 0;font-size:13px;color:var(--text-muted)}
```

- [ ] **Step 6: הורדה.** בסקריפט השני, אחרי `toast`:
```js
let dl=null;
async function offer(filename,data){
  if(dl){try{await dl.save({filename,data});toast('הקובץ ירד')}catch(e){const c=e&&e.code;if(c!=='declined')toast(c==='rate_limited'?'כבר פתוח חלון הורדה':'ההורדה לא זמינה כאן')}return}
  try{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data]));a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(e){toast('ההורדה לא זמינה כאן')}
}
$('#expCsv').addEventListener('click',()=>offer('weekplan-semA.csv',buildCsv(items)));
$('#expIcs').addEventListener('click',()=>offer('weekplan-semA.zip',zip1('weekplan-semA.ics',buildIcs(items,new Date().toISOString().replace(/[-:]/g,'').slice(0,15)+'Z'))));
```
ב-IIFE של האתחול:

old: `  try{[d,u]=await Promise.all([c.use('db'),c.use('user')])}catch(e){}`
new: `  try{[d,u,dl]=await Promise.all([c.use('db'),c.use('user'),c.use('downloads')])}catch(e){}`

- [ ] **Step 7:** `node --test test.mjs` → `# fail 0`

- [ ] **Step 8: אימות ב-preview.** בודקים עם `javascript_tool`:
`[buildCsv(items).split('\r\n').length, buildIcs(items,'20261008T000000Z').length, zip1('a.ics','x').length]`. כל הערכים צריכים להיות מספרים חיוביים, בלי חריגות. לוחצים על שני הכפתורים ומוודאים שאין שגיאה בקונסול. במצב local ההורדה עוברת דרך `a[download]`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: semester export to Google CSV and Apple ics-in-zip"
```

---

### Task 7: פרסום ועדכון מסמכים

**Files:**
- Modify: `CLAUDE.md`, ‏`docs/superpowers/specs/2026-10-08-real-dates-design.md`

- [ ] **Step 1:** `node --test test.mjs` → `# fail 0`

- [ ] **Step 2: קריאת הגרסה החיה.** מריצים `Artifact action:"read"` על `https://claude.ai/artifact/F2qwDgUBPhPYNDU3Z2DiZg`. אם הגרסה עדיין `1791447519-5a1f` (זו שנקראה ב-2026-10-08), ממשיכים. אם לא, משווים את ה-HTML החי ל-commit של Task 0 (`git show HEAD~6:"תכנון השבוע בסמסטר א'.html"`), ממזגים את ההבדלים לקובץ המקומי, ומריצים שוב את Step 1.

- [ ] **Step 3: פרסום.** `Artifact` publish עם `url:"https://claude.ai/artifact/F2qwDgUBPhPYNDU3Z2DiZg"`, ‏`file_path:"/Users/pavelkovrov/Desktop/WeekPlan/תכנון השבוע בסמסטר א'.html"` ו-`capabilities:{db:{},user:{},downloads:true}`. לא מעבירים `contract`.

- [ ] **Step 4: בדיקה פונקציונלית.** טוענים את `ArtifactData` (ToolSearch) ומריצים `list` על `items`. המסמכים הקיימים של המשתמש צריכים להיות שם בלי שינוי. לא כותבים ל-db. את קביעת העוגן המשתמש עושה בעצמו מהדף.

- [ ] **Step 5: CLAUDE.md.** בסעיף "Build / run / deploy" מוסיפים:
```markdown
- **Tests:** `node --test test.mjs` (single: `node --test --test-name-pattern="<name>" test.mjs`). They evaluate `<script id="core">` from the HTML in Node — keep everything in core pure (no DOM / localStorage at top level).
- **Preview with a server:** `.claude/launch.json` → `weekplan` (python http.server :8765).
```
מעדכנים את רשימת היכולות ל-`db`, ‏`user`, ‏`downloads` (ב-publish צריך להעביר את שלושתן). בסעיף Architecture מוסיפים: core מכיל את `SEM/CAL/EXAMS`, ‏`evsForWeek(sun,items)`, ‏`rot`/`anchorOf`, ‏`upcoming`, ‏`toDoc` ואת הייצוא. סוג המסמך באוסף `items` נקבע לפי השדות: `week` (קבוע), ‏`date` (חד-פעמי), ‏`kind:'due'|'off'|'anchor'`.

- [ ] **Step 6: Spec.** אם משהו במימוש סטה מה-spec (למשל משך מבחן, צבעים או טקסטים), מעדכנים את ה-spec כך שיתאר את מה שנבנה בפועל.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "docs: tests, preview and capabilities in CLAUDE.md; spec matches build"
```

- [ ] **Step 8:** מסרים למשתמש את הקישור ואת שלושת הצעדים הראשונים: לקבוע איזה שבוע ברוטציה זה, לאשר את ה-prompt של ההורדה בפעם הראשונה, ולייבא ל-Google Calendar ליומן נפרד.
