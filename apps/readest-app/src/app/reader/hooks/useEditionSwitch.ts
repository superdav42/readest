// Switching language while reading a library book opens the same work in the
// new language at the same chapter, or requests that edition when it does not
// exist yet. Chapter order is stable across editions (translations keep the
// spine), so the section index carries the position across.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import {
  CONTENT_LANGUAGE_EVENT,
  fetchWork,
  parseWorkId,
  requestEdition,
  toContentLanguage,
} from '@/services/gutenbergLibrary';
import { isWebAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';

const PENDING_KEY = 'gai:pendingSection';

type BookMetadata = { identifier?: string; language?: string | string[] };

export const useEditionSwitch = (bookKey: string) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig } = useEnv();
  const { getView, getProgress } = useReaderStore();

  // Land on the chapter the reader was at before switching editions.
  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw) as { hash: string; index: number };
    if (pending.hash !== bookKey.split('-')[0]) return;
    let tries = 0;
    const timer = setInterval(() => {
      const view = getView(bookKey);
      if (view?.book || ++tries > 40) {
        clearInterval(timer);
        sessionStorage.removeItem(PENDING_KEY);
        if (view) void view.goTo(pending.index);
      }
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    const onLanguage = async (event: CustomEvent) => {
      const lang = (event.detail as { lang: string }).lang;
      const view = getView(bookKey);
      const metadata = view?.book?.metadata as BookMetadata | undefined;
      const workId = parseWorkId(metadata?.identifier);
      if (!view || workId === null) return;
      const bookLang = toContentLanguage(
        Array.isArray(metadata?.language) ? metadata?.language[0] : metadata?.language,
      );
      try {
        const work = await fetchWork(workId, lang);
        if (!work.best) {
          await requestEdition(workId, lang, 'translation');
          eventDispatcher.dispatch('toast', {
            message: _('This book is not available in your language yet. It has been requested.'),
            type: 'info',
            timeout: 6000,
          });
          return;
        }
        if (work.best.lang === bookLang) return;
        eventDispatcher.dispatch('toast', {
          message: _('Opening {{title}}…', { title: work.title }),
          type: 'info',
        });
        const appService = await envConfig.getAppService();
        const { library, setLibrary } = useLibraryStore.getState();
        const book = await appService.importBook(work.best.url, library);
        if (!book) return;
        setLibrary([...library]);
        await appService.saveLibraryBooks(library);
        const index = getProgress(bookKey)?.index ?? 0;
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ hash: book.hash, index }));
        // The reader initialises its book from the URL once; a full navigation
        // swaps the open book on web, the router does on native.
        if (isWebAppPlatform()) window.location.assign(`/reader/${book.hash}`);
        else navigateToReader(router, [book.hash]);
      } catch (error) {
        console.error('Edition switch failed', error);
      }
    };
    eventDispatcher.on(CONTENT_LANGUAGE_EVENT, onLanguage);
    return () => eventDispatcher.off(CONTENT_LANGUAGE_EVENT, onLanguage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);
};
