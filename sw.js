/* PhotoMap Field service worker.
   Exists ONLY to receive photos shared from other apps (the Android share sheet hands
   original files WITH their GPS intact, unlike the file picker, which strips it).
   It never caches the app itself — every normal request goes straight to the network,
   so the self-updating page keeps working exactly as before. */
const SW_VER = "7";
self.addEventListener("install", e => {
  e.waitUntil(caches.open("pm-shared").then(c => c.put("swver", new Response(SW_VER))));
  self.skipWaiting();
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
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
