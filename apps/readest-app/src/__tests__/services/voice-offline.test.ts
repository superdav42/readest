import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryVoiceInfo, LibraryVoices } from '@/services/tts/libraryVoice';
import {
  listSavedVoices,
  removeAllVoicesOffline,
  removeVoiceOffline,
  savedText,
  savedTrackSource,
  savedVoicesListing,
  saveVoiceOffline,
  voiceOfflineStatus,
} from '@/services/tts/voiceOffline';

// Cache Storage and fetch, in memory.
const entries = new Map<string, string>();
const fakeCaches = {
  open: async () => ({
    match: async (url: string) => (entries.has(url) ? new Response(entries.get(url)) : undefined),
    put: async (url: string, res: Response) => void entries.set(url, await res.text()),
    delete: async (url: string) => entries.delete(url),
  }),
};

const CDN = 'https://cdn.example/voices/1727/en';
const info = (build: string, ready: boolean[]): LibraryVoiceInfo => ({
  key: 'librivox-20840',
  kind: 'human',
  label: 'Peter Dann',
  narrators: ['Peter Dann'],
  timing: 'exact',
  default: true,
  sync_url: `${CDN}/librivox-20840-${build}/sync.json`,
  tracks: ready.map((isReady, i) => ({
    href: `${CDN}/librivox-20840-${build}/tracks/0${i}.mp3`,
    seconds: 100,
    ready: isReady,
  })),
});
const listing = (voice: LibraryVoiceInfo): LibraryVoices => ({
  work_id: 1727,
  lang: 'en',
  text: { hash: 'abc', url: `${CDN}/text.epub` },
  voices: [voice],
});

describe('voice offline', () => {
  beforeEach(() => {
    entries.clear();
    localStorage.clear();
    // jsdom's Blob has no stream(), which Node's Response needs.
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('caches', fakeCaches);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(`audio of ${url}`, { status: 200 })),
    );
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:saved' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves the sync map and every track, and reads them back', async () => {
    const voice = info('a', [true, true]);
    const status = await saveVoiceOffline(listing(voice), voice);
    expect(status).toMatchObject({ state: 'saved', saved: 2, total: 2 });
    expect(await savedText(voice.sync_url)).toBe(`audio of ${voice.sync_url}`);
    expect(await savedTrackSource(voice.tracks[1]!.href)).toBe('blob:saved');
    expect(await savedTrackSource(`${CDN}/other/tracks/00.mp3`)).toBeNull();
  });

  it('is partial while the catalog has built only some tracks, and completes later', async () => {
    const early = info('a', [true, false]);
    expect(await saveVoiceOffline(listing(early), early)).toMatchObject({
      state: 'partial',
      saved: 1,
      built: 1,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    const later = info('a', [true, true]);
    expect(await saveVoiceOffline(listing(later), later)).toMatchObject({
      state: 'saved',
      saved: 2,
    });
    // Only the new track was downloaded; the sync map and the first track were kept.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([later.tracks[1]!.href]);
  });

  it('replaces the files of an older build', async () => {
    const old = info('a', [true]);
    await saveVoiceOffline(listing(old), old);
    const fresh = info('b', [true]);
    await saveVoiceOffline(listing(fresh), fresh);
    expect(entries.has(old.tracks[0]!.href)).toBe(false);
    expect(entries.has(fresh.tracks[0]!.href)).toBe(true);
  });

  it('shows storage that was evicted as not saved', async () => {
    const voice = info('a', [true]);
    await saveVoiceOffline(listing(voice), voice);
    entries.delete(voice.tracks[0]!.href);
    expect(await voiceOfflineStatus(1727, 'en', voice)).toMatchObject({ state: 'none' });
    expect(await savedVoicesListing(1727, 'en')).toBeNull();
  });

  it('lists the saved voices with no connection, and nothing once removed', async () => {
    const voice = info('a', [true]);
    await saveVoiceOffline(
      { ...listing(voice), voices: [{ ...voice, default: false }] },
      {
        ...voice,
        default: false,
      },
    );
    const offline = await savedVoicesListing(1727, 'en');
    expect(offline?.text.hash).toBe('abc');
    expect(offline?.voices.map((v) => [v.key, v.default])).toEqual([['librivox-20840', true]]);
    await removeVoiceOffline(1727, 'en', 'librivox-20840');
    expect(await savedVoicesListing(1727, 'en')).toBeNull();
    expect(entries.size).toBe(0);
  });

  it('lists every saved voice with its size, and removes them all', async () => {
    expect(listSavedVoices()).toEqual([]);
    const voice = info('a', [true]);
    await saveVoiceOffline(listing(voice), voice);
    const saved = listSavedVoices();
    expect(saved.map((s) => [s.workId, s.lang, s.key])).toEqual([[1727, 'en', 'librivox-20840']]);
    expect(saved[0]!.bytes).toBeGreaterThan(0);
    await removeAllVoicesOffline();
    expect(listSavedVoices()).toEqual([]);
    expect(entries.size).toBe(0);
  });
});
