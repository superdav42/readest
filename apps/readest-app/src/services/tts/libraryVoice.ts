// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-03 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Library read-along voices. A Librebooks text edition marks every sentence with an id; each
// voice of it (a cleaned, aligned LibriVox recording, the AI narration, a dramatized
// production) is a set of streamed audio tracks plus a sync map from sentence ids to clips.
// Every voice shares the ids, so switching voices keeps the sentence the reader is on.
//
// sync.json: {version, voice, tracks: [{file, seconds}], sections: [{n, href, pars}]},
// a par being [sentence_id, track_index, clip_begin, clip_end, exact (1|0)].
import type { BookDoc } from '@/libs/document';
import {
  MediaOverlaySection,
  blockAncestor,
  textRangeOf,
  type NarrationPar,
} from './mediaOverlay/MediaOverlaySection';

export const LIBRARY_VOICE_PREFIX = 'library-voice:';

export type LibraryVoiceKind = 'human' | 'ai' | 'dramatized';

export interface LibraryVoiceInfo {
  key: string;
  kind: LibraryVoiceKind;
  label: string;
  narrators: string[];
  timing: 'exact' | 'approximate';
  default: boolean;
  duration_seconds?: number | null;
  sync_url: string;
  tracks: { href: string; title?: string; seconds: number }[];
  info?: {
    source?: string;
    dramatic?: boolean;
    solo?: boolean;
    partial?: boolean;
    url?: string;
    quality?: { score?: number; cleaned?: boolean };
  };
}

export interface LibraryVoices {
  work_id: number;
  lang: string;
  text: { hash: string; url: string; cover_url?: string };
  voices: LibraryVoiceInfo[];
}

type SyncPar = [string, number, number, number, number];

interface SyncMap {
  version: number;
  voice: string;
  tracks: { file: string; seconds: number }[];
  sections: { n: number; href: string; pars: SyncPar[] }[];
}

export const libraryVoiceId = (key: string): string => `${LIBRARY_VOICE_PREFIX}${key}`;
export const isLibraryVoiceId = (id: string | null | undefined): boolean =>
  !!id && id.startsWith(LIBRARY_VOICE_PREFIX);
export const libraryVoiceKey = (id: string): string => id.slice(LIBRARY_VOICE_PREFIX.length);

/** How a voice is named in the voice picker. */
export const libraryVoiceName = (voice: LibraryVoiceInfo): string => {
  const people = voice.narrators.length === 1 ? voice.narrators[0]! : voice.label;
  if (voice.kind === 'human')
    return voice.info?.dramatic ? `${voice.label} (LibriVox)` : `${people} (LibriVox)`;
  if (voice.kind === 'dramatized') return `${voice.label} (dramatized)`;
  return voice.label;
};

const sectionIndexForHref = (book: BookDoc, href: string): number =>
  book.sections.findIndex(
    (section) =>
      section.id === href ||
      section.href === href ||
      (section.id && href.endsWith(`/${section.id}`)),
  );

/** One voice of a text edition: its sync map, fetched once and indexed by book section. */
export class LibraryVoice {
  readonly info: LibraryVoiceInfo;
  #sync: SyncMap | null = null;
  #loading: Promise<SyncMap> | null = null;
  #bySection = new Map<number, SyncPar[]>();
  #indexedFor: BookDoc | null = null;

  constructor(info: LibraryVoiceInfo) {
    this.info = info;
  }

  get id(): string {
    return libraryVoiceId(this.info.key);
  }

  async load(): Promise<SyncMap> {
    if (this.#sync) return this.#sync;
    this.#loading ??= fetch(this.info.sync_url)
      .then((res) => {
        if (!res.ok) throw new Error(`voice_sync_${res.status}`);
        return res.json() as Promise<SyncMap>;
      })
      .then((sync) => (this.#sync = sync))
      .catch((error) => {
        this.#loading = null;
        throw error;
      });
    return this.#loading;
  }

  get loaded(): boolean {
    return !!this.#sync;
  }

  #index(book: BookDoc): Map<number, SyncPar[]> {
    if (this.#indexedFor === book || !this.#sync) return this.#bySection;
    this.#bySection = new Map();
    for (const section of this.#sync.sections) {
      const index = sectionIndexForHref(book, section.href);
      if (index >= 0 && section.pars.length) this.#bySection.set(index, section.pars);
    }
    this.#indexedFor = book;
    return this.#bySection;
  }

  /** The URL a par's audio plays from: one streamed track per audioHref. */
  trackUrl(track: number): string | undefined {
    return this.info.tracks[track]?.href;
  }

  trackSeconds(url: string): number {
    return this.info.tracks.find((track) => track.href === url)?.seconds ?? 0;
  }

  findSection(book: BookDoc, from: number, direction: 1 | -1): number {
    const sections = this.#index(book);
    for (let index = from; index >= 0 && index < book.sections.length; index += direction) {
      if (sections.has(index)) return index;
    }
    return -1;
  }

  loadSection(
    book: BookDoc,
    sectionIndex: number,
    doc: Document,
    lang: string,
  ): MediaOverlaySection | null {
    const syncPars = this.#index(book).get(sectionIndex);
    if (!syncPars) return null;
    const pars: NarrationPar[] = [];
    let blockIndex = -1;
    let lastBlock: Element | null = null;
    // Interpolated sentences (exact = 0) are still one sentence each, so every section is
    // highlighted sentence by sentence; 'approximate' is for chapter-level timing only.
    for (const [id, track, begin, end] of syncPars) {
      const el = doc.getElementById(id);
      const audioHref = this.trackUrl(track);
      if (!el || !audioHref) continue;
      const range = textRangeOf(doc, el);
      const text = range?.toString().trim();
      if (!range || !text) continue;
      const block = blockAncestor(el);
      if (block !== lastBlock) {
        blockIndex += 1;
        lastBlock = block;
      }
      pars.push({
        markName: String(pars.length),
        blockIndex,
        range,
        text,
        audioHref,
        clipBegin: begin,
        clipEnd: end,
      });
    }
    return pars.length ? new MediaOverlaySection(pars, lang, 'exact') : null;
  }
}

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/**
 * The voices a book can be read along with, and the one to start with: the reader's own
 * earlier choice for this work, else the library's default (the best exactly aligned human
 * recording when there is one). Only books carrying the text edition's sentence ids qualify:
 * the voices text edition itself, or an AI read-along edition (same ids).
 */
export const prepareLibraryVoices = async (
  voices: LibraryVoices | null,
  bookHash: string,
  hasOverlays: boolean,
): Promise<{ voices: LibraryVoice[]; active: LibraryVoice | null }> => {
  if (!voices?.voices?.length || (voices.text.hash !== bookHash && !hasOverlays)) {
    return { voices: [], active: null };
  }
  const list = voices.voices.map((info) => new LibraryVoice(info));
  const chosen = getChosenLibraryVoice(voices.work_id, voices.lang);
  const eligibleDefault = (voice: LibraryVoice) => !hasOverlays || voice.info.kind !== 'ai';
  const ordered = [
    ...list.filter((voice) => voice.info.key === chosen && eligibleDefault(voice)),
    ...list.filter(
      (voice) => voice.info.default && voice.info.key !== chosen && eligibleDefault(voice),
    ),
  ];
  for (const voice of ordered) {
    const ok = await withTimeout(
      voice.load().then(
        () => true,
        () => false,
      ),
      6000,
      false,
    );
    if (ok) return { voices: list, active: voice };
  }
  return { voices: list, active: null };
};

const VOICE_CHOICE_KEY = 'librebooks-voice-choice';

/** The voice this reader last chose for a work in a language, if any. */
export const getChosenLibraryVoice = (workId: number, lang: string): string | null => {
  try {
    const all = JSON.parse(localStorage.getItem(VOICE_CHOICE_KEY) || '{}') as Record<
      string,
      string
    >;
    return all[`${workId}:${lang}`] ?? null;
  } catch {
    return null;
  }
};

export const setChosenLibraryVoice = (workId: number, lang: string, key: string | null): void => {
  try {
    const all = JSON.parse(localStorage.getItem(VOICE_CHOICE_KEY) || '{}') as Record<
      string,
      string
    >;
    if (key) all[`${workId}:${lang}`] = key;
    else delete all[`${workId}:${lang}`];
    localStorage.setItem(VOICE_CHOICE_KEY, JSON.stringify(all));
  } catch {
    // Private mode / storage full: the default voice is used next time.
  }
};
