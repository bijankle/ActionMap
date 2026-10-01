/* ActionMap service worker (same shape as Project Library's, which phones install fine):
   1. receives photos shared from other apps (the Android share sheet hands original files WITH
      their GPS intact, unlike the file picker, which strips it);
   2. network first for the app's own files, with the last good copy as the offline fallback.
      Online you always get the newest version; the fallback is what lets the phone install it
      as a real app. */
const SW_VER = "10";
const APP_CACHE = "am-app-3";
const LIB_CACHE = "am-libs-1";
const TILE_CACHE = "am-tiles-1", TILE_MAX = 6000;   // satellite tiles seen before come from the phone, not the network (imagery changes every few months at most)   // versioned map / photo libraries from the CDNs: kept so the app also opens offline
const CORE = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(Promise.all([
    caches.open("pm-shared").then(c => c.put("swver", new Response(SW_VER))),
    caches.open(APP_CACHE).then(c => Promise.all(CORE.map(f => c.add(f).catch(() => {}))))   // one missing file never blocks the install
  ]));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP_CACHE && k !== LIB_CACHE && k !== TILE_CACHE && k !== "pm-shared").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method === "GET" && u.origin === self.location.origin) {   // only this site's own files; GitHub API / photos / map tiles go straight through
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok && r.status === 200 && r.type === "basic") { const copy = r.clone(); const key = e.request.mode === "navigate" ? "./" : e.request;   // the page is kept ONCE (not once per ?link)
        caches.open(APP_CACHE).then(c => c.put(key, copy)).catch(() => {}); }
      return r;
    }).catch(() => (e.request.mode === "navigate" ? caches.match("./") : caches.match(e.request, { ignoreSearch: true })).then(hit => hit || caches.match("./"))));
    return;
  }
  if (e.request.method === "GET" && (/^mt\d\.google\.com$/.test(u.hostname) || (u.hostname === "server.arcgisonline.com" && u.pathname.includes("/tile/")))) {
    e.respondWith(tileFirst(e.request));
    return;
  }
  if (e.request.method === "GET" && /^(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)$/.test(u.hostname) && /@\d|\/\d+\.\d+/.test(u.pathname)) {   // pinned versions never change: cache first
    e.respondWith(caches.open(LIB_CACHE).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()).catch(() => {}); return r; }))));
    return;
  }
  if (e.request.method === "POST" && (u.pathname.endsWith("/share-target") || u.pathname.endsWith("/Photo-Map.html") || u.pathname.endsWith("/index.html") || u.pathname.endsWith("/"))) {
    e.respondWith((async () => {
      try {
        const dbg = [];
        dbg.push("ct=" + (e.request.headers.get("content-type") || "none").slice(0, 40));
        try { const buf = await e.request.clone().arrayBuffer(); dbg.push("len=" + buf.byteLength); } catch (err) { dbg.push("bodyErr:" + (err && err.message)); }
        const fd = await e.request.formData();
        let files = fd.getAll("file").concat(fd.getAll("photos")).filter(f => f && typeof f.arrayBuffer === "function" && f.size);
        for (const [k, v] of fd.entries()) dbg.push(k + "=" + (v && typeof v.arrayBuffer === "function" ? "file(" + (v.name || "?") + "," + (v.size || 0) + "," + (v.type || "?") + ")" : "text:" + String(v).slice(0, 30)));
        if (!files.length) {   // harvest ANY file-like entry, whatever Android called the field
          for (const [k, v] of fd.entries()) if (v && typeof v.arrayBuffer === "function" && v.size) files.push(v);
        }
        const cache = await caches.open("pm-shared");
        await cache.put("swver", new Response(SW_VER));   // restamped every share — survives cache clears
        await cache.put("dbg", new Response(JSON.stringify(dbg)));
        await cache.put("meta", new Response(JSON.stringify(files.map(f => ({ n: f.name, t: f.type })))));
        for (let i = 0; i < files.length; i++) await cache.put("file-" + i, new Response(files[i]));
        return Response.redirect("./?shared=" + files.length, 303);
      } catch (err) {
        return Response.redirect("./?shared=err", 303);
      }
    })());
  }
});

/* map tiles: cache first. Fetched in CORS mode so the stored copy is a normal (not opaque) response —
   it can also be drawn into the share image, and doesn't eat the storage quota the way opaque ones do. */
let _tilePuts = 0;
async function tileFirst(req) {
  const c = await caches.open(TILE_CACHE), key = req.url;
  const hit = await c.match(key); if (hit) return hit;
  try {
    const r = await fetch(key, { mode: "cors", credentials: "omit" });
    if (r.ok) { c.put(key, r.clone()).then(() => { if (++_tilePuts % 200 === 0) trimTiles(c); }).catch(() => {}); }
    return r;
  } catch (err) { return fetch(req); }   // that source doesn't allow CORS: plain fetch, not stored
}
async function trimTiles(c) { try { const ks = await c.keys(); for (let i = 0; i < ks.length - TILE_MAX; i++) await c.delete(ks[i]); } catch (e) {} }   // oldest first
