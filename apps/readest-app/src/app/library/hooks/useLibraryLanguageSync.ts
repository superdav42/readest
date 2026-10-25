// Keep the library in the reader's language: for every work on the shelf that
// has an edition in the current language, add that edition (the bookshelf then
// shows it instead of the other-language copy). Runs once the library has
// loaded and again whenever the reader switches language.
import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import {
  CONTENT_LANGUAGE_EVENT,
  fetchWork,
  getBookLanguage,
  getBookWorkId,
  getCatalogBase,
  getContentLanguage,
} from '@/services/gutenbergLibrary';
import { eventDispatcher } from '@/utils/event';

export const useLibraryLanguageSync = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const libraryLoaded = useLibraryStore((state) => state.libraryLoaded);
  const syncedOnLoad = useRef(false);

  const sync = async (lang: string) => {
    if (!getCatalogBase()) return;
    const { library } = useLibraryStore.getState();
    const live = library.filter((book) => !book.deletedAt);
    const missing = new Set<number>();
    for (const book of live) {
      const workId = getBookWorkId(book);
      if (workId !== null) missing.add(workId);
    }
    for (const book of live) {
      const workId = getBookWorkId(book);
      if (workId !== null && getBookLanguage(book) === lang) missing.delete(workId);
    }
    if (!missing.size) return;
    const appService = await envConfig.getAppService();
    let added = 0;
    for (const workId of missing) {
      try {
        const work = await fetchWork(workId, lang);
        if (!work.best || work.best.lang !== lang) continue;
        const current = useLibraryStore.getState().library;
        if (await appService.importBook(work.best.url, current)) added++;
      } catch (error) {
        console.warn('Library edition fetch failed', workId, error);
      }
    }
    if (added) {
      const current = useLibraryStore.getState().library;
      useLibraryStore.getState().setLibrary([...current]);
      await appService.saveLibraryBooks(current);
      eventDispatcher.dispatch('toast', {
        message: _('Added {{count}} books in your language', { count: added }),
        type: 'info',
      });
    }
  };

  useEffect(() => {
    if (!libraryLoaded || syncedOnLoad.current) return;
    syncedOnLoad.current = true;
    void sync(getContentLanguage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryLoaded]);

  useEffect(() => {
    const onLanguage = (event: CustomEvent) => sync((event.detail as { lang: string }).lang);
    eventDispatcher.on(CONTENT_LANGUAGE_EVENT, onLanguage);
    return () => eventDispatcher.off(CONTENT_LANGUAGE_EVENT, onLanguage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
