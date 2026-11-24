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
import type { LibraryVoices } from '@/services/tts/libraryVoice';
import { isOffline, savedVoicesListing } from '@/services/tts/voiceOffline';
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
  status: 'blocked' | 'queued' | 'running' | 'done' | 'failed';
  position?: number;
  /** Worker's status text, e.g. "narrating 42%". */
  progress?: string | null;
  /** Server estimate: `measured` when the worker reports its own percentage. */
  estimate?: { percent?: number; eta_seconds?: number; measured?: boolean };
  /** A translation job's preview: the book with only its opening translated (migration 0410). */
  preview?: {
    hash: string;
    url: string;
    cover?: string;
    size?: number | null;
    translated_chars?: number;
    total_chars?: number;
  };
}

export interface LibraryWork {
  work_id: number;
  lang: string;
  title: string;
  best: {
    kind: 'original' | 'translation' | 'readalong';
    lang: string;
    url: string;
    /** Content hash: the library's book.hash once imported. */
    hash?: string;
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

const voicesCache = new Map<string, Promise<LibraryVoices | null>>();

/**
 * Read-along voices of a work's text edition in a language (migration 0370), default first;
 * null when it has none or the catalog is not the Supabase one. Cached per session.
 */
export const fetchWorkVoices = (
  workId: number,
  lang: string,
  fresh = false,
): Promise<LibraryVoices | null> => {
  if (!rpcBase()) return Promise.resolve(null);
  const key = `${workId}:${lang}`;
  if (fresh) voicesCache.delete(key);
  let pending = voicesCache.get(key);
  if (!pending) {
    // Without a connection (or when the catalog cannot be reached) the voices saved on this
    // device are the listing (voiceOffline).
    pending = (
      isOffline()
        ? Promise.reject(new Error('offline'))
        : api<LibraryVoices | null>(
            `/work_voices?p_work=${workId}&p_lang=${encodeURIComponent(lang)}`,
          )
    ).catch(() => {
      voicesCache.delete(key);
      return savedVoicesListing(workId, lang).catch(() => null);
    });
    voicesCache.set(key, pending);
  }
  return pending;
};

/** One way to listen to a work: a LibriVox recording (migration 0420, `work_listen_options`). */
export interface ListenRecording {
  /** 'librivox-13477' (the library voice key once built). */
  key: string;
  librivox_id: number;
  title: string;
  /** Reader name, 'LibriVox volunteers', 'Dramatic reading'; null until readers are looked up. */
  label: string | null;
  readers: string[];
  solo: boolean | null;
  dramatic: boolean;
  year: number | null;
  /** Length of the whole recording. */
  seconds: number;
  sections: number;
  /** The LibriVox page. */
  url: string | null;
  /** Read from this very ebook (else same title and author, another text). */
  own: boolean;
  /** ready: built, playable with text; unchecked: not built yet. */
  status: 'ready' | 'unchecked';
  /** 15 s of the cleaned audio; null until made. */
  sample_url: string | null;
}

export interface ListenOptions {
  work_id: number;
  lang: string;
  title: string;
  /** The voices text edition (null until a voice is built). */
  text: { hash: string; url: string } | null;
  /** Built ones first. */
  recordings: ListenRecording[];
  ai: {
    available: boolean;
    status: 'ready' | 'preparing' | 'none';
    key: string;
    label: string;
    sample_url: string | null;
  };
}

/** The voices saved on this device, as listen options (catalog unreachable). */
const savedListenOptions = (workId: number, lang: string, saved: LibraryVoices): ListenOptions => {
  const human = saved.voices.filter((voice) => voice.kind !== 'ai');
  const ai = saved.voices.find((voice) => voice.kind === 'ai');
  return {
    work_id: workId,
    lang,
    title: '',
    text: { hash: saved.text.hash, url: saved.text.url },
    recordings: human.map((voice) => ({
      key: voice.key,
      librivox_id: Number(voice.key.match(/(\d+)$/)?.[1] ?? 0),
      title: voice.label,
      label: voice.label,
      readers: voice.narrators,
      solo: voice.info?.solo ?? null,
      dramatic: voice.kind === 'dramatized' || !!voice.info?.dramatic,
      year: null,
      seconds: voice.duration_seconds ?? voice.tracks.reduce((sum, t) => sum + t.seconds, 0),
      sections: voice.tracks.length,
      url: voice.info?.url ?? null,
      own: true,
      status: 'ready',
      sample_url: null,
    })),
    ai: {
      available: !!ai,
      status: ai ? 'ready' : 'none',
      key: ai?.key ?? '',
      label: ai?.label ?? '',
      sample_url: null,
    },
  };
};

/**
 * Every way to listen to a work in a language: its LibriVox recordings and the AI narration.
 * When the catalog cannot be reached, what is saved on this device is the listing (or an
 * empty one: Read now is always offered).
 */
export const fetchListenOptions = async (workId: number, lang: string): Promise<ListenOptions> => {
  try {
    if (!rpcBase()) throw new Error('library_not_rpc');
    if (isOffline()) throw new Error('offline');
    const options = await api<ListenOptions>(
      `/work_listen_options?p_work=${workId}&p_lang=${encodeURIComponent(lang)}`,
    );
    return { ...options, recordings: options.recordings ?? [] };
  } catch {
    const saved = await savedVoicesListing(workId, lang).catch(() => null);
    if (saved) return savedListenOptions(workId, lang, saved);
    return {
      work_id: workId,
      lang,
      title: '',
      text: null,
      recordings: [],
      ai: { available: false, status: 'none', key: '', label: '', sample_url: null },
    };
  }
};

/** The original LibriVox recording of a work, to play while its read-along voice is made. */
export interface VoiceSource {
  key: string;
  librivox_id?: number | null;
  title?: string | null;
  readers: string[];
  tracks: { title?: string; seconds: number; url: string }[];
}

/** Answer of request_voice (migration 0391). */
export interface VoiceRequest {
  /** ready: the tracks asked for are built; queued/running: a job is on it; unavailable: no recording. */
  status: 'ready' | 'queued' | 'running' | 'blocked' | 'unavailable';
  source?: VoiceSource | null;
}

/**
 * A listener is at `track` (0-based) of the work's human voice: make sure it and the `ahead`
 * tracks after it are built (a reader-priority job when they are not). Idempotent, so it is
 * called again and again while listening; `source` carries the original recording once a
 * worker has fetched it.
 */
export const requestVoice = async (
  workId: number,
  lang: string,
  track = 0,
  ahead = 2,
): Promise<VoiceRequest> => {
  if (!rpcBase()) return { status: 'unavailable' };
  try {
    if (isOffline()) throw new Error('offline');
    return await api<VoiceRequest>('/request_voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_work: workId, p_lang: lang, p_track: track, p_ahead: ahead }),
    });
  } catch (error) {
    // The catalog cannot be reached: a voice saved on this device (voiceOffline) is ready.
    if (await savedVoicesListing(workId, lang).catch(() => null)) return { status: 'ready' };
    throw error;
  }
};

/** Catalog metadata of one published edition file. */
export interface CatalogEdition {
  hash: string;
  work_id: number;
  kind: 'original' | 'translation' | 'readalong' | 'audiobook';
  lang: string;
  title: string;
  authors: string[];
  size?: number | null;
}

/**
 * Catalog rows for edition files, by content hash (one small request, no book download).
 * Supabase catalog only; resolves to [] for other backends.
 */
export const fetchEditionsByHash = async (hashes: string[]): Promise<CatalogEdition[]> => {
  const base = getCatalogBase();
  if (!base || !isRpcCatalog(base) || !hashes.length) return [];
  const list = hashes.map((hash) => encodeURIComponent(hash)).join(',');
  const res = await fetch(
    `${base.replace(/\/rpc$/, '')}/editions?select=hash,work_id,kind,lang,title,authors,size&hash=in.(${list})`,
  );
  if (!res.ok) throw new Error(`library_api_${res.status}`);
  return (await res.json()) as CatalogEdition[];
};

/** Give up on the text-edition lookup after this long: the read-along then opens as before. */
const TEXT_EDITION_TIMEOUT_MS = 5000;

/**
 * The text-only edition of a work in a language: its current translation, else its original
 * (the same text a read-along edition narrates, without the audio: a few hundred KB against
 * tens of MB, which freezes a slow phone while it opens). Null when there is none, the
 * catalog is not the Supabase one, or the lookup fails: the caller keeps the edition it has.
 */
export const fetchTextEdition = async (
  workId: number,
  lang: string,
): Promise<(CatalogEdition & { kind: 'original' | 'translation'; url: string }) | null> => {
  const base = getCatalogBase();
  const filesUrl = getRuntimeConfig()?.libraryFilesUrl;
  if (!base || !isRpcCatalog(base) || !filesUrl) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TEXT_EDITION_TIMEOUT_MS);
  try {
    const query = new URLSearchParams({
      select: 'hash,work_id,kind,lang,title,authors,size',
      work_id: `eq.${workId}`,
      lang: `eq.${lang}`,
      current: 'is.true',
      kind: 'in.(translation,original)',
    });
    const res = await fetch(`${base.replace(/\/rpc$/, '')}/editions?${query}`, {
      signal: abort.signal,
    });
    if (!res.ok) return null;
    const rows = ((await res.json()) as CatalogEdition[]).filter(
      (row): row is CatalogEdition & { kind: 'original' | 'translation' } =>
        !!row.hash && (row.kind === 'translation' || row.kind === 'original'),
    );
    const text = rows.find((row) => row.kind === 'translation') ?? rows[0];
    return text ? { ...text, url: `${filesUrl}/${text.hash}.epub` } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

export type RequestResult =
  | (LibraryJob & { status: LibraryJob['status'] })
  | { status: 'available' | 'unsupported'; kind?: string };

/** Ask for an edition; a narration request may say which text section to narrate first. */
export const requestEdition = (
  workId: number,
  lang: string,
  kind: 'translation' | 'readalong',
  startSection?: number,
) =>
  rpcBase()
    ? api<RequestResult>('/request_edition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_work_id: workId,
          p_lang: lang,
          p_kind: kind,
          ...(kind === 'readalong' && startSection != null
            ? { p_start_section: startSection }
            : {}),
        }),
      })
    : api<RequestResult>('/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_id: workId, lang, kind }),
      });

export type PassageReportCategory =
  | 'meaning'
  | 'missing'
  | 'grammar'
  | 'untranslated'
  | 'formatting'
  | 'offensive'
  | 'other';

export interface PassageReport {
  workId: number;
  lang: string;
  quote: string;
  category: PassageReportCategory;
  comment?: string;
  /** Content hash of the edition being read, when known. */
  hash?: string;
}

/** A library edition that is a translation (its identifier carries a target language). */
export const isTranslatedLibraryBook = (book: Pick<Book, 'metadata'>): boolean =>
  isSharedLibraryOnly() && /urn:gutenberg-ai:\d+:[a-z]{2}/.test(book.metadata?.identifier ?? '');

/** Collapse whitespace and cut to `max` characters without splitting a surrogate pair. */
const clipReportText = (text: string, max: number): string =>
  Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, max).join('');

/**
 * Report a problem with an edition: a selected passage, or (empty quote) the whole translation
 * or narration, including offensive content. The library stores the report for its operator.
 * Throws `library_api_<status>` (429: too many reports; 404: no such edition) and
 * `library_report_rejected` when the library answers without `ok`.
 */
export const reportPassage = async (report: PassageReport) => {
  const quote = clipReportText(report.quote, 1000);
  const comment = clipReportText(report.comment ?? '', 1000) || undefined;
  const hash = report.hash && /^[0-9a-f]{32}$/.test(report.hash) ? report.hash : undefined;
  // A stalled connection must not leave the report dialog waiting for ever.
  const signal =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined;
  const result = rpcBase()
    ? await api<{ ok: boolean }>('/report_passage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_work_id: report.workId,
          p_lang: report.lang,
          p_quote: quote,
          p_category: report.category,
          p_comment: comment ?? null,
          p_hash: hash ?? null,
        }),
        signal,
      })
    : await api<{ ok: boolean }>('/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_id: report.workId,
          lang: report.lang,
          quote,
          category: report.category,
          comment,
          hash,
        }),
        signal,
      });
  if (!result?.ok) throw new Error('library_report_rejected');
  return result;
};

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

/** Cover of a published edition on the library host (covers are named by the edition's hash). */
export const getEditionCoverUrl = (hash: string): string | null => {
  const base = getRuntimeConfig()?.libraryCoversUrl;
  return base ? `${base}/${hash}.jpg` : null;
};

/**
 * What to show for a requested book. A request keeps the title and cover of the book it was made
 * from, which is the original-language edition when the reader asked from it (an English title and
 * cover in a Spanish interface), so prefer what the catalog says now: the title in the request's
 * language and, once an edition in that language is published, its cover.
 */
export const getRequestDisplay = (
  request: Pick<RequestedBook, 'lang' | 'title' | 'cover'>,
  work?: LibraryWork | null,
): { title: string; cover: string } => {
  const best = work?.best;
  const edition = best && best.lang === request.lang && best.hash ? best.hash : null;
  return {
    title: work?.title || request.title,
    cover: (edition && getEditionCoverUrl(edition)) || request.cover,
  };
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
/**
 * The library's copy of an edition: by exact content hash when given (narration editions of
 * one work and language replace each other as they grow), else any copy of that work in
 * that language.
 */
export const findLibraryEdition = (
  books: Book[],
  card: Pick<DiscoverCard, 'work_id' | 'lang'> & { hash?: string },
): Book | undefined => {
  const matches = books.filter(
    (book) =>
      !book.deletedAt &&
      (card.hash
        ? book.hash === card.hash
        : getBookWorkId(book) === card.work_id && getBookLanguage(book) === card.lang),
  );
  // A work opened text-first can later gain a narrated copy: prefer that one.
  return matches.find((book) => book.hasNarration) ?? matches[0];
};

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

// ---------- Translations the reader asked for (kept on this device) ----------

export interface RequestedBook {
  work_id: number;
  /** The language asked for. */
  lang: string;
  /** What was asked for (older entries are translations). */
  kind?: 'translation' | 'readalong';
  title: string;
  author?: string | null;
  cover: string;
  requested_at: number;
  /** The edition available meanwhile (usually the English original). */
  original: { url: string; lang: string; size?: number | null };
}

const REQUESTS_KEY = 'librebooks-requested-translations';
export const REQUESTS_EVENT = 'librebooks-requests-changed';

export const getRequestedBooks = (): RequestedBook[] => {
  try {
    return JSON.parse(localStorage.getItem(REQUESTS_KEY) || '[]') as RequestedBook[];
  } catch {
    return [];
  }
};

const saveRequestedBooks = (books: RequestedBook[]) => {
  try {
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(books));
  } catch {
    // Storage unavailable: the request still reached the server.
  }
  eventDispatcher.dispatch(REQUESTS_EVENT, {});
};

/** Ask for a high-quality translation of a card and remember it on this device. */
export const requestTranslation = async (
  card: DiscoverCard,
  lang: string,
): Promise<RequestResult> => {
  const result = await requestEdition(card.work_id, lang, 'translation');
  const others = getRequestedBooks().filter(
    (b) =>
      !(
        b.work_id === card.work_id &&
        b.lang === lang &&
        (b.kind ?? 'translation') === 'translation'
      ),
  );
  saveRequestedBooks([
    {
      work_id: card.work_id,
      lang,
      kind: 'translation',
      title: card.title,
      author: card.author,
      cover: card.cover,
      requested_at: Date.now(),
      original: { url: card.url, lang: card.lang, size: card.size },
    },
    ...others,
  ]);
  return result;
};

export const forgetRequestedBook = (
  workId: number,
  lang: string,
  kind: 'translation' | 'readalong' = 'translation',
) =>
  saveRequestedBooks(
    getRequestedBooks().filter(
      (b) => !(b.work_id === workId && b.lang === lang && (b.kind ?? 'translation') === kind),
    ),
  );

/** Remember a narration request (made from the reader) so Discover can show its progress. */
export const rememberNarrationRequest = (
  book: Pick<RequestedBook, 'work_id' | 'lang' | 'title' | 'cover'> & { url: string },
) => {
  const others = getRequestedBooks().filter(
    (b) => !(b.work_id === book.work_id && b.lang === book.lang && b.kind === 'readalong'),
  );
  saveRequestedBooks([
    {
      work_id: book.work_id,
      lang: book.lang,
      kind: 'readalong',
      title: book.title,
      cover: book.cover,
      requested_at: Date.now(),
      original: { url: book.url, lang: book.lang },
    },
    ...others,
  ]);
};

// ---------- Books opened from a translation preview ----------

const PREVIEW_KEY = 'librebooks-preview-books';

const readPreviewBooks = (): Record<string, { lang: string; work_id: number }> => {
  try {
    return JSON.parse(localStorage.getItem(PREVIEW_KEY) || '{}');
  } catch {
    return {};
  }
};

/** Mark a library book (by hash) as a translation preview (only its opening is translated) or clear it. */
export const setPreviewBook = (hash: string, workId: number, lang: string, preview = true) => {
  const books = readPreviewBooks();
  if (preview) books[hash] = { lang, work_id: workId };
  else delete books[hash];
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(books));
  } catch {
    // Storage unavailable: the book opens without its preview notice.
  }
};

export const getPreviewBook = (hash: string): { lang: string; work_id: number } | null =>
  readPreviewBooks()[hash] ?? null;

export type TranslationWait =
  | { kind: 'preview'; url: string; hash: string; size?: number | null }
  | { kind: 'ready'; url: string; hash?: string }
  | { kind: 'queued'; position: number; etaSeconds?: number }
  | { kind: 'preparing'; percent?: number };

/**
 * Where a requested translation stands: the complete translation when it is published, else
 * the preview (the book with its opening translated, attached to the running job), else the
 * job's place in the queue.
 */
export const getTranslationWait = (work: LibraryWork, lang: string): TranslationWait => {
  if (work.best && work.best.lang === lang && work.best.kind !== 'original') {
    return { kind: 'ready', url: work.best.url, hash: work.best.hash };
  }
  const job = work.jobs.find((j) => j.kind === 'translation');
  if (job?.preview) {
    return {
      kind: 'preview',
      url: job.preview.url,
      hash: job.preview.hash,
      size: job.preview.size,
    };
  }
  if (job?.status === 'queued' || job?.status === 'blocked') {
    return { kind: 'queued', position: job.position ?? 1, etaSeconds: job.estimate?.eta_seconds };
  }
  return { kind: 'preparing', percent: job?.estimate?.percent };
};
