import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanUpFinished,
  isFinished,
  isVoiceKept,
  playedShare,
  setVoiceKept,
  shouldCleanUp,
} from '@/services/listen/finished';
import type { Book } from '@/types/book';

const book = { hash: 'abc', title: 'Test' } as Book;
const target = { workId: 1727, lang: 'en', voiceKey: 'librivox-1', book };

describe('finished detection', () => {
  it('measures the share of the recording played', () => {
    expect(playedShare([100, 100], 1, 50)).toBeCloseTo(0.75);
    expect(playedShare([100, 100], 1, 500)).toBe(1);
    expect(playedShare([], 0, 0)).toBe(0);
    expect(playedShare([100], 3, 0)).toBe(0);
  });

  it('is finished at the end of the last section or at 98% of the audio', () => {
    expect(isFinished({ endedAtLastSection: true, share: null })).toBe(true);
    expect(isFinished({ endedAtLastSection: false, share: 0.98 })).toBe(true);
    expect(isFinished({ endedAtLastSection: false, share: 0.97 })).toBe(false);
    expect(isFinished({ endedAtLastSection: false, share: null })).toBe(false);
  });

  it('removes only a finished book with the setting on and Keep off', () => {
    const on = { finished: true, deleteWhenFinished: true, kept: false };
    expect(shouldCleanUp(on)).toBe(true);
    expect(shouldCleanUp({ ...on, finished: false })).toBe(false);
    expect(shouldCleanUp({ ...on, deleteWhenFinished: false })).toBe(false);
    expect(shouldCleanUp({ ...on, kept: true })).toBe(false);
  });
});

describe('cleanUpFinished', () => {
  beforeEach(() => localStorage.clear());

  const deps = () => ({
    deleteWhenFinished: true,
    deleteBook: vi.fn().mockResolvedValue(undefined),
    removeVoice: vi.fn().mockResolvedValue(undefined),
  });

  it('removes the voice and the book file with local, never purge', async () => {
    const d = deps();
    expect(await cleanUpFinished(target, d)).toBe(true);
    expect(d.removeVoice).toHaveBeenCalledWith(1727, 'en', 'librivox-1');
    expect(d.deleteBook).toHaveBeenCalledWith(book, 'local');
    expect(d.deleteBook).not.toHaveBeenCalledWith(book, 'purge');
  });

  it('removes nothing with Keep on or the setting off', async () => {
    setVoiceKept(1727, 'en', true);
    expect(isVoiceKept(1727, 'en')).toBe(true);
    const kept = deps();
    expect(await cleanUpFinished(target, kept)).toBe(false);
    expect(kept.deleteBook).not.toHaveBeenCalled();
    expect(kept.removeVoice).not.toHaveBeenCalled();

    setVoiceKept(1727, 'en', false);
    const off = { ...deps(), deleteWhenFinished: false };
    expect(await cleanUpFinished(target, off)).toBe(false);
    expect(off.deleteBook).not.toHaveBeenCalled();
  });
});
