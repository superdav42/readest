import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    featuredCatalogUrl: 'https://api.example/rest/v1/rpc/opds?path=root',
  }),
}));

import { requestLanguageTitles, type LibraryWork } from '@/services/gutenbergLibrary';
import { resolveReadNow } from '@/services/listen/playTarget';

describe('requestLanguageTitles', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the catalog to fill the chosen language first', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await requestLanguageTitles('fr');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/rest/v1/rpc/request_titles');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ p_lang: 'fr' });
  });

  it('never throws: the language still switches when the catalog is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    await expect(requestLanguageTitles('de')).resolves.toBeUndefined();
  });

  it('does not ask the catalog while offline', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await requestLanguageTitles('es');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resolveReadNow', () => {
  const best = { kind: 'original', lang: 'fr', url: 'u', hash: 'h', updated: 1 } as const;
  const work = (extra: Partial<LibraryWork>) =>
    ({ work_id: 28885, lang: 'fr', title: 'Aventures', best, ...extra }) as LibraryWork;

  it('opens the text of the language: the member that holds it', () => {
    expect(resolveReadNow(work({ text_work_id: 55456 }), 11, 'fr', '')).toEqual({
      work_id: 55456,
      lang: 'fr',
      url: 'u',
      hash: 'h',
      kind: 'original',
    });
  });

  it("falls back to the group's primary, then to the page's work", () => {
    expect(resolveReadNow(work({}), 11, 'fr', '')?.work_id).toBe(28885);
    expect(resolveReadNow(null, 11, 'fr', 'text-url')).toEqual({
      work_id: 11,
      lang: 'fr',
      url: 'text-url',
    });
  });
});
