// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-24 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// A book page can list the recordings of several ebooks of one book (a work group). Each recording
// is built against one of them, so Play must use that ebook's id and text, not the page's.
import type { ListenOptions } from '@/services/gutenbergLibrary';

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
