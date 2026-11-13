'use strict';

const CACHE_NAME = 'fluxo-v16';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app-data.js',
  './app-report.js',
  './app-ui.js',
  './receipts.js',
  './native.js',
  './report.js',
  './sync.js',
  './manifest.webmanifest',
  './fonts/inter-latin.woff2',
  './fonts/fraunces-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){ return cache.addAll(APP_SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Rede primeiro para o app sempre abrir atualizado; cache como reserva offline.
    event.respondWith(
      fetch(request).then(function(response){
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(request, copy); });
          return response;
        }
        return caches.match(request).then(function(cached){
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('./index.html');
          return response;
        });
      }).catch(function(){
        return caches.match(request).then(function(cached){
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
      })
    );
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then(function(cached){
        return cached || fetch(request).then(function(response){
          if (response && (response.ok || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(request, copy); });
          }
          return response;
        }).catch(function(){ return cached; });
      })
    );
  }
});
