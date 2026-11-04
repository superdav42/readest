// Modified 2026-11-03 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import { useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { Book } from '@/types/book';
import { getUserLang } from '@/utils/misc';
import { isWebAppPlatform } from '@/services/environment';
import { demoLibraries as libraries } from '@/services/demoBooks';
import { getRuntimeConfig } from '@/services/runtimeConfig';
import { fetchEditionsByHash, type CatalogEdition } from '@/services/gutenbergLibrary';
import { useLibraryStore } from '@/store/libraryStore';

interface DemoBooks {
  library: string[];
}

/** Content-addressed catalog file URL: `<libraryFilesUrl>/<hash>.epub`. */
const catalogFileHash = (url: string): string | null => {
  const filesUrl = getRuntimeConfig()?.libraryFilesUrl;
  if (!filesUrl || !url.startsWith(`${filesUrl}/`)) return null;
  return url.match(/\/([0-9a-f]{32})\.epub$/)?.[1] ?? null;
};

/**
 * Shelf entries for starter books that live in the catalog, built from the catalog's own
 * metadata (title, author, language, cover) with no request for the EPUB. Opening one
 * downloads it by hash, as for any shared-library book that is not on the device yet.
 */
const seedCatalogBooks = async (urls: string[]): Promise<{ books: Book[]; urls: Set<string> }> => {
  const hashes = new Map<string, string>();
  for (const url of urls) {
    const hash = catalogFileHash(url);
    if (hash) hashes.set(hash, url);
  }
  const seeded = { books: [] as Book[], urls: new Set<string>() };
  if (!hashes.size) return seeded;
  let editions: CatalogEdition[] = [];
  try {
    editions = await fetchEditionsByHash([...hashes.keys()]);
  } catch (error) {
    console.warn('Starter books: catalog lookup failed, importing from URL', error);
    return seeded;
  }
  const existing = new Set(useLibraryStore.getState().library.map((book) => book.hash));
  const now = Date.now();
  const coversUrl = getRuntimeConfig()?.libraryCoversUrl;
  for (const edition of editions) {
    const url = hashes.get(edition.hash);
    if (!url || edition.kind === 'audiobook') continue;
    const author = edition.authors[0] ?? '';
    seeded.urls.add(url);
    if (existing.has(edition.hash)) continue;
    seeded.books.push({
      hash: edition.hash,
      format: 'EPUB',
      title: edition.title,
      sourceTitle: edition.title,
      author,
      primaryLanguage: edition.lang,
      hasNarration: edition.kind === 'readalong' || undefined,
      metadata: {
        title: edition.title,
        author,
        language: edition.lang,
        identifier: `urn:gutenberg-ai:${edition.work_id}${edition.kind === 'translation' ? `:${edition.lang}` : ''}`,
        ...(coversUrl ? { coverImageUrl: `${coversUrl}/${edition.hash}.jpg` } : {}),
      },
      createdAt: now,
      updatedAt: now,
      // In the shared catalog but not on this device: no `downloadedAt`, so opening fetches it.
      uploadedAt: now,
      deletedAt: null,
    });
  }
  return seeded;
};

export const useDemoBooks = () => {
  const { envConfig } = useEnv();
  const [books, setBooks] = useState<Book[]>([]);
  const isLoading = useRef(false);

  useEffect(() => {
    if (isLoading.current) return;
    isLoading.current = true;

    const userLang = getUserLang() as keyof typeof libraries;
    const fetchDemoBooks = async () => {
      try {
        const appService = await envConfig.getAppService();
        // A self-hosted deployment can seed its own starter books (DEMO_BOOK_URLS).
        const custom = getRuntimeConfig()?.demoBookUrls;
        const demoBooks: DemoBooks = custom?.length
          ? { library: custom }
          : libraries[userLang] || (libraries.en as DemoBooks);
        // Catalog files become shelf entries from catalog metadata, without opening the EPUB;
        // the file is fetched when the book is opened. Anything else is imported from its URL.
        const seeded = await seedCatalogBooks(demoBooks.library);
        const rest = demoBooks.library.filter((url) => !seeded.urls.has(url));
        const imported = await Promise.all(
          rest.map((url) => appService.importBook(url, [], { saveBook: false })),
        );
        setBooks([...seeded.books, ...imported.filter((book) => book !== null)] as Book[]);
      } catch (error) {
        console.error('Failed to import demo books:', error);
      }
    };

    const demoBooksFetchedFlag = localStorage.getItem('demoBooksFetched');
    if (isWebAppPlatform() && !demoBooksFetchedFlag) {
      // Starter books are fetched over the network: start after the page has loaded and the
      // browser is idle, so they don't compete with the first screen.
      const start = () => {
        const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
          .requestIdleCallback;
        if (idle) idle(() => void fetchDemoBooks());
        else setTimeout(() => void fetchDemoBooks(), 2000);
      };
      if (document.readyState === 'complete') start();
      else window.addEventListener('load', start, { once: true });
      localStorage.setItem('demoBooksFetched', 'true');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return books;
};
