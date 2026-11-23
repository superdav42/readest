import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    featuredCatalogUrl: 'https://api.example/rest/v1/rpc/opds?path=root',
  }),
}));

import { fetchListenOptions } from '@/services/gutenbergLibrary';
import { getPlayingSample, stopSample, toggleSample } from '@/services/listen/samplePlayer';

describe('fetchListenOptions', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the catalog answer', async () => {
    const answer = {
      work_id: 11,
      lang: 'en',
      title: 'Alice',
      text: { hash: 'abc', url: 'https://cdn.example/abc.epub' },
      recordings: [{ key: 'librivox-1', seconds: 60, status: 'ready', sample_url: null }],
      ai: { available: true, status: 'ready', key: 'ai-kokoro', label: 'AI', sample_url: 's.mp3' },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer)));
    vi.stubGlobal('fetch', fetchMock);
    const options = await fetchListenOptions(11, 'en');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/rest/v1/rpc/work_listen_options?p_work=11&p_lang=en',
      undefined,
    );
    expect(options.recordings).toHaveLength(1);
    expect(options.ai.available).toBe(true);
  });

  it('falls back to an empty listing when the catalog cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const options = await fetchListenOptions(11, 'en');
    expect(options.recordings).toEqual([]);
    expect(options.text).toBeNull();
    expect(options.ai.available).toBe(false);
  });
});

describe('samplePlayer', () => {
  it('uses one audio element and stops the sample playing when another starts', async () => {
    const elements: { src: string; pause: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      'Audio',
      class {
        src = '';
        pause = vi.fn();
        play = vi.fn(async () => undefined);
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          elements.push(this);
        }
      },
    );
    await toggleSample('a.mp3');
    expect(getPlayingSample()).toBe('a.mp3');
    await toggleSample('b.mp3');
    expect(getPlayingSample()).toBe('b.mp3');
    expect(elements).toHaveLength(1);
    expect(elements[0]!.pause).toHaveBeenCalled();
    stopSample();
    expect(getPlayingSample()).toBeNull();
    vi.unstubAllGlobals();
  });
});
