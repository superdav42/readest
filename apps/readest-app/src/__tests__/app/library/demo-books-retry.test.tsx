import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDemoBooks } from '@/app/library/hooks/useDemoBooks';
import { useLibraryStore } from '@/store/libraryStore';

const importBook = vi.hoisted(() => vi.fn());
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: { getAppService: async () => ({ importBook }) } }),
}));
vi.mock('@/utils/misc', () => ({ getUserLang: () => 'en' }));
vi.mock('@/services/environment', () => ({ isWebAppPlatform: () => true }));
vi.mock('@/services/demoBooks', () => ({ demoLibraries: { en: { library: ['book.epub'] } } }));
vi.mock('@/services/runtimeConfig', () => ({ getRuntimeConfig: () => ({}) }));
vi.mock('@/services/gutenbergLibrary', () => ({ fetchEditionsByHash: vi.fn() }));
vi.mock('@/store/libraryStore', async () => {
  const { create } = await import('zustand');
  return { useLibraryStore: create(() => ({ library: [], libraryLoaded: false })) };
});

beforeEach(() => {
  localStorage.clear();
  importBook.mockReset().mockResolvedValue({ hash: 'starter', title: 'Starter' });
  useLibraryStore.setState({ library: [], libraryLoaded: true });
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => callback());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('starter-book import recovery', () => {
  it('retries a previously marked import when the loaded library is truly empty', async () => {
    localStorage.setItem('demoBooksFetched', 'true');
    const { result } = renderHook(() => useDemoBooks());
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(importBook).toHaveBeenCalledTimes(1);
  });

  it('does not mark a failed download as complete', async () => {
    importBook.mockRejectedValue(new Error('File is empty'));
    renderHook(() => useDemoBooks());
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(localStorage.getItem('demoBooksFetched')).toBeNull();
  });

  it('waits for disk loading before deciding whether the library is empty', async () => {
    useLibraryStore.setState({ libraryLoaded: false });
    const { result } = renderHook(() => useDemoBooks());
    expect(importBook).not.toHaveBeenCalled();
    act(() => useLibraryStore.setState({ libraryLoaded: true }));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(localStorage.getItem('demoBooksFetched')).toBe('true');
  });

  it('does not resurrect starter books the reader deliberately deleted', async () => {
    localStorage.setItem('demoBooksFetched', 'true');
    useLibraryStore.setState({
      library: [
        {
          hash: 'deleted',
          title: 'Deleted',
          format: 'EPUB',
          author: 'Author',
          createdAt: 1,
          updatedAt: 1,
          deletedAt: 1,
        },
      ],
    });
    renderHook(() => useDemoBooks());
    expect(importBook).not.toHaveBeenCalled();
  });
});
