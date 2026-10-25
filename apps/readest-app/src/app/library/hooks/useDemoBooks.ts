// Modified 2026-10-25 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import { useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { Book } from '@/types/book';
import { getUserLang } from '@/utils/misc';
import { isWebAppPlatform } from '@/services/environment';
import { demoLibraries as libraries } from '@/services/demoBooks';
import { getRuntimeConfig } from '@/services/runtimeConfig';

interface DemoBooks {
  library: string[];
}

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
        const books = await Promise.all(
          demoBooks.library.map((url) => appService.importBook(url, [], { saveBook: false })),
        );
        setBooks(books.filter((book) => book !== null) as Book[]);
      } catch (error) {
        console.error('Failed to import demo books:', error);
      }
    };

    const demoBooksFetchedFlag = localStorage.getItem('demoBooksFetched');
    if (isWebAppPlatform() && !demoBooksFetchedFlag) {
      fetchDemoBooks();
      localStorage.setItem('demoBooksFetched', 'true');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return books;
};
