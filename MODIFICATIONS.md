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

"Readest" is a name of the upstream project; this fork is not endorsed by Bilingify LLC.
