export interface ReadestRuntimeConfig {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
  objectStorageType?: string;
  storageFixedQuota?: number;
  translationFixedQuota?: number;
  fontBaseUrl?: string;
  selfHosted?: boolean;
  /** The operator's own OPDS catalog: listed first and added on first run. */
  featuredCatalogUrl?: string;
  featuredCatalogName?: string;
  featuredCatalogDescription?: string;
  /** Hostnames the OPDS proxy may reach even though they are private (the operator's own catalog). */
  opdsTrustedHosts?: string[];
  /** Starter books imported on a browser's first visit instead of the bundled demo set. */
  demoBookUrls?: string[];
  /** Read Aloud plays only recordings shipped with the book: no Edge, Google, Readest or custom TTS. */
  recordedNarrationOnly?: boolean;
  /** Hide on-the-fly machine translation (DeepL, Google, Azure, Yandex, AI providers). */
  onlineTranslationDisabled?: boolean;
}

/** Parse the comma-separated OPDS_TRUSTED_HOSTS env value. */
export const parseTrustedHosts = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

declare global {
  interface Window {
    __READEST_RUNTIME_CONFIG?: ReadestRuntimeConfig;
  }
}

export const getRuntimeConfig = () =>
  typeof window === 'undefined' ? undefined : window.__READEST_RUNTIME_CONFIG;

export const getServerRuntimeConfig = (): ReadestRuntimeConfig => ({
  // Browser runtime config should prefer a public Supabase URL when provided.
  // SUPABASE_URL remains as a backward-compatible fallback for non-split setups.
  supabaseUrl:
    process.env['SUPABASE_PUBLIC_URL'] ??
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ??
    process.env['SUPABASE_URL'],
  supabaseAnonKey: process.env['SUPABASE_ANON_KEY'] ?? process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  apiBaseUrl:
    process.env['API_BASE_URL'] ??
    process.env['NEXT_PUBLIC_API_BASE_URL'] ??
    process.env['SITE_URL'],
  // These were previously baked as NEXT_PUBLIC_* build args; now read from runtime env so
  // the published image can be configured without rebuilding.
  objectStorageType:
    process.env['OBJECT_STORAGE_TYPE'] ?? process.env['NEXT_PUBLIC_OBJECT_STORAGE_TYPE'],
  // A self-hosted deployment unlocks every premium feature: there is no store
  // to buy from, and the operator already runs the infrastructure the paywall
  // funds.
  selfHosted:
    (process.env['SELF_HOSTED'] || process.env['NEXT_PUBLIC_SELF_HOSTED']) === 'true' || undefined,
  storageFixedQuota: (() => {
    const raw =
      process.env['STORAGE_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_STORAGE_FIXED_QUOTA'];
    return raw ? parseInt(raw, 10) : undefined;
  })(),
  translationFixedQuota: (() => {
    const raw =
      process.env['TRANSLATION_FIXED_QUOTA'] ?? process.env['NEXT_PUBLIC_TRANSLATION_FIXED_QUOTA'];
    return raw ? parseInt(raw, 10) : undefined;
  })(),
  // Base URL of the directory holding the self-hosted CJK webfont bundles.
  // Readest's own CDN only answers CORS for readest.com origins, so a
  // self-hosted deployment on a custom domain has to serve them itself (#5550).
  // `||` not `??`: compose passes the variable through even when it is unset,
  // and an empty string would build root-relative font URLs.
  fontBaseUrl:
    process.env['FONT_BASE_URL'] || process.env['NEXT_PUBLIC_FONT_BASE_URL'] || undefined,
  featuredCatalogUrl: process.env['FEATURED_OPDS_CATALOG_URL'] || undefined,
  featuredCatalogName: process.env['FEATURED_OPDS_CATALOG_NAME'] || undefined,
  featuredCatalogDescription: process.env['FEATURED_OPDS_CATALOG_DESCRIPTION'] || undefined,
  opdsTrustedHosts: parseTrustedHosts(process.env['OPDS_TRUSTED_HOSTS']),
  demoBookUrls: (process.env['DEMO_BOOK_URLS'] ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),
  recordedNarrationOnly: process.env['RECORDED_NARRATION_ONLY'] === 'true' || undefined,
  onlineTranslationDisabled: process.env['DISABLE_ONLINE_TRANSLATION'] === 'true' || undefined,
});
