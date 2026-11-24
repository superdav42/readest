// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// A finished audiobook cleans up after itself: its saved voice and its text edition are removed
// from the device, while the reading position, bookmarks, notes and highlights stay (the book
// is deleted with 'local', never 'purge', so config.json and the library record are kept).
import type { Book } from '@/types/book';
import type { DeleteAction } from '@/types/system';

/** A book counts as finished when this share of the voice's audio has played. */
export const FINISHED_SHARE = 0.98;

/**
 * Share (0..1) of a recording played: the seconds of the tracks before the one sounding plus the
 * position inside it, over the whole recording.
 */
export const playedShare = (
  trackSeconds: number[],
  trackIndex: number,
  secondsIntoTrack: number,
): number => {
  const total = trackSeconds.reduce((sum, seconds) => sum + seconds, 0);
  if (!total || trackIndex < 0 || trackIndex >= trackSeconds.length) return 0;
  const before = trackSeconds.slice(0, trackIndex).reduce((sum, seconds) => sum + seconds, 0);
  const inside = Math.min(Math.max(secondsIntoTrack, 0), trackSeconds[trackIndex]!);
  return Math.min((before + inside) / total, 1);
};

/** Finished: playback ended after the last narrated section, or enough of the audio played. */
export const isFinished = (state: { endedAtLastSection: boolean; share: number | null }) =>
  state.endedAtLastSection || (state.share ?? 0) >= FINISHED_SHARE;

/** Saved reader progress counts as finished at the same threshold as played audio. */
export const isSavedProgressFinished = (progress: [number, number] | undefined): boolean => {
  if (!progress || progress[1] <= 0) return false;
  return progress[0] / progress[1] >= FINISHED_SHARE;
};

/** Only a finished book, with the setting on and no Keep, is removed. */
export const shouldCleanUp = (state: {
  finished: boolean;
  deleteWhenFinished: boolean;
  kept: boolean;
}): boolean => state.finished && state.deleteWhenFinished && !state.kept;

// ---- Keep: per work and language, in the same storage area as the voice choice ------------

const KEEP_KEY = 'gutenberg-ai-voice-keep';

const readKept = (): Record<string, true> => {
  try {
    return JSON.parse(localStorage.getItem(KEEP_KEY) || '{}') as Record<string, true>;
  } catch {
    return {};
  }
};

export const isVoiceKept = (workId: number, lang: string): boolean =>
  !!readKept()[`${workId}:${lang}`];

export const setVoiceKept = (workId: number, lang: string, kept: boolean): void => {
  try {
    const all = readKept();
    if (kept) all[`${workId}:${lang}`] = true;
    else delete all[`${workId}:${lang}`];
    localStorage.setItem(KEEP_KEY, JSON.stringify(all));
  } catch {
    // Private mode / storage full: the book is not kept.
  }
};

export interface FinishedTarget {
  workId: number;
  lang: string;
  voiceKey: string;
  book: Book;
}

export interface CleanupDeps {
  deleteWhenFinished: boolean;
  deleteBook: (book: Book, action: DeleteAction) => Promise<void>;
  removeVoice: (workId: number, lang: string, key: string) => Promise<void>;
  isKept?: (workId: number, lang: string) => boolean;
}

/**
 * Remove the saved voice and the text edition of a finished book (never 'purge'). Returns true
 * when something was removed; the caller then saves the library.
 */
export const cleanUpFinished = async (
  target: FinishedTarget,
  deps: CleanupDeps,
): Promise<boolean> => {
  const kept = (deps.isKept ?? isVoiceKept)(target.workId, target.lang);
  if (!shouldCleanUp({ finished: true, deleteWhenFinished: deps.deleteWhenFinished, kept })) {
    return false;
  }
  await deps.removeVoice(target.workId, target.lang, target.voiceKey);
  await deps.deleteBook(target.book, 'local');
  return true;
};
