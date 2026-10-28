// MASTERSALE™ app shell cache. Never touches the owner panel, Firebase or payment traffic.
const V = "ms-v1", SHELL = ["./", "index.html", "manifest.webmanifest", "assets/logo-white.png", "assets/mark-white.png", "assets/icon-192.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  if (r.mode === "navigate") {
    if (!/(index\.html|\/)$/.test(u.pathname)) return;           // only the store page
    e.respondWith(fetch(r).then(x => { if (x.ok) caches.open(V).then(c => c.put("index.html", x.clone())); return x; }).catch(() => caches.match("index.html")));
    return;
  }
  if (u.pathname.includes("/assets/"))
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(x => { const y = x.clone(); caches.open(V).then(c => c.put(r, y)); return x; })));
});
