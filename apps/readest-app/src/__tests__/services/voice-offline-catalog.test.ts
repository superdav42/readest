import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryVoiceInfo } from '@/services/tts/libraryVoice';

vi.mock('@/services/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    featuredCatalogUrl: 'https://api.example/rest/v1/rpc/opds?path=root',
  }),
}));

import { fetchWorkVoices, requestVoice } from '@/services/gutenbergLibrary';
import { saveVoiceOffline } from '@/services/tts/voiceOffline';

const entries = new Map<string, string>();
const fakeCaches = {
  open: async () => ({
    match: async (url: string) => (entries.has(url) ? new Response(entries.get(url)) : undefined),
    put: async (url: string, res: Response) => void entries.set(url, await res.text()),
    delete: async (url: string) => entries.delete(url),
  }),
};

const voice: LibraryVoiceInfo = {
  key: 'librivox-13477',
  kind: 'human',
  label: 'StudioMike',
  narrators: ['StudioMike'],
  timing: 'exact',
  default: true,
  sync_url: 'https://cdn.example/voices/11/en/librivox-13477-a/sync.json',
  tracks: [
    { href: 'https://cdn.example/voices/11/en/librivox-13477-a/tracks/00.mp3', seconds: 60 },
  ],
};

describe('catalog with no connection', () => {
  beforeEach(async () => {
    entries.clear();
    localStorage.clear();
    // jsdom's Blob has no stream(), which Node's Response needs.
    vi.stubGlobal('Blob', NodeBlob);
    vi.stubGlobal('caches', fakeCaches);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => new Response(`audio of ${url}`, { status: 200 })),
    );
    await saveVoiceOffline(
      {
        work_id: 11,
        lang: 'en',
        text: { hash: 'abc', url: 'https://cdn.example/abc.epub' },
        voices: [voice],
      },
      voice,
    );
    // From here on the catalog and the CDN cannot be reached.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the voices saved on this device', async () => {
    const listing = await fetchWorkVoices(11, 'en', true);
    expect(listing?.text.hash).toBe('abc');
    expect(listing?.voices.map((v) => v.key)).toEqual(['librivox-13477']);
  });

  it('answers a request for a voice that is saved as ready, and one that is not by failing', async () => {
    await expect(requestVoice(11, 'en')).resolves.toEqual({ status: 'ready' });
    await expect(requestVoice(12, 'en')).rejects.toThrow();
  });
});
