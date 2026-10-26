/*
 * SPDX-License-Identifier: AGPL-3.0-only
 * Added 2026-10-26 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
 *
 * Cross-origin isolation for static hosting (BUILD_STATIC_EXPORT builds).
 * The Turso WASM database needs SharedArrayBuffer, which browsers only allow in
 * a cross-origin isolated page (COOP: same-origin + COEP). The Next.js server
 * sets those headers in middleware; a static host may not let us set headers,
 * so this file adds them from a service worker instead.
 *
 * The same file runs in two places:
 *   - as a page script: registers itself and reloads once the worker controls the page;
 *   - as the service worker: re-serves same-origin responses with the headers.
 * Cross-origin requests pass through untouched; under COEP they need CORS (fetch)
 * or a Cross-Origin-Resource-Policy header (no-cors subresources such as <img>).
 */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
    if (new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(
      fetch(request).then((response) => {
        if (response.status === 0 || response.type === 'opaqueredirect') return response;
        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }),
    );
  });
} else {
  (() => {
    if (window.crossOriginIsolated || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    const reloadKey = 'coi-serviceworker-reloaded';
    navigator.serviceWorker.register('/coi-serviceworker.js', { scope: '/' }).then(
      (registration) => {
        const reloadOnce = () => {
          if (window.sessionStorage.getItem(reloadKey)) return;
          window.sessionStorage.setItem(reloadKey, '1');
          window.location.reload();
        };
        if (navigator.serviceWorker.controller) {
          // Controlled but not isolated: the page predates the worker's headers.
          reloadOnce();
        } else {
          registration.addEventListener('updatefound', () => {
            registration.installing?.addEventListener('statechange', (e) => {
              if (e.target.state === 'activated') reloadOnce();
            });
          });
          navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
        }
      },
      (error) => console.error('cross-origin isolation worker failed to register', error),
    );
  })();
}
