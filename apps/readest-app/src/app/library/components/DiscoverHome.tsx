// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-31 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Discover: the first screen of a shared-library deployment (Librebooks). Rows of
// covers in the reader's language — continue reading, books related to the last one
// read, popular, read-along and genre rows — and one tap opens a book in the reader.
'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PiHeadphones } from 'react-icons/pi';
import { MdChevronRight } from 'react-icons/md';
import type { Book } from '@/types/book';
import BookCover from '@/components/BookCover';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { downloadFile } from '@/libs/storage';
import { isTauriAppPlatform } from '@/services/environment';
import {
  CONTENT_LANGUAGE_EVENT,
  type DiscoverCard,
  type DiscoverHome as DiscoverHomeData,
  fetchDiscoverHome,
  fetchRelatedBooks,
  findLibraryEdition,
  getBookWorkId,
  getCachedDiscoverHome,
  getContentLanguage,
  getLibraryFeedPath,
} from '@/services/gutenbergLibrary';

interface DiscoverHomeProps {
  libraryBooks: Book[];
}

/** Download a catalog EPUB with progress, as a File the importer accepts. */
const downloadEpub = async (url: string, onProgress: (fraction: number) => void): Promise<File> => {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download_${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(received / total);
  }
  const name = url.split('/').pop() || 'book.epub';
  return new File(chunks as BlobPart[], name, { type: 'application/epub+zip' });
};

/** Web only: books larger than this open while they download; smaller ones download first. */
const STREAM_MIN_BYTES = 3 * 1024 * 1024;

const isInProgress = (book: Book) =>
  !book.deletedAt && !!book.progress && book.progress[0] < book.progress[1];

const Row: React.FC<{
  title: string;
  seeAll?: string | null;
  children: React.ReactNode;
}> = ({ title, seeAll, children }) => {
  const _ = useTranslation();
  const router = useAppRouter();
  return (
    <section className='flex flex-col gap-2' aria-label={title}>
      <div className='flex items-center justify-between px-4 sm:px-6'>
        <h2 className='text-base-content text-lg font-semibold'>{title}</h2>
        {seeAll && (
          <button
            type='button'
            className='text-base-content/60 hover:text-base-content flex items-center text-sm'
            onClick={() => router.push(seeAll)}
          >
            {_('See all')}
            <MdChevronRight className='h-5 w-5' />
          </button>
        )}
      </div>
      <div className='no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1 sm:px-6'>{children}</div>
    </section>
  );
};

const Card: React.FC<{
  card: DiscoverCard;
  contentLang: string;
  progress?: number | null;
  onOpen: (card: DiscoverCard) => void;
}> = ({ card, contentLang, progress, onOpen }) => {
  const _ = useTranslation();
  return (
    <button
      type='button'
      className='group flex w-[7.25rem] shrink-0 flex-col gap-1.5 text-left sm:w-32'
      onClick={() => onOpen(card)}
      aria-label={card.author ? `${card.title}, ${card.author}` : card.title}
    >
      <div className='bg-base-300 relative aspect-[2/3] w-full overflow-hidden rounded-md shadow-md'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card.cover}
          alt=''
          loading='lazy'
          decoding='async'
          className='h-full w-full object-cover transition-transform group-hover:scale-[1.03]'
        />
        <div className='absolute bottom-1 left-1 flex gap-1'>
          {card.kind === 'readalong' && (
            <span
              className='bg-base-100/90 text-base-content flex h-5 w-5 items-center justify-center rounded-full'
              title={_('Read-along')}
            >
              <PiHeadphones className='h-3.5 w-3.5' />
            </span>
          )}
          {card.lang !== contentLang && (
            <span className='bg-base-100/90 text-base-content rounded px-1 text-[10px] font-semibold uppercase leading-5'>
              {card.lang}
            </span>
          )}
        </div>
        {progress != null && (
          <div className='bg-base-100/60 absolute bottom-0 left-0 right-0 h-1'>
            <div className='bg-primary h-1' style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <p className='text-base-content line-clamp-2 text-sm font-medium leading-tight'>
        {card.title}
      </p>
      {card.author && <p className='text-base-content/60 truncate text-xs'>{card.author}</p>}
    </button>
  );
};

const DiscoverHome: React.FC<DiscoverHomeProps> = ({ libraryBooks }) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { appService } = useEnv();
  const [lang, setLang] = useState(getContentLanguage);
  const [home, setHome] = useState<DiscoverHomeData | null>(() => getCachedDiscoverHome(lang));
  const [failed, setFailed] = useState(false);
  const [related, setRelated] = useState<DiscoverCard[]>([]);
  const [opening, setOpening] = useState<{ card: DiscoverCard; progress: number } | null>(null);

  useEffect(() => {
    const onLanguage = (event: CustomEvent) => setLang((event.detail as { lang: string }).lang);
    eventDispatcher.on(CONTENT_LANGUAGE_EVENT, onLanguage);
    return () => eventDispatcher.off(CONTENT_LANGUAGE_EVENT, onLanguage);
  }, []);

  // Cached rows show at once; the fresh copy replaces them when it arrives.
  useEffect(() => {
    let cancelled = false;
    setHome(getCachedDiscoverHome(lang));
    setFailed(false);
    fetchDiscoverHome(lang)
      .then((fresh) => !cancelled && setHome(fresh))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const continueReading = useMemo(
    () =>
      libraryBooks
        .filter(isInProgress)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 15),
    [libraryBooks],
  );

  const lastRead = useMemo(
    () =>
      libraryBooks
        .filter((book) => !book.deletedAt && book.progress && getBookWorkId(book) !== null)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0],
    [libraryBooks],
  );
  const lastReadWorkId = lastRead ? getBookWorkId(lastRead) : null;

  useEffect(() => {
    if (lastReadWorkId === null) {
      setRelated([]);
      return;
    }
    let cancelled = false;
    fetchRelatedBooks(lastReadWorkId, lang)
      .then((cards) => !cancelled && setRelated(cards.filter(Boolean)))
      .catch(() => !cancelled && setRelated([]));
    return () => {
      cancelled = true;
    };
  }, [lastReadWorkId, lang]);

  const openCard = useCallback(
    async (card: DiscoverCard) => {
      if (!appService || opening) return;
      const existing = findLibraryEdition(useLibraryStore.getState().library, card);
      if (existing) {
        navigateToReader(router, [existing.hash]);
        return;
      }
      setOpening({ card, progress: 0 });
      try {
        const { library, setLibrary } = useLibraryStore.getState();
        const onProgress = (progress: number) =>
          setOpening((current) => (current ? { ...current, progress } : current));
        let book: Book | null = null;
        let streaming = false;
        if (isTauriAppPlatform()) {
          // Apps: the native downloader saves the file at full speed and the native
          // EPUB parser opens it from disk. Streaming would send every small range
          // read through the HTTP bridge (11 s for a 290 KB book on Android).
          const path = await appService.resolveFilePath(
            `discover-${card.work_id}-${card.lang}.epub`,
            'Cache',
          );
          await downloadFile({
            appService,
            dst: path,
            cfp: '',
            url: card.url,
            onProgress: ({ progress, total }) => total > 0 && onProgress(progress / total),
          });
          book = await appService.importBook(path, library);
          await appService.deleteFile(path, 'None').catch(() => undefined);
        } else if ((card.size ?? 0) > STREAM_MIN_BYTES) {
          // Web, large books: read while it downloads. Importing from the URL without
          // copying the file lets the reader fetch only the parts it shows (range
          // requests); the whole book then downloads in the background.
          book = await appService
            .importBook(card.url, library, { saveBook: false })
            .catch(() => null);
          streaming = !!book;
        }
        if (!book) {
          // Small books on the web (most of them are under 1 MB), or a host without
          // range support: download, then open.
          const file = await downloadEpub(card.url, onProgress);
          book = await appService.importBook(file, library);
          streaming = false;
        }
        if (!book) throw new Error('import_failed');
        setLibrary([...library]);
        await appService.saveLibraryBooks(library);
        navigateToReader(router, [book.hash]);
        if (streaming) {
          const downloaded = book;
          appService
            .downloadBook(downloaded)
            .then(async () => {
              const current = useLibraryStore.getState().library;
              useLibraryStore.getState().setLibrary([...current]);
              await appService.saveLibraryBooks(current);
            })
            .catch((error) => console.warn('Discover: background download failed', error));
        }
      } catch (error) {
        console.warn('Discover: could not open', card.url, error);
        eventDispatcher.dispatch('toast', {
          message: _('Could not open this book. Check your connection and try again.'),
          type: 'error',
        });
      } finally {
        setOpening(null);
      }
    },
    [appService, opening, router, _],
  );

  const sectionTitle = (kind: string, title?: string) =>
    kind === 'popular' ? _('Popular') : kind === 'readalong' ? _('Read-along') : (title ?? '');

  return (
    <div className='flex min-h-0 grow flex-col overflow-y-auto pb-8'>
      <div className='flex flex-col gap-6 pt-2'>
        {continueReading.length > 0 && (
          <Row title={_('Continue reading')}>
            {continueReading.map((book) => (
              <button
                key={book.hash}
                type='button'
                className='flex w-[7.25rem] shrink-0 flex-col gap-1.5 text-left sm:w-32'
                onClick={() => navigateToReader(router, [book.hash])}
                aria-label={book.title}
              >
                <div className='relative aspect-[2/3] w-full overflow-hidden rounded-md shadow-md'>
                  <BookCover book={book} />
                  {book.progress && (
                    <div className='bg-base-100/60 absolute bottom-0 left-0 right-0 h-1'>
                      <div
                        className='bg-primary h-1'
                        style={{
                          width: `${Math.round((book.progress[0] / book.progress[1]) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <p className='text-base-content line-clamp-2 text-sm font-medium leading-tight'>
                  {book.title}
                </p>
              </button>
            ))}
          </Row>
        )}

        {lastRead && related.length > 0 && (
          <Row title={_('Because you read {{title}}', { title: lastRead.title })}>
            {related.map((card) => (
              <Card key={card.work_id} card={card} contentLang={lang} onOpen={openCard} />
            ))}
          </Row>
        )}

        {home?.sections.map((section) =>
          section.items.length ? (
            <Row
              key={section.id}
              title={sectionTitle(section.kind, section.title)}
              seeAll={getLibraryFeedPath(
                section.kind === 'shelf' ? 'shelf' : section.kind,
                section.shelf,
                lang,
              )}
            >
              {section.items.filter(Boolean).map((card) => (
                <Card key={card.work_id} card={card} contentLang={lang} onOpen={openCard} />
              ))}
            </Row>
          ) : null,
        )}

        {!home && !failed && (
          <div className='flex flex-col gap-6' aria-hidden='true'>
            {[0, 1, 2].map((row) => (
              <div key={row} className='flex flex-col gap-2 px-4 sm:px-6'>
                <div className='bg-base-300 h-5 w-40 animate-pulse rounded' />
                <div className='flex gap-3 overflow-hidden'>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className='bg-base-300 aspect-[2/3] w-[7.25rem] shrink-0 animate-pulse rounded-md'
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!home && failed && (
          <div className='text-base-content/70 flex flex-col items-center gap-3 px-6 py-16 text-center'>
            <p>{_('Could not load books. Check your connection and try again.')}</p>
            <button
              type='button'
              className='btn btn-sm'
              onClick={() => {
                setFailed(false);
                fetchDiscoverHome(lang)
                  .then(setHome)
                  .catch(() => setFailed(true));
              }}
            >
              {_('Try again')}
            </button>
          </div>
        )}
      </div>

      {opening && (
        <div
          className='bg-base-200/95 fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 px-8'
          role='status'
          aria-live='polite'
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={opening.card.cover}
            alt=''
            className='aspect-[2/3] w-40 rounded-md object-cover shadow-xl'
          />
          <p className='text-base-content text-center text-lg font-semibold'>
            {opening.card.title}
          </p>
          <div className='bg-base-300 h-1.5 w-48 overflow-hidden rounded-full'>
            <div
              className={clsx(
                'bg-primary h-1.5 transition-[width]',
                !opening.progress && 'animate-pulse',
              )}
              style={{ width: `${Math.max(8, Math.round(opening.progress * 100))}%` }}
            />
          </div>
          <p className='text-base-content/60 text-sm'>{_('Opening book…')}</p>
        </div>
      )}
    </div>
  );
};

export default DiscoverHome;
