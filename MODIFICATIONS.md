# Modifications (Gutenberg AI fork of Readest)

This repository is a **modified version** of [Readest](https://github.com/readest/readest)
(© Bilingify LLC), distributed under the same license, the
[GNU Affero General Public License v3.0](LICENSE). Branch: `gutenberg-ai`.
Upstream base: `readest/readest@c811741af8a76c3b90a9d2d443c9972d256da957`.

Modifications © 2026 Gutenberg AI contributors, licensed AGPL-3.0. They let a
self-hosted deployment serve its own multilingual public-domain library with
pre-translated and pre-recorded content only.

## Source offer (AGPL section 13)

Every deployment of this fork shows users a link to the exact source commit it
runs: the About window and the library menu item **Source code (AGPL)**. The
link is built from `SOURCE_REPOSITORY_URL` (runtime env) and the commit baked
into the image (`NEXT_PUBLIC_SOURCE_COMMIT` build argument). Operators must only
deploy commits that are pushed to that repository.

## Changes

| Date | Area | Files | Change |
|---|---|---|---|
| 2026-10-25 | Self-host catalog | `src/services/runtimeConfig.ts`, `src/app/opds/components/CatalogManager.tsx`, `src/app/api/opds/proxy/route.ts` | Featured OPDS catalog (`FEATURED_OPDS_CATALOG_*`) seeded on first visit; `OPDS_TRUSTED_HOSTS` lets the proxy reach the operator's private catalog |
| 2026-10-25 | Telemetry | `apps/readest-app/.env` | Upstream PostHog default key removed: no telemetry from self-hosted builds |
| 2026-10-25 | Starter books | `src/app/library/hooks/useDemoBooks.ts` | `DEMO_BOOK_URLS` replaces the bundled demo books |
| 2026-10-25 | Language | `src/components/LanguageSwitcher.tsx` (new), `src/services/gutenbergLibrary.ts` (new), `LibraryHeader.tsx`, `opds/components/Navigation.tsx`, `reader/components/HeaderBar.tsx` | Header language selector: one choice sets the UI and content language |
| 2026-10-25 | Catalog | `src/app/opds/page.tsx`, `src/app/opds/components/PublicationView.tsx` | Library feeds fetched with `?lang=`; reload on language change; request translation/narration buttons |
| 2026-10-25 | Library | `src/app/library/components/Bookshelf.tsx`, `src/app/library/page.tsx`, `src/app/library/hooks/useLibraryLanguageSync.ts` (new) | One shelf entry per work in the reader's language; editions fetched on language change |
| 2026-10-25 | Reader | `src/app/reader/hooks/useEditionSwitch.ts` (new) | Switching language opens the same work's edition at the same chapter, or requests it |
| 2026-10-25 | Speech | `src/services/tts/TTSController.ts`, `src/services/tts/wordPronouncer.ts`, `src/app/reader/hooks/useTTSControl.ts` | `RECORDED_NARRATION_ONLY`: only narration embedded in the book plays (no Edge, Web Speech, Readest Voice or custom TTS); missing narration is requested from the library |
| 2026-10-25 | Translation | `src/services/translators/providers/index.ts`, `src/hooks/useTranslator.ts`, `src/app/reader/components/TranslationToggler.tsx`, `src/app/reader/components/annotator/Annotator.tsx` | `DISABLE_ONLINE_TRANSLATION`: no DeepL, Azure, Google, Yandex or AI translators |
| 2026-10-25 | Licensing | `src/utils/sourceOffer.ts` (new), `src/components/AboutWindow.tsx`, `src/app/library/components/SettingsMenu.tsx`, `Dockerfile`, `MODIFICATIONS.md` (new) | AGPL section 13 source offer and modification notices |
| 2026-10-25 | Shared library | `src/services/cloudService.ts`, `src/services/bookService.ts`, `src/services/gutenbergLibrary.ts`, `src/pages/api/storage/upload.ts`, `src/app/library/components/BookItem.tsx`, `src/app/library/utils/libraryUtils.ts` | `SHARED_LIBRARY_ONLY`: catalog books are never uploaded per user; every device fetches the exact file (by Readest hash) from the shared catalog; book uploads and sharing are disabled |
| 2026-10-25 | Strings | `public/locales/*/translation.json` | Translations of the new UI strings |
| 2026-10-26 | Serverless web | `next.config.mjs`, `src/libs/serverlessApi.ts` (new), `src/context/EnvContext.tsx`, `src/services/runtimeConfig.ts`, `src/app/s/page.tsx`, `src/utils/nav.ts`, `src/app/reader/hooks/useEditionSwitch.ts` | `BUILD_STATIC_EXPORT=true` builds the web app as a static export; with runtime `serverless: true` the sync, replica and account-deletion routes run in the browser against Supabase (row-level security), other `/api` routes answer 501, and reader URLs use the query form |
| 2026-10-26 | Catalog | `src/services/gutenbergLibrary.ts`, `src/app/opds/utils/opdsReq.ts` | Supabase/PostgREST catalog backend (`…/rest/v1/rpc/opds`, `catalog_languages`, `catalog_work`, `request_edition`); content-addressed files (`libraryFilesUrl`/`libraryCoversUrl`); no OPDS proxy in serverless mode |
| 2026-10-26 | Serverless web | `src/app/opds/page.tsx`, `src/app/opds/components/CatalogManager.tsx` | Every feed fetch and catalog validation decides the proxy through `needsProxy` (an `apikey` workaround in `src/utils/supabase.ts` was removed once the host's API edge answered CORS) |
| 2026-10-26 | Serverless web | `public/coi-serviceworker.js` (new), `src/app/layout.tsx`, `src/pages/_document.tsx`, `src/utils/supabase.ts`, `src/hooks/useInboxDrainer.ts` | Static export builds load a service worker that adds the COOP/COEP headers the Turso WASM database needs (static hosts cannot); per-request Supabase clients never persist or refresh the session; Send to Readest inbox draining is skipped without a server |
| 2026-10-26 | Accounts | `src/app/auth/hooks/useAuthProviders.ts` (new), `src/app/auth/components/AuthPanel.tsx` | Self-hosted builds show only the sign-in providers the Auth server has enabled (`/auth/v1/settings`) instead of a fixed list that fails with "provider is not enabled" |
| 2026-10-26 | Accounts | `src/utils/access.ts` | On web, an access token that has expired (or expires within a minute) is refreshed through supabase-js before it is used, so the first sync after a long pause is not refused |
| 2026-10-28 | Discovery | `src/components/BrowseLibraryButton.tsx` (new), `src/services/gutenbergLibrary.ts`, `src/app/library/components/LibraryHeader.tsx`, `Bookshelf.tsx`, `LibraryEmptyState.tsx`, `src/app/opds/components/Navigation.tsx` | With an operator catalog: a Browse books button in the library header, a Browse tile instead of the import tile (shared-library mode), an empty state that leads to the catalog, a "Search all books" action from the library search, and plain-language catalog search |
| 2026-10-28 | Branding | `src/utils/appBrand.ts` (new), `src/app/layout.tsx`, `src/pages/_app.tsx`, `src/app/auth/components/AuthPanel.tsx`, `src/utils/window.ts`, `src/utils/nav.ts` | Build-time `NEXT_PUBLIC_APP_NAME`/`_TAGLINE`/`_DESCRIPTION`/`_URL` name the deployment (default Readest); the About window still credits Readest |
| 2026-10-28 | Strings | `public/locales/*/translation.json` | Translations of the new discovery and sign-in strings |
| 2026-10-29 | Native config | `src/app/layout.tsx`, `src/pages/_document.tsx` | Non-web builds with `NEXT_PUBLIC_EMBEDDED_RUNTIME_CONFIG` (a JSON object) embed it as `window.__READEST_RUNTIME_CONFIG` in a plain inline `<script>` in `<head>` (the app router runs an inline `next/script` only after hydration starts, too late), because native builds are not served `/runtime-config.js` |
| 2026-10-29 | Updates | `src/helpers/updater.ts` | With runtime `selfHosted`, the app never fetches Readest's update feeds or release notes |
| 2026-10-29 | Android | `src-tauri/tauri.librebooks.conf.json` (new), `.gitignore` | Override config merged with `--config` for the Librebooks Android app: product name and application id, one `librebooks` deep-link scheme, no updater endpoints, a CSP without Readest, Sentry, PostHog or Stripe hosts, no updater artifacts |
| 2026-10-31 | Mobile catalog | `src/app/opds/components/Navigation.tsx`, `public/locales/*/translation.json` | The catalog search box takes focus only with a fine pointer (mouse), so phones no longer open the keyboard on every catalog page; plural forms (`_one`, `_few`, ...) for the "Added {{count}} books in your language" toast. |

"Readest" is a name of the upstream project; this fork is not endorsed by Bilingify LLC.
