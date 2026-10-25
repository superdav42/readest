// The operator's own library (self-hosted OPDS catalog + on-demand editions).
//
// One language setting drives everything: the interface language chosen in the
// header is also the language books are shown and read in. Catalog feeds take a
// `lang` parameter; each work is listed once in the best form available in that
// language, and missing translations or narrations can be requested.
import i18n from '@/i18n/i18n';
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
  const match = identifier?.match(/urn:gutenberg-ai:(\d+)/);
  return match ? Number(match[1]) : null;
};

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const base = getCatalogBase();
  if (!base) throw new Error('library_not_configured');
  const res = await fetch(`${base}/api${path}`, init);
  if (!res.ok) throw new Error(`library_api_${res.status}`);
  return (await res.json()) as T;
};

let languagesPromise: Promise<LibraryLanguage[]> | null = null;
export const fetchLibraryLanguages = (): Promise<LibraryLanguage[]> => {
  languagesPromise ??= api<LibraryLanguage[]>('/languages').catch((error) => {
    languagesPromise = null;
    throw error;
  });
  return languagesPromise;
};

export const fetchWork = (workId: number, lang = getContentLanguage()) =>
  api<LibraryWork>(`/works/${workId}?lang=${encodeURIComponent(lang)}`);

export type RequestResult =
  | (LibraryJob & { status: LibraryJob['status'] })
  | { status: 'available' | 'unsupported'; kind?: string };

export const requestEdition = (workId: number, lang: string, kind: 'translation' | 'readalong') =>
  api<RequestResult>('/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_id: workId, lang, kind }),
  });

/** Announce a language change to pages that show library content. */
export const announceContentLanguage = (lang: string) =>
  eventDispatcher.dispatch(CONTENT_LANGUAGE_EVENT, { lang });
