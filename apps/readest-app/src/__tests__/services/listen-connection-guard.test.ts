import { afterEach, describe, expect, it } from 'vitest';
import { connectionKind } from '@/services/listen/connection';
import { readListeningSettings, shouldAskBeforeDownload } from '@/services/listen/downloadGuard';
import { downloadOrder } from '@/services/tts/voiceOffline';

const setConnection = (value: unknown) =>
  Object.defineProperty(navigator, 'connection', { value, configurable: true });

describe('connectionKind', () => {
  afterEach(() => setConnection(undefined));

  it('maps navigator.connection shapes', () => {
    setConnection({ type: 'wifi' });
    expect(connectionKind()).toBe('unmetered');
    setConnection({ type: 'ethernet' });
    expect(connectionKind()).toBe('unmetered');
    setConnection({ type: 'cellular' });
    expect(connectionKind()).toBe('cellular');
    setConnection({ type: 'wifi', saveData: true });
    expect(connectionKind()).toBe('cellular');
    setConnection({ effectiveType: '4g' });
    expect(connectionKind()).toBe('unknown');
    setConnection(undefined);
    expect(connectionKind()).toBe('unknown');
  });
});

describe('downloadOrder', () => {
  it('starts at the track being heard, then wraps', () => {
    expect(downloadOrder([0, 1, 2, 3, 4], 2)).toEqual([2, 3, 4, 0, 1]);
    expect(downloadOrder([0, 1, 2], 0)).toEqual([0, 1, 2]);
    expect(downloadOrder([0, 1, 2], 9)).toEqual([0, 1, 2]);
  });
});

describe('shouldAskBeforeDownload', () => {
  const MB = 1024 * 1024;
  const on = readListeningSettings(undefined);

  it('reads absent settings as the defaults', () => {
    expect(on).toEqual({ guardDownloads: true, guardMegabytes: 100, deleteWhenFinished: true });
  });

  it('asks on cellular and unknown, and above the size', () => {
    expect(shouldAskBeforeDownload(on, 'unmetered', 10 * MB)).toBe(false);
    expect(shouldAskBeforeDownload(on, 'unmetered', 101 * MB)).toBe(true);
    expect(shouldAskBeforeDownload(on, 'cellular', MB)).toBe(true);
    expect(shouldAskBeforeDownload(on, 'unknown', MB)).toBe(true);
  });

  it('never asks when turned off', () => {
    const off = readListeningSettings({ guardDownloads: false });
    expect(shouldAskBeforeDownload(off, 'cellular', 500 * MB)).toBe(false);
  });
});
