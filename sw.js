/* ActionMap service worker (same shape as Project Library's, which phones install fine):
   1. receives photos shared from other apps (the Android share sheet hands original files WITH
      their GPS intact, unlike the file picker, which strips it);
   2. network first for the app's own files, with the last good copy as the offline fallback.
      Online you always get the newest version; the fallback is what lets the phone install it
      as a real app. */
const SW_VER = "9";
const APP_CACHE = "am-app-2";
const LIB_CACHE = "am-libs-1";   // versioned map / photo libraries from the CDNs: kept so the app also opens offline
const CORE = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => {
  e.waitUntil(Promise.all([
    caches.open("pm-shared").then(c => c.put("swver", new Response(SW_VER))),
    caches.open(APP_CACHE).then(c => Promise.all(CORE.map(f => c.add(f).catch(() => {}))))   // one missing file never blocks the install
  ]));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP_CACHE && k !== LIB_CACHE && k !== "pm-shared").map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
