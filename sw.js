// Service worker: guarda tudo no aparelho para o app funcionar sem internet
const V='coral-v4';
const FILES=["./", "analysis.js", "app.js", "apple-touch-icon.png", "base.json", "icon-192.png", "icon-512.png", "index.html", "manifest.webmanifest", "maskable-512.png", "n48.mp3", "n49.mp3", "n50.mp3", "n51.mp3", "n52.mp3", "n53.mp3", "n54.mp3", "n55.mp3", "n56.mp3", "n57.mp3", "n58.mp3", "n59.mp3", "n60.mp3", "n61.mp3", "n62.mp3", "n63.mp3", "n64.mp3", "n65.mp3", "n66.mp3", "n67.mp3", "n68.mp3", "n69.mp3", "n70.mp3", "n71.mp3", "n72.mp3", "n73.mp3", "n74.mp3", "n75.mp3", "n76.mp3", "n77.mp3", "n78.mp3", "n79.mp3", "n80.mp3", "n81.mp3", "n82.mp3", "n83.mp3", "n84.mp3", "w_brrr.mp3", "w_hum.mp3", "w_longa.mp3", "w_mi.mp3"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const u=new URL(e.request.url); if(u.origin!==location.origin) return;
  // páginas e código: rede primeiro (pega atualizações), cache se offline
  if(e.request.mode==='navigate'||/\.(html|js|json|webmanifest)$/.test(u.pathname)){
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));
    return;
  }
  // áudios e ícones: cache primeiro
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(r2=>{const c=r2.clone();caches.open(V).then(x=>x.put(e.request,c));return r2;})));
});
