// Service worker: keeps the app shell for offline opening. Network first, cache as the fallback.
// Only same-origin GETs are touched: api.github.com (the data) and the fonts go straight to the network and are never cached here;
// the page keeps its own offline copy of the data (wp.gh.cache). Bump V when the SHELL list changes.
const V='weekplan-v1',SHELL=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'];
addEventListener('install',e=>e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>skipWaiting())));
addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('weekplan-')&&k!==V).map(k=>caches.delete(k)))).then(()=>clients.claim())));
addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==location.origin||u.pathname.includes('/api/'))return;
  // no-cache: revalidate even inside the host's max-age, so a new deploy shows on the next open. 5s: a dead connection must not hang the app.
  const net=fetch(r,{cache:'no-cache'}).then(res=>{if(res.ok){const c=res.clone();e.waitUntil(caches.open(V).then(x=>x.put(r,c)))}return res});
  e.respondWith(Promise.race([net,new Promise((_,no)=>setTimeout(no,5000))]).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||(r.mode==='navigate'?caches.match('./'):Response.error()))));
});
