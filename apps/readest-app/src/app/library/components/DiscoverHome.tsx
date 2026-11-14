// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-31, modified 2026-11-03 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Discover: the first screen of a shared-library deployment (Librebooks). Rows of covers in
// the reader's language — continue reading, translations they asked for, books related to the
// last one read, popular, read-along and genre rows — and one tap opens a book in the reader.
// A book not yet in the reader's language offers to translate its first part now (our own fast
// translation process: the preview opens in a few minutes) or to read the original, and either
// way asks for the complete high-quality translation, whose progress the "Requested" row (and
// the reader) shows.
'use client';

import clsx from 'clsx';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PiHeadphones } from 'react-icons/pi';
import { MdCheckCircle, MdChevronRight, MdClose, MdTranslate } from 'react-icons/md';
import type { Book } from '@/types/book';
import BookCover from '@/components/BookCover';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { openCatalogBook } from '@/services/openCatalogBook';
import { formatEta } from '@/app/reader/components/TranslationPreviewBanner';
import { NARRATION_WANTED_KEY } from '@/app/reader/components/NarrationBanner';
import {
  CONTENT_LANGUAGE_EVENT,
  REQUESTS_EVENT,
  type DiscoverCard,
  type DiscoverHome as DiscoverHomeData,
  type LibraryWork,
  type RequestedBook,
  fetchDiscoverHome,
  fetchRelatedBooks,
  fetchWork,
  forgetRequestedBook,
  getBookWorkId,
  getCachedDiscoverHome,
  getContentLanguage,
  getLibraryFeedPath,
  getRequestedBooks,
  getTranslationWait,
  requestTranslation,
  setPreviewBook,
} from '@/services/gutenbergLibrary';

interface DiscoverHomeProps {
  libraryBooks: Book[];
}

const POLL_MS = 30_000;
/** Give up on opening a book when its download or import has not advanced for this long. */
const OPEN_STALL_MS = 3 * 60_000;
/** How often to ask whether a requested translation's preview (or the whole book) is ready. */
const TRANSLATION_POLL_MS = 3_000;
/** Stop waiting for a translation to start showing up after this long. */
const TRANSLATION_WAIT_MS = 15 * 60_000;

const isInProgress = (book: Book) =>
  !book.deletedAt && !!book.progress && book.progress[0] < book.progress[1];

const languageName = (code: string, uiLang: string) => {
  try {
    return new Intl.DisplayNames([uiLang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** What a row tells its covers: whether the row is near the viewport, and its scroller. */
const RowContext = createContext<{
  near: boolean;
  scroller: HTMLElement | null;
}>({
  near: true,
  scroller: null,
});

/** Rows within this distance (px) above/below the scrolling page load their covers. */
const ROW_MARGIN_Y = 300;
/** Covers within this distance (px) left/right of a row's visible part load. */
const COVER_MARGIN_X = 400;

/** True once `ref` has come within `margin` of `root` (null = viewport); stays true after. */
const useNearOnce = (
  ref: React.RefObject<HTMLElement | null>,
  root: Element | null,
  margin: string,
  enabled: boolean,
) => {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !enabled || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, root, margin, enabled, near]);
  return near;
};

const Row: React.FC<{
  title: string;
  seeAll?: string | null;
  children: React.ReactNode;
}> = ({ title, seeAll, children }) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [pageRoot, setPageRoot] = useState<HTMLElement | null | undefined>(undefined);
  // The page scrolls inside an overflow container, which clips what the viewport sees.
  useEffect(() => {
    setPageRoot(sectionRef.current?.closest<HTMLElement>('.overflow-y-auto') ?? null);
  }, []);
  const near = useNearOnce(
    sectionRef,
    pageRoot ?? null,
    `${ROW_MARGIN_Y}px 0px`,
    pageRoot !== undefined,
  );
  const context = useMemo(() => ({ near, scroller }), [near, scroller]);
  return (
    <section ref={sectionRef} className='flex flex-col gap-2' aria-label={title}>
      <div className='flex items-center justify-between px-4 sm:px-6'>
        <h2 className='text-base-content text-lg font-semibold'>{title}</h2>
        {seeAll && (
          <button
            type='button'
            className='text-base-content/75 hover:text-base-content flex items-center text-sm'
            onClick={() => router.push(seeAll)}
          >
            {_('See all')}
            <MdChevronRight className='h-5 w-5' />
          </button>
        )}
      </div>
      <div ref={setScroller} className='no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1 sm:px-6'>
        <RowContext.Provider value={context}>{children}</RowContext.Provider>
      </div>
    </section>
  );
};

const Cover: React.FC<{
  src: string;
  children?: React.ReactNode;
}> = ({ src, children }) => {
  const { near, scroller } = useContext(RowContext);
  const ref = useRef<HTMLDivElement>(null);
  // Load only once the row is near the page viewport and this card near the row's visible part.
  const visible = useNearOnce(ref, scroller, `0px ${COVER_MARGIN_X}px`, near && !!scroller);
  return (
    <div
      ref={ref}
      className='bg-base-300 relative aspect-[2/3] w-full overflow-hidden rounded-md shadow-md'
    >
      {visible && (
        <CoverImg
          src={src}
          loading='lazy'
          className='h-full w-full object-cover transition-transform group-hover:scale-[1.03]'
        />
      )}
      {children}
    </div>
  );
};

/** The library's covers also exist as WebP (`covers/<hash>.webp`, usually much smaller). */
const LIBRARY_COVER_JPEG = /\/covers\/[0-9a-f]{32}\.jpg$/;

/**
 * A library cover as WebP, falling back to the JPEG once if the WebP is missing (a cover
 * published by a worker that doesn't make WebP yet). Other images are shown as given.
 */
const CoverImg: React.FC<{
  src: string;
  className: string;
  loading?: 'lazy' | 'eager';
}> = ({ src, className, loading }) => {
  const webp = LIBRARY_COVER_JPEG.test(src) ? src.replace(/\.jpg$/, '.webp') : src;
  const [current, setCurrent] = useState(webp);
  useEffect(() => setCurrent(webp), [webp]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt=''
      loading={loading}
      decoding='async'
      onError={() => current !== src && setCurrent(src)}
      className={className}
    />
  );
};

const Card: React.FC<{
  card: DiscoverCard;
  contentLang: string;
  onOpen: (card: DiscoverCard) => void;
}> = ({ card, contentLang, onOpen }) => {
  const _ = useTranslation();
  return (
    <button
      type='button'
      className='group flex w-[7.25rem] shrink-0 flex-col gap-1.5 text-left sm:w-32'
      onClick={() => onOpen(card)}
      aria-label={card.author ? `${card.title}, ${card.author}` : card.title}
    >
      <Cover src={card.cover}>
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
            <span
              className='bg-base-100/90 text-base-content rounded px-1 text-[10px] font-semibold uppercase leading-5'
              title={_('Not yet translated')}
              aria-label={`${_('Language')}: ${card.lang.toUpperCase()}`}
            >
              {card.lang}
            </span>
          )}
        </div>
      </Cover>
      <p className='text-base-content line-clamp-2 text-sm font-medium leading-tight'>
        {card.title}
      </p>
      {card.author && <p className='text-base-content/75 truncate text-xs'>{card.author}</p>}
    </button>
  );
};

/** A requested translation: its cover, title and where the high-quality translation stands. */
const isRequestReady = (request: RequestedBook, work: LibraryWork | undefined) =>
  request.kind === 'readalong'
    ? work?.best?.kind === 'readalong'
    : !!work?.best && work.best.lang === request.lang && work.best.kind !== 'original';

const requestKey = (r: RequestedBook) => `${r.work_id}:${r.lang}:${r.kind ?? 'translation'}`;

const RequestedCard: React.FC<{
  request: RequestedBook;
  work: LibraryWork | undefined;
  onOpen: (request: RequestedBook, work: LibraryWork | undefined) => void;
  onForget: (request: RequestedBook) => void;
}> = ({ request, work, onOpen, onForget }) => {
  const _ = useTranslation();
  const narration = request.kind === 'readalong';
  const ready = isRequestReady(request, work);
  const job = work?.jobs.find((j) => j.kind === (request.kind ?? 'translation'));
  // Narration reports its own measured percentage, which stays on the job between turns.
  // At least 1% once listenable: the first minutes of a long book round down to 0.
  const narratedPercent = Math.max(1, Number(job?.progress?.match(/(\d+)%/)?.[1] ?? 0));
  const percent = narration
    ? narratedPercent
    : job?.status === 'running'
      ? (job.estimate?.percent ?? 0)
      : 0;
  const label = ready
    ? narration && job
      ? _('Listen now · {{percent}}% narrated', { percent })
      : narration
        ? _('Ready to listen')
        : _('Ready')
    : job?.status === 'running'
      ? _('{{percent}}% · {{eta}}', {
          percent,
          eta: formatEta(job.estimate?.eta_seconds, _),
        })
      : job?.status === 'queued' || job?.status === 'blocked'
        ? _('In line #{{position}}', { position: job.position ?? 1 })
        : job?.status === 'failed'
          ? _('Retrying soon')
          : _('Requested');
  return (
    <div className='relative flex w-[7.25rem] shrink-0 flex-col gap-1.5 sm:w-32'>
      <button
        type='button'
        className='group flex flex-col gap-1.5 text-left'
        onClick={() => onOpen(request, work)}
        aria-label={`${request.title}: ${label}`}
      >
        <Cover src={request.cover}>
          <div
            className={clsx(
              'absolute inset-x-0 bottom-0 flex flex-col gap-1 px-1.5 pb-1.5 pt-4 text-[11px] font-semibold',
              ready
                ? 'bg-gradient-to-t from-green-700/90 to-transparent text-white'
                : 'bg-gradient-to-t from-black/80 to-transparent text-white',
            )}
          >
            <span className='flex items-center gap-1'>
              {ready && <MdCheckCircle className='h-3.5 w-3.5' />}
              {label}
            </span>
            {!ready && (
              <div className='h-1 w-full overflow-hidden rounded-full bg-white/30'>
                <div
                  className={clsx('h-1 bg-white', percent === 0 && 'animate-pulse')}
                  style={{ width: `${Math.max(percent, 4)}%` }}
                />
              </div>
            )}
          </div>
        </Cover>
        <p className='text-base-content line-clamp-2 text-sm font-medium leading-tight'>
          {request.title}
        </p>
      </button>
      <button
        type='button'
        className='bg-base-100/90 text-base-content absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full'
        aria-label={_('Remove')}
        onClick={() => onForget(request)}
      >
        <MdClose className='h-4 w-4' />
      </button>
    </div>
  );
};

/** Choices for a book that isn't in the reader's language yet. */
const RequestSheet: React.FC<{
  card: DiscoverCard;
  lang: string;
  onTranslate: () => void;
  onReadOriginal: () => void;
  onClose: () => void;
}> = ({ card, lang, onTranslate, onReadOriginal, onClose }) => {
  const _ = useTranslation();
  const language = languageName(lang, lang);
  const original = languageName(card.lang, lang);
  return (
    <div
      className='fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center'
      role='dialog'
      aria-modal='true'
      aria-label={card.title}
      onClick={onClose}
    >
      <div
        className='bg-base-100 text-base-content flex w-full max-w-md flex-col gap-4 rounded-t-2xl p-5 pb-8 sm:rounded-2xl'
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 2rem)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex gap-4'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <CoverImg src={card.cover} className='aspect-[2/3] w-20 rounded object-cover shadow' />
          <div className='flex min-w-0 flex-col gap-1'>
            <p className='text-lg font-semibold leading-tight'>{card.title}</p>
            {card.author && <p className='text-base-content/75 text-sm'>{card.author}</p>}
            <p className='text-base-content/80 mt-1 text-sm'>
              {_('Not yet translated into {{language}}.', { language })}
            </p>
          </div>
        </div>
        <p className='text-base-content/70 text-sm'>
          {_(
            'We will prepare a high-quality {{language}} translation for you. You can follow its progress on this screen and in the book.',
            { language },
          )}
        </p>
        <button type='button' className='btn btn-primary' onClick={onTranslate}>
          <MdTranslate className='h-5 w-5' />
          {_('Translate the first part now')}
        </button>
        <button type='button' className='btn btn-ghost' onClick={onReadOriginal}>
          {_('Read the original ({{language}})', { language: original })}
        </button>
      </div>
    </div>
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
  const [opening, setOpening] = useState<{
    title: string;
    cover: string;
    progress: number;
    /** Set while waiting for a requested translation's preview: what the wait is on. */
    waiting?: string;
    /** The untranslated edition, offered while waiting. */
    original?: { work_id: number; lang: string; url: string; size?: number | null };
  } | null>(null);
  // Which open the overlay belongs to: cancelling (or a stall) invalidates it, so a late
  // download or import never navigates away from where the reader went back to.
  const openAttempt = useRef(0);
  const [sheet, setSheet] = useState<{ card: DiscoverCard } | null>(null);
  const [requests, setRequests] = useState<RequestedBook[]>(getRequestedBooks);
  const [requestStatus, setRequestStatus] = useState<Record<string, LibraryWork>>({});

  useEffect(() => {
    const onLanguage = (event: CustomEvent) => setLang((event.detail as { lang: string }).lang);
    const onRequests = () => setRequests(getRequestedBooks());
    eventDispatcher.on(CONTENT_LANGUAGE_EVENT, onLanguage);
    eventDispatcher.on(REQUESTS_EVENT, onRequests);
    return () => {
      eventDispatcher.off(CONTENT_LANGUAGE_EVENT, onLanguage);
      eventDispatcher.off(REQUESTS_EVENT, onRequests);
    };
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

  // Requested translations in this language: poll their status while Discover is open.
  const requested = useMemo(() => requests.filter((r) => r.lang === lang), [requests, lang]);
  useEffect(() => {
    if (!requested.length) return;
    let cancelled = false;
    const poll = async () => {
      const results = await Promise.all(
        requested.slice(0, 12).map((r) =>
          fetchWork(r.work_id, r.lang)
            .then((work) => [requestKey(r), work, r] as const)
            .catch(() => null),
        ),
      );
      if (cancelled) return;
      setRequestStatus((previous) => {
        const next = { ...previous };
        for (const result of results) {
          if (!result) continue;
          const [key, work, request] = result;
          const wasReady = isRequestReady(request, previous[key]);
          const isReady = isRequestReady(request, work);
          if (isReady && previous[key] && !wasReady) {
            eventDispatcher.dispatch('toast', {
              message:
                request.kind === 'readalong'
                  ? _('"{{title}}" is ready to listen to.', {
                      title: work.title,
                    })
                  : _('The {{language}} translation of "{{title}}" is ready.', {
                      language: languageName(work.lang, work.lang),
                      title: work.title,
                    }),
              type: 'success',
            });
          }
          next[key] = work;
        }
        return next;
      });
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [requested, _]);

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

  /** Download (or reuse) an edition and open it. */
  const openEdition = useCallback(
    async (
      edition: {
        work_id: number;
        lang: string;
        url: string;
        size?: number | null;
        hash?: string;
        kind?: DiscoverCard['kind'];
      },
      display: { title: string; cover: string },
      options: { preview?: boolean; attempt?: number } = {},
    ) => {
      if (!appService || (options.attempt === undefined && opening)) return;
      const attempt = options.attempt ?? ++openAttempt.current;
      const current = () => openAttempt.current === attempt;
      setOpening({ ...display, progress: 0 });
      try {
        const book = await openCatalogBook(appService, edition, (progress) => {
          if (current()) setOpening((state) => (state ? { ...state, progress } : state));
        });
        // Cancelled meanwhile: the book stays in the library (My books), nothing opens.
        if (!current()) return;
        // A preview has only its opening translated; the reader shows where the rest stands.
        if (options.preview) setPreviewBook(book.hash, edition.work_id, edition.lang);
        navigateToReader(router, [book.hash]);
      } catch (error) {
        console.warn('Discover: could not open', edition.url, error);
        if (!current()) return;
        eventDispatcher.dispatch('toast', {
          message: _('Could not open this book. Check your connection and try again.'),
          type: 'error',
        });
      } finally {
        if (current()) setOpening(null);
      }
    },
    [appService, opening, router, _],
  );

  /** Dismiss the opening overlay; a download or import still running finishes in the background. */
  const cancelOpening = useCallback(() => {
    openAttempt.current++;
    setOpening(null);
  }, []);

  /**
   * Request the translation of a book that has none in the reader's language and open it as soon
   * as its preview (the book with its opening translated by our fast process) or the complete
   * translation is published. `card` is given for a new request; an earlier request is just
   * followed.
   */
  const translateAndRead = useCallback(
    async (target: {
      work_id: number;
      title: string;
      cover: string;
      original: { lang: string; url: string; size?: number | null };
      card?: DiscoverCard;
    }) => {
      if (!appService || opening) return;
      const attempt = ++openAttempt.current;
      const current = () => openAttempt.current === attempt;
      const display = { title: target.title, cover: target.cover };
      setOpening({
        ...display,
        progress: 0,
        waiting: _('Preparing your translation…'),
        original: { work_id: target.work_id, ...target.original },
      });
      try {
        if (target.card) await requestTranslation(target.card, lang);
        const deadline = Date.now() + TRANSLATION_WAIT_MS;
        for (;;) {
          const work = await fetchWork(target.work_id, lang).catch(() => null);
          if (!current()) return;
          if (work) {
            const wait = getTranslationWait(work, lang);
            if (wait.kind === 'ready' || wait.kind === 'preview') {
              await openEdition(
                {
                  work_id: target.work_id,
                  lang,
                  url: wait.url,
                  hash: wait.hash,
                  size: wait.kind === 'preview' ? wait.size : undefined,
                },
                display,
                { preview: wait.kind === 'preview', attempt },
              );
              return;
            }
            const waiting =
              wait.kind === 'queued'
                ? _('In line #{{position}}', { position: wait.position })
                : _('Preparing your translation…');
            setOpening((state) => (state && current() ? { ...state, waiting } : state));
          }
          if (Date.now() > deadline) throw new Error('translation_wait_timeout');
          await new Promise((resolve) => setTimeout(resolve, TRANSLATION_POLL_MS));
          if (!current()) return;
        }
      } catch (error) {
        console.warn('Discover: translation did not start', target.work_id, error);
        if (!current()) return;
        setOpening(null);
        eventDispatcher.dispatch('toast', {
          message: _('Could not open this book. Check your connection and try again.'),
          type: 'error',
        });
      }
    },
    [appService, opening, lang, openEdition, _],
  );

  /** Give up waiting for the translation and read the original edition now. */
  const readOriginalInstead = useCallback(() => {
    const original = opening?.original;
    const display = opening ? { title: opening.title, cover: opening.cover } : null;
    cancelOpening();
    if (original && display) void openEdition(original, display);
  }, [opening, cancelOpening, openEdition]);

  // A download or import that makes no progress for this long is given up on, so the full-screen
  // overlay can never trap the reader (it used to stay on screen until the app was restarted).
  // Waiting for a translation to be prepared can take longer and has its own limit.
  const isDownloading = opening !== null && !opening.waiting;
  const openingProgress = opening?.progress;
  const openingPercent = Math.round((openingProgress ?? 0) * 100);
  useEffect(() => {
    if (!isDownloading) return;
    const timer = setTimeout(() => {
      cancelOpening();
      eventDispatcher.dispatch('toast', {
        message: _('Could not open this book. Check your connection and try again.'),
        type: 'error',
      });
    }, OPEN_STALL_MS);
    return () => clearTimeout(timer);
  }, [isDownloading, openingProgress, cancelOpening, _]);

  const openCard = useCallback(
    async (card: DiscoverCard) => {
      if (card.lang === lang) {
        await openEdition(card, card);
        return;
      }
      setSheet({ card });
    },
    [lang, openEdition],
  );

  const translateFromSheet = useCallback(async () => {
    if (!sheet) return;
    const { card } = sheet;
    setSheet(null);
    await translateAndRead({
      work_id: card.work_id,
      title: card.title,
      cover: card.cover,
      original: { lang: card.lang, url: card.url, size: card.size },
      card,
    });
  }, [sheet, translateAndRead]);

  const readOriginalFromSheet = useCallback(async () => {
    if (!sheet) return;
    const { card } = sheet;
    setSheet(null);
    // Still ask for the translation: the reader follows it and offers the switch when it is ready.
    requestTranslation(card, lang).catch((error) =>
      console.warn('Discover: translation request failed', error),
    );
    await openEdition(card, card);
  }, [sheet, lang, openEdition]);

  const openRequested = useCallback(
    async (request: RequestedBook, work: LibraryWork | undefined) => {
      if (request.kind === 'readalong') {
        // Open the narration as far as it goes (the reader moves on to larger editions and
        // starts playing), or the book itself while the first part is being made.
        sessionStorage.setItem(
          NARRATION_WANTED_KEY,
          JSON.stringify({
            workId: request.work_id,
            lang: request.lang,
            autoplay: true,
            since: Date.now(),
          }),
        );
        const best = work?.best;
        await openEdition(
          best?.kind === 'readalong'
            ? {
                work_id: request.work_id,
                lang: request.lang,
                url: best.url,
                hash: best.hash,
                kind: 'readalong' as const,
              }
            : { work_id: request.work_id, ...request.original },
          request,
        );
        return;
      }
      const ready = isRequestReady(request, work);
      if (ready && work?.best) {
        await openEdition(
          {
            work_id: request.work_id,
            lang: request.lang,
            url: work.best.url,
            hash: work.best.hash,
          },
          request,
        );
        forgetRequestedBook(request.work_id, request.lang);
        return;
      }
      // Not ready yet: open its preview, or wait for one.
      await translateAndRead({
        work_id: request.work_id,
        title: request.title,
        cover: request.cover,
        original: request.original,
      });
    },
    [openEdition, translateAndRead],
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

        {requested.length > 0 && (
          <Row title={_('Your requests')}>
            {requested.map((request) => (
              <RequestedCard
                key={requestKey(request)}
                request={request}
                work={requestStatus[requestKey(request)]}
                onOpen={openRequested}
                onForget={(r) => forgetRequestedBook(r.work_id, r.lang, r.kind ?? 'translation')}
              />
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

      {sheet && (
        <RequestSheet
          card={sheet.card}
          lang={lang}
          onTranslate={translateFromSheet}
          onReadOriginal={readOriginalFromSheet}
          onClose={() => setSheet(null)}
        />
      )}

      {opening && (
        <div
          className='bg-base-200/95 fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 px-8'
          role='status'
          aria-live='polite'
        >
          <CoverImg
            src={opening.cover}
            className='aspect-[2/3] w-40 rounded-md object-cover shadow-xl'
          />
          <p className='text-base-content text-center text-lg font-semibold'>{opening.title}</p>
          <div className='bg-base-300 h-1.5 w-48 overflow-hidden rounded-full'>
            <div
              className={clsx(
                'bg-primary h-1.5 transition-[width]',
                !opening.progress && 'animate-pulse',
              )}
              style={{
                width: `${Math.max(8, Math.round(opening.progress * 100))}%`,
              }}
            />
          </div>
          <p className='text-base-content/75 text-sm'>
            {opening.waiting ?? _('Opening book…')}
            {!opening.waiting &&
              openingPercent > 0 &&
              openingPercent < 100 &&
              ` ${openingPercent}%`}
          </p>
          {opening.original && (
            <button type='button' className='btn btn-outline btn-sm' onClick={readOriginalInstead}>
              {_('Read the original ({{language}})', {
                language: languageName(opening.original.lang, lang),
              })}
            </button>
          )}
          <button type='button' className='btn btn-ghost btn-sm' onClick={cancelOpening}>
            {_('Cancel')}
          </button>
        </div>
      )}
    </div>
  );
};

export default DiscoverHome;
