const CACHE_NAME = "gm-flex-financeiro-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./css/responsive.css",
  "./css/auth.css",
  "./js/config/supabase.js",
  "./js/utils/supabase-init.js",
  "./js/auth/authService.js",
  "./js/repositories/dataRepository.js",
  "./js/services/migrationService.js",
  "./js/pwa.js",
  "./js/app.js",
  "./js/vendor/jspdf.umd.min.js",
  "./js/vendor/chart.umd.min.js",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if(event.request.method !== "GET") return;

  var url = new URL(event.request.url);

  // env.js guarda as credenciais do Supabase e pode mudar sem o app trocar de versao.
  // Por isso ele nunca deve ser servido do cache: sempre busca da rede primeiro,
  // e so cai para o cache se estiver offline.
  if(url.origin === self.location.origin && url.pathname.endsWith("/env.js")){
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          var copy = response.clone();
          if(response.ok){
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if(cached) return cached;

      return fetch(event.request)
        .then((response) => {
          var copy = response.clone();
          if(response.ok && url.origin === self.location.origin){
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
