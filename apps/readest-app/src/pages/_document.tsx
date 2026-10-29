// Modified 2026-10-26 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import { Html, Head, Main, NextScript } from 'next/document';
import Script from 'next/script';

// Only the web/Docker build serves `/runtime-config.js`. See app/layout.tsx.
const shouldInjectRuntimeConfig = process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';
// Static web export: no server to send the cross-origin isolation headers the
// Turso WASM database needs, so a service worker adds them (public/coi-serviceworker.js).
const shouldInjectIsolationWorker = process.env['BUILD_STATIC_EXPORT'] === 'true';
// Native (Tauri) builds get no /runtime-config.js: embed the deployment's
// config at build time (NEXT_PUBLIC_EMBEDDED_RUNTIME_CONFIG, a JSON object). See app/layout.tsx.
const embeddedRuntimeConfig =
  process.env['NEXT_PUBLIC_APP_PLATFORM'] !== 'web'
    ? process.env['NEXT_PUBLIC_EMBEDDED_RUNTIME_CONFIG']
    : undefined;
const embeddedRuntimeConfigScript = embeddedRuntimeConfig
  ? `window.__READEST_RUNTIME_CONFIG=${JSON.stringify(JSON.parse(embeddedRuntimeConfig))
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')};`
  : null;

export default function Document() {
  return (
    <Html lang='en'>
      <Head />
      <body>
        {/* beforeInteractive must live in _document (not _app) to guarantee the
            script runs before any client-side module evaluation. */}
        {embeddedRuntimeConfigScript ? (
          <Script id='embedded-runtime-config' strategy='beforeInteractive'>
            {embeddedRuntimeConfigScript}
          </Script>
        ) : null}
        {shouldInjectRuntimeConfig ? (
          <Script src='/runtime-config.js' strategy='beforeInteractive' />
        ) : null}
        {shouldInjectIsolationWorker ? (
          <Script src='/coi-serviceworker.js' strategy='beforeInteractive' />
        ) : null}
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
