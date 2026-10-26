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
