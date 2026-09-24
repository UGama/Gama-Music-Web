'use strict';

const APP_VERSION = '82';

const CACHE_NAME =
  `gama-music-shell-v${APP_VERSION}`;
const SHELL_ASSETS = [
  './',
  './index.html',
  './js/storage/storage.js',
  './styles.css',
  './js/app.js',
  './js/core/state.js',
  './js/player/player.js',
  './js/library/library.js',
  './js/library/playlists.js',
  './js/ui/playlist-view.js',
  './js/core/utils.js',
  './js/core/api.js',
  './js/library/backup.js',
  './js/downloads/bilibili.js',
  './js/storage/download-store.js',
  './js/library/library-service.js',
  './js/downloads/mobile-downloads.js',
  './js/core/pwa.js',
  './js/sync/qr-scanner.js',
  './js/ui/settings.js',
  './js/player/sleep-timer.js',
  './js/sync/sync.js',
  './js/downloads/transfer.js',
  './js/ui/ui.js',
  './vendor/jsQR.js',
  './vendor/qrcode.min.js',
  './manifest.webmanifest',
  './assets/icon.svg?v=30',
  './assets/icon-192.png?v=30',
  './assets/icon-512.png?v=30',
  './assets/apple-touch-icon.png?v=30',
  './assets/playlist/cat.svg',
  './assets/playlist/dog.svg',
  './assets/playlist/panda.svg',
  './assets/playlist/rabbit.svg',
  './assets/playlist/fox.svg',
  './assets/playlist/bear.svg',
  './assets/playlist/koala.svg',
  './assets/playlist/penguin.svg',
  './assets/playlist/red-panda.svg',
  './assets/playlist/frog.svg',
  './assets/playlist/tiger.svg',
  './assets/playlist/lion.svg'
];


self.addEventListener(
  'install',
  (event) => {

    event.waitUntil(
      caches
        .open(
          CACHE_NAME
        )
        .then(
          (cache) =>
            cache.addAll(
              SHELL_ASSETS.map(
                (asset) =>
                  new Request(
                    asset,
                    {
                      cache:
                        'reload'
                    }
                  )
              )
            )
        )
    );

  }
);

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener(
  'message',
  (event) => {

    const type =
      event.data?.type;


    /*
     * 用户点击“立即更新”以后，
     * 才让等待中的新版立即接管。
     */
    if (
      type ===
      'SKIP_WAITING'
    ) {

      self.skipWaiting();

      return;
    }


    /*
     * 页面可以询问：
     * 当前 / 等待中的 Service Worker
     * 是什么版本。
     */
    if (
      type ===
      'GET_VERSION'
    ) {

      const response = {
        type:
          'GAMA_VERSION',

        version:
          APP_VERSION
      };


      if (
        event.ports?.[0]
      ) {

        event.ports[0]
          .postMessage(
            response
          );

        return;
      }


      event.source
        ?.postMessage(
          response
        );

    }

  }
);

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;


  /*
   * 不处理 Chrome 扩展等非 HTTP(S) 请求。
   */
  if (
    url.protocol !== 'http:' &&
    url.protocol !== 'https:'
  ) {
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    return;
  }


  /*
   * MP3 不放进 Service Worker Cache。
   * 音频继续由 IndexedDB 管理。
   */
  if (
    url.pathname.startsWith('/media/') &&
    url.pathname.endsWith('.mp3')
  ) {
    return;
  }


  /*
   * media 里的 jpg/png/webp/avif
   * 也就是歌曲封面：
   * cache-first。
   */
  if (
    url.pathname.startsWith('/media/')
  ) {
    event.respondWith(
      caches.match(event.request)
        .then((cached) => {

          if (cached) {
            return cached;
          }

          return fetch(event.request)
            .then((response) => {

              if (
                response.ok
              ) {
                const copy =
                  response.clone();

                caches.open(
                  CACHE_NAME
                ).then(
                  (cache) =>
                    cache.put(
                      event.request,
                      copy
                    )
                );
              }

              return response;
            });
        })
    );

    return;
  }

  /*
   * 其他普通静态资源：
   *
   * 在线时优先拿最新版；
   * 请求成功以后才更新 Cache；
   * 离线时再使用旧 Cache。
   */


  /*
   * 第三方资源不由 Gama Music
   * 的 Service Worker 缓存。
   */
  if (
    url.origin !==
    self.location.origin
  ) {

    return;

  }


  event.respondWith(

    fetch(
      new Request(
        event.request,
        {
          cache:
            'no-store'
        }
      )
    )
      .then(
        (response) => {

          /*
           * 只有 HTTP 2xx 成功响应
           * 才允许写进 Cache。
           *
           * 避免把 404 / 500
           * 缓存成“最新版”。
           */
          if (
            response.ok
          ) {

            const copy =
              response.clone();


            caches
              .open(
                CACHE_NAME
              )
              .then(
                (cache) =>
                  cache.put(
                    event.request,
                    copy
                  )
              );

          }


          return response;

        }
      )
      .catch(
        async () => {

          /*
           * 离线时忽略类似：
           *
           * app.js?v=78
           *
           * 这样的 query string。
           */
          const cached =
            await caches.match(
              event.request,
              {
                ignoreSearch:
                  true
              }
            );


          if (
            cached
          ) {

            return cached;

          }


          /*
           * 只有真正打开页面时，
           * 才允许退回 index.html。
           *
           * JS / CSS 文件如果找不到，
           * 绝对不能返回 HTML。
           */
          if (
            event.request.mode ===
            'navigate'
          ) {

            const fallback =
              await caches.match(
                './index.html',
                {
                  ignoreSearch:
                    true
                }
              );


            if (
              fallback
            ) {

              return fallback;

            }

          }


          return Response.error();

        }
      )

  );
});
