// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-25 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
// The operator's own library (self-hosted OPDS catalog + on-demand editions).
//
// One language setting drives everything: the interface language chosen in the
// header is also the language books are shown and read in. Catalog feeds take a
// `lang` parameter; each work is listed once in the best form available in that
// language, and missing translations or narrations can be requested.
//
// Two catalog backends share this API: the self-hosted catalog server
// (`<base>/opds…`, `<base>/api/…`) and a Supabase/PostgREST catalog whose feeds
// are RPCs (`<supabase>/rest/v1/rpc/opds?path=…`; serverless deployments).
import i18n from '@/i18n/i18n';
import type { Book } from '@/types/book';
import { getRuntimeConfig } from '@/services/runtimeConfig';
import { eventDispatcher } from '@/utils/event';

export const CONTENT_LANGUAGE_EVENT = 'content-language-changed';
export const REQUEST_REL = 'http://gutenberg-ai.org/rel/request';

export interface LibraryLanguage {
  code: string;
  name: string;
  available: number;
  narration: boolean;
}

export interface LibraryJob {
  id: string;
  kind: 'translation' | 'readalong';
  status: 'queued' | 'running' | 'done' | 'failed';
  position?: number;
}

export interface LibraryWork {
  work_id: number;
  lang: string;
  title: string;
  best: {
    kind: 'original' | 'translation' | 'readalong';
    lang: string;
    url: string;
    updated: number;
  } | null;
  narration_available: boolean;
  jobs: LibraryJob[];
}

/** Base URL of the catalog (featured catalog URL without its `/opds…` path). */
export const getCatalogBase = (): string | null => {
  const url = getRuntimeConfig()?.featuredCatalogUrl;
  if (!url) return null;
  const at = url.indexOf('/opds');
  return at > 0 ? url.slice(0, at) : null;
};

export const isLibraryUrl = (url: string): boolean => {
  const base = getCatalogBase();
  return !!base && url.startsWith(base);
};

/** Content language code (`es`, `zh`, …) from a UI language tag (`es-MX`, `zh-CN`). */
export const toContentLanguage = (uiLanguage?: string): string =>
  (uiLanguage || i18n.language || 'en').split(/[-_]/)[0]!.toLowerCase();

export const getContentLanguage = (): string => toContentLanguage(i18n.language);

/** Point a catalog URL at the current content language (other URLs pass through). */
export const withContentLanguage = (url: string, lang = getContentLanguage()): string => {
  if (!isLibraryUrl(url)) return url;
  const parsed = new URL(url);
  const search = parsed.pathname.match(/^(.*\/opds\/search\/)[^/]+$/);
  if (search) {
    parsed.pathname = `${search[1]}${lang}`;
  } else if (parsed.pathname.includes('/opds')) {
    parsed.searchParams.set('lang', lang);
  }
  return parsed.toString();
};

/** Work id from an edition identifier: `urn:gutenberg-ai:<id>[:<lang>]` or `urn:gutenberg-ai:<id>-…`. */
export const parseWorkId = (identifier?: string | null): number | null => {
  // Derived editions use our URN; verbatim originals keep PG's own identifier
  // (http://www.gutenberg.org/<id>), which the catalog also serves.
  const match =
    identifier?.match(/urn:gutenberg-ai:(\d+)/) ??
    identifier?.match(/^https?:\/\/(?:www\.)?gutenberg\.org\/(?:ebooks\/)?(\d+)\/?$/);
  return match ? Number(match[1]) : null;
};

/** The catalog is a set of PostgREST RPCs (`…/rest/v1/rpc`) rather than the catalog server. */
const isRpcCatalog = (base: string): boolean => /\/rest\/v1\/rpc$/.test(base);

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const base = getCatalogBase();
  if (!base) throw new Error('library_not_configured');
  const res = await fetch(`${base}${isRpcCatalog(base) ? '' : '/api'}${path}`, init);
  if (!res.ok) throw new Error(`library_api_${res.status}`);
  return (await res.json()) as T;
};

const rpcBase = (): boolean => isRpcCatalog(getCatalogBase() ?? '');

let languagesPromise: Promise<LibraryLanguage[]> | null = null;
export const fetchLibraryLanguages = (): Promise<LibraryLanguage[]> => {
  languagesPromise ??= api<LibraryLanguage[]>(
    rpcBase() ? '/catalog_languages' : '/languages',
  ).catch((error) => {
    languagesPromise = null;
    throw error;
  });
  return languagesPromise;
};

export const fetchWork = (workId: number, lang = getContentLanguage()) =>
  api<LibraryWork>(
    rpcBase()
      ? `/catalog_work?p_work_id=${workId}&p_lang=${encodeURIComponent(lang)}`
      : `/works/${workId}?lang=${encodeURIComponent(lang)}`,
  );

export type RequestResult =
  | (LibraryJob & { status: LibraryJob['status'] })
  | { status: 'available' | 'unsupported'; kind?: string };

export const requestEdition = (workId: number, lang: string, kind: 'translation' | 'readalong') =>
  rpcBase()
    ? api<RequestResult>('/request_edition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_work_id: workId, p_lang: lang, p_kind: kind }),
      })
    : api<RequestResult>('/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_id: workId, lang, kind }),
      });

/** App route that opens the operator's catalog (in the reader's language), or null. */
export const getLibraryBrowsePath = (): string | null => {
  const url = getRuntimeConfig()?.featuredCatalogUrl;
  return url ? `/opds/?url=${encodeURIComponent(withContentLanguage(url))}` : null;
};

/** App route that searches the operator's catalog for `query`, or null. */
export const getLibrarySearchPath = (query: string, lang = getContentLanguage()): string | null => {
  const base = getCatalogBase();
  const q = query.trim();
  if (!base || !q) return null;
  const feed = isRpcCatalog(base)
    ? `${base}/opds?path=search&lang=${encodeURIComponent(lang)}&query=${encodeURIComponent(q)}`
    : `${base}/opds/search/${encodeURIComponent(lang)}?query=${encodeURIComponent(q)}`;
  return `/opds/?url=${encodeURIComponent(feed)}`;
};

/** Announce a language change to pages that show library content. */
export const announceContentLanguage = (lang: string) =>
  eventDispatcher.dispatch(CONTENT_LANGUAGE_EVENT, { lang });

/** Work id of a library book imported from our catalog, else null. */
export const getBookWorkId = (book: Pick<Book, 'metadata'>): number | null =>
  parseWorkId(book.metadata?.identifier);

/** Shared library mode: book files come from the catalog, never per-user uploads. */
export const isSharedLibraryOnly = (): boolean => !!getRuntimeConfig()?.sharedLibraryOnly;

export const isSharedLibraryBook = (book: Pick<Book, 'metadata'>): boolean =>
  isSharedLibraryOnly() && getBookWorkId(book) !== null;

/** Catalog URL of the exact file a library book was imported from (or its cover). */
export const getSharedBookUrl = (book: Book, part: 'book' | 'cover' = 'book'): string | null => {
  // Content-addressed hosting: every edition ever published stays at its hash.
  const config = getRuntimeConfig();
  if (part === 'book' && config?.libraryFilesUrl)
    return `${config.libraryFilesUrl}/${book.hash}.epub`;
  if (part === 'cover' && config?.libraryCoversUrl)
    return `${config.libraryCoversUrl}/${book.hash}.jpg`;
  const base = getCatalogBase();
  if (!base) return null;
  const lang = getBookLanguage(book);
  const query = new URLSearchParams({
    identifier: book.metadata?.identifier ?? '',
    lang,
  });
  return `${base}/api/files/by-hash/${book.hash}${part === 'cover' ? '/cover' : ''}?${query}`;
};

export const getBookLanguage = (book: Book): string => {
  const lang = book.metadata?.language;
  return toContentLanguage((Array.isArray(lang) ? lang[0] : lang) || book.primaryLanguage);
};

/**
 * One shelf entry per work: the edition in the reader's language (narrated
 * first), else the most recently used edition. Books from other sources pass
 * through unchanged.
 */
export const pickEditionsForLanguage = (books: Book[], lang: string): Book[] => {
  const byWork = new Map<number, Book[]>();
  const others: Book[] = [];
  for (const book of books) {
    const workId = getBookWorkId(book);
    if (workId === null) others.push(book);
    else byWork.set(workId, [...(byWork.get(workId) ?? []), book]);
  }
  const picked = [...byWork.values()].map((editions) => {
    const inLang = editions.filter((book) => getBookLanguage(book) === lang);
    const pool = inLang.length ? inLang : editions;
    return [...pool].sort(
      (a, b) =>
        Number(!!b.hasNarration) - Number(!!a.hasNarration) ||
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    )[0]!;
  });
  const keep = new Set([...others, ...picked]);
  return books.filter((book) => keep.has(book));
};

// ---------- Discover home (catalog_home / catalog_related RPCs) ----------

/** A book on the Discover screen: the edition to open in the reader's language. */
export interface DiscoverCard {
  work_id: number;
  title: string;
  author?: string | null;
  kind: 'original' | 'translation' | 'readalong';
  lang: string;
  size?: number | null;
  url: string;
  cover: string;
  identifier: string;
}

export interface DiscoverSection {
  id: string;
  kind: 'popular' | 'readalong' | 'shelf';
  title?: string;
  shelf?: string;
  items: DiscoverCard[];
}

export interface DiscoverHome {
  lang: string;
  sections: DiscoverSection[];
}

/** Discover needs the Supabase catalog (its RPCs); other backends keep the plain library. */
export const isDiscoverAvailable = (): boolean => isSharedLibraryOnly() && rpcBase();

const homeCacheKey = (lang: string) => `librebooks-discover-home:${lang}`;

/** The last home screen fetched for a language, shown instantly while a fresh one loads. */
export const getCachedDiscoverHome = (lang = getContentLanguage()): DiscoverHome | null => {
  try {
    const raw = localStorage.getItem(homeCacheKey(lang));
    return raw ? (JSON.parse(raw) as DiscoverHome) : null;
  } catch {
    return null;
  }
};

export const fetchDiscoverHome = async (lang = getContentLanguage()): Promise<DiscoverHome> => {
  const home = await api<DiscoverHome>(`/catalog_home?p_lang=${encodeURIComponent(lang)}`);
  try {
    localStorage.setItem(homeCacheKey(lang), JSON.stringify(home));
  } catch {
    // Storage full or unavailable: the screen still works, just without the instant cache.
  }
  return home;
};

export const fetchRelatedBooks = (workId: number, lang = getContentLanguage(), limit = 15) =>
  api<DiscoverCard[]>(
    `/catalog_related?p_work_id=${workId}&p_lang=${encodeURIComponent(lang)}&p_limit=${limit}`,
  );

/** The library's copy of a Discover card (same work in the same language), if imported. */
export const findLibraryEdition = (books: Book[], card: DiscoverCard): Book | undefined =>
  books.find(
    (book) =>
      !book.deletedAt &&
      getBookWorkId(book) === card.work_id &&
      getBookLanguage(book) === card.lang,
  );

/** App route for a full catalog feed (`popular`, `readalong` or a genre shelf), or null. */
export const getLibraryFeedPath = (
  feed: 'popular' | 'readalong' | 'shelf',
  shelf?: string,
  lang = getContentLanguage(),
): string | null => {
  const base = getCatalogBase();
  if (!base || !isRpcCatalog(base)) return null;
  const params = new URLSearchParams({ path: feed, lang });
  if (shelf) params.set('shelf', shelf);
  return `/opds/?url=${encodeURIComponent(`${base}/opds?${params}`)}`;
};
