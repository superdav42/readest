// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-24 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// A book page can list the recordings of several ebooks of one book (a work group). Each recording
// is built against one of them, so Play must use that ebook's id and text, not the page's.
import type { LibraryWork, ListenOptions } from '@/services/gutenbergLibrary';

export interface PlayTarget {
  /** The ebook the voice belongs to. */
  workId: number;
  /** The voices text edition of that ebook; null when the voice is not built. */
  text: ListenOptions['text'];
  /** The ebook's own edition, opened when the voice is not built yet. */
  openText: ListenOptions['text'];
}

export const resolvePlayTarget = (options: ListenOptions, key: string): PlayTarget => {
  const page = { workId: options.work_id, text: options.text, openText: null };
  if (key === options.ai.key) {
    const { work_id: workId, text } = options.ai;
    return workId === undefined ? page : { workId, text: text ?? options.text, openText: null };
  }
  const recording = options.recordings.find((r) => r.key === key);
  if (!recording || recording.work_id === undefined) return page;
  const built = recording.status === 'ready';
  return {
    workId: recording.work_id,
    text: built ? (recording.text ?? null) : null,
    openText: built ? null : (recording.text ?? null),
  };
};

/** The edition "Read now" opens, in the shape `openEdition` takes. */
export interface ReadNowEdition {
  work_id: number;
  lang: string;
  url: string;
  hash?: string;
  kind?: 'original' | 'translation' | 'readalong';
}

/**
 * Read now opens the text the book has in the page's language: the ebook that holds it (a human
 * translation of a work group, `text_work_id`), else the group's primary, else the work the page was
 * opened for. Offline the catalog edition is unknown and the copy on the device (`textUrl`) is reused.
 */
export const resolveReadNow = (
  work: LibraryWork | null,
  pageWorkId: number,
  lang: string,
  textUrl: string,
): ReadNowEdition => {
  const best = work?.best;
  if (!best) return { work_id: pageWorkId, lang, url: textUrl };
  return {
    work_id: work.text_work_id ?? work.work_id ?? pageWorkId,
    lang: best.lang,
    url: best.url,
    hash: best.hash,
    kind: best.kind,
  };
};
