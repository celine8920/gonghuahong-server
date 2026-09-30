const C='gh-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','manifest.json','icon.svg'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;
 e.respondWith(caches.match(e.request).then(m=>{
  const f=fetch(e.request).then(r=>{if(r.ok||r.type==='opaque'){const x=r.clone();caches.open(C).then(c=>c.put(e.request,x))}return r}).catch(()=>m);
  return m||f}))});
