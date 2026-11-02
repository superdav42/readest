// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-01 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Narration that is still being made. After Speak asks for narration (useTTSControl), the
// library narrates from the reader's chapter and publishes a read-along edition within
// seconds, then larger ones as it goes. This banner follows that: it says how far along the
// narration is, opens the first narrated edition at the same sentence and starts playing,
// and moves to each larger edition when the reader isn't listening or when playback runs
// out at the end of what is narrated so far.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PiHeadphones } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { isWebAppPlatform } from '@/services/environment';
import { getRuntimeConfig } from '@/services/runtimeConfig';
import { findNarratedSection, hasMediaOverlays } from '@/services/tts/mediaOverlay';
import {
  fetchWork,
  forgetRequestedBook,
  parseWorkId,
  toContentLanguage,
  type LibraryWork,
} from '@/services/gutenbergLibrary';
import { openCatalogBook } from '@/services/openCatalogBook';
import { formatEta } from './InstantTranslationBanner';

/** Set by Speak when it asks for narration: { workId, lang, autoplay }. */
export const NARRATION_WANTED_KEY = 'gai:narrationWanted';
/** Where to land in a newer narration edition: { hash, index, anchor, autoplay }. */
const LANDING_KEY = 'gai:narrationLanding';
export const NARRATION_REQUESTED_EVENT = 'narration-requested';

const FAST_POLL_MS = 1500;
const SLOW_POLL_MS = 20_000;

type Wanted = { workId: number; lang: string; autoplay: boolean; since: number };
type Landing = { hash: string; index: number; anchor?: string; autoplay: boolean };

const readWanted = (): Wanted | null => {
  try {
    return JSON.parse(sessionStorage.getItem(NARRATION_WANTED_KEY) || 'null') as Wanted | null;
  } catch {
    return null;
  }
};

const NarrationBanner: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { appService } = useEnv();
  const bookData = useBookDataStore((s) => s.getBookData(bookKey));
  const getView = useReaderStore((s) => s.getView);
  const getProgress = useReaderStore((s) => s.getProgress);
  const [work, setWork] = useState<LibraryWork | null>(null);
  const [wanted, setWanted] = useState<Wanted | null>(readWanted);
  const [switching, setSwitching] = useState(false);
  const playing = useRef(false);
  const switchedTo = useRef<string | null>(null);

  const book = bookData?.book;
  const metadata = bookData?.bookDoc?.metadata as
    | { identifier?: string; language?: string | string[] }
    | undefined;
  const workId = parseWorkId(metadata?.identifier);
  const lang = toContentLanguage(
    (Array.isArray(metadata?.language) ? metadata?.language[0] : metadata?.language) ||
      book?.primaryLanguage,
  );
  const narrated = hasMediaOverlays(bookData?.bookDoc);
  const isWanted = !!wanted && wanted.workId === workId && wanted.lang === lang;
  const job = work?.jobs.find((j) => j.kind === 'readalong');
  const active = workId !== null && (isWanted || (narrated && !!job));

  // Land at the sentence the listener was at, and keep playing, after a switch.
  useEffect(() => {
    if (!book) return;
    let landing: Landing | null = null;
    try {
      landing = JSON.parse(sessionStorage.getItem(LANDING_KEY) || 'null') as Landing | null;
    } catch {
      landing = null;
    }
    if (!landing || landing.hash !== book.hash) return;
    let tries = 0;
    const timer = setInterval(async () => {
      const view = getView(bookKey);
      if (!view?.book && ++tries < 40) return;
      clearInterval(timer);
      sessionStorage.removeItem(LANDING_KEY);
      if (!view) return;
      const section = view.book.sections?.[landing!.index];
      try {
        await view.goTo(
          landing!.anchor && section?.id ? `${section.id}#${landing!.anchor}` : landing!.index,
        );
      } catch {
        await view.goTo(landing!.index);
      }
      if (landing!.autoplay) {
        setTimeout(() => eventDispatcher.dispatch('tts-speak', { bookKey }), 600);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [book, bookKey, getView]);

  useEffect(() => {
    const onRequested = () => setWanted(readWanted());
    const onPlayback = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; state?: string };
      if (detail.bookKey && detail.bookKey !== bookKey) return;
      playing.current = detail.state === 'playing';
    };
    eventDispatcher.on(NARRATION_REQUESTED_EVENT, onRequested);
    eventDispatcher.on('tts-playback-state', onPlayback);
    return () => {
      eventDispatcher.off(NARRATION_REQUESTED_EVENT, onRequested);
      eventDispatcher.off('tts-playback-state', onPlayback);
    };
  }, [bookKey]);

  /** Where the reader is: section index and the narrated sentence (span id) there, if any. */
  const currentPlace = useCallback((): { index: number; anchor?: string } => {
    const view = getView(bookKey);
    const index = getProgress(bookKey)?.index ?? 0;
    try {
      const range = (view as unknown as { lastLocation?: { range?: Range } })?.lastLocation?.range;
      const node = range?.startContainer;
      const element = (node?.nodeType === 1 ? node : node?.parentElement) as Element | null;
      const span =
        element?.closest('[id^="gai-s"]') ?? element?.ownerDocument?.querySelector('[id^="gai-s"]');
      return { index, anchor: span?.id || undefined };
    } catch {
      return { index };
    }
  }, [bookKey, getProgress, getView]);

  const switchTo = useCallback(
    async (latest: LibraryWork, autoplay: boolean) => {
      if (!appService || !latest.best || workId === null || switching) return;
      const hash = latest.best.hash;
      if (!hash || switchedTo.current === hash) return;
      switchedTo.current = hash;
      setSwitching(true);
      try {
        const opened = await openCatalogBook(appService, {
          work_id: workId,
          lang: latest.best.lang,
          url: latest.best.url,
          hash,
        });
        const place = currentPlace();
        sessionStorage.setItem(
          LANDING_KEY,
          JSON.stringify({ hash: opened.hash, ...place, autoplay } satisfies Landing),
        );
        if (isWebAppPlatform())
          window.location.assign(
            getRuntimeConfig()?.serverless
              ? `/reader/?ids=${opened.hash}`
              : `/reader/${opened.hash}`,
          );
        else navigateToReader(router, [opened.hash]);
      } catch (error) {
        console.warn('Narration: could not open the newer edition', error);
        switchedTo.current = null;
      } finally {
        setSwitching(false);
      }
    },
    [appService, workId, switching, currentPlace, router],
  );

  // Follow the narration while it is being made.
  useEffect(() => {
    if (workId === null || !book || !active) return;
    let cancelled = false;
    const poll = async () => {
      const latest = await fetchWork(workId, lang).catch(() => null);
      if (cancelled || !latest) return;
      setWork(latest);
      const best = latest.best;
      const newer = best?.kind === 'readalong' && !!best.hash && best.hash !== book.hash;
      const jobActive = latest.jobs.some((j) => j.kind === 'readalong');
      if (!jobActive && best?.kind === 'readalong' && !newer) {
        forgetRequestedBook(workId, lang, 'readalong');
      }
      if (!newer) return;
      if (isWanted && !narrated) {
        // The first narration exists: open it here and start listening.
        sessionStorage.removeItem(NARRATION_WANTED_KEY);
        await switchTo(latest, wanted!.autoplay);
        return;
      }
      if (!playing.current) {
        // Not listening right now: move to the larger edition quietly, at the same place. If
        // playback just ran out at the end of the narrated part, carry on playing.
        const view = getView(bookKey);
        const index = getProgress(bookKey)?.index ?? 0;
        const ranOut =
          !!view?.book && narrated && findNarratedSection(view.book, index + 1, 1) === -1;
        await switchTo(latest, ranOut && isWanted);
      }
    };
    void poll();
    const timer = setInterval(poll, narrated ? SLOW_POLL_MS : FAST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, lang, book?.hash, active, narrated, isWanted]);

  if (!active) return null;
  const percent = Number((job?.progress ?? '').match(/(\d+)%/)?.[1] ?? 0);
  const message = switching
    ? _('Opening the narration…')
    : !narrated
      ? job?.status === 'queued' || job?.status === 'blocked'
        ? _('Narration starts in a moment (#{{position}} in line)…', {
            position: job.position ?? 1,
          })
        : _('Preparing narration… it starts in a few seconds')
      : job
        ? _('Narration in progress: {{percent}}% of the book narrated', { percent })
        : null;
  if (!message) return null;

  return (
    <div
      className='pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3'
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 3.25rem)' }}
    >
      <div
        role='status'
        aria-live='polite'
        className='bg-base-200/95 text-base-content pointer-events-auto flex max-w-md items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-md'
      >
        <PiHeadphones className={narrated ? 'h-4 w-4' : 'h-4 w-4 animate-pulse'} />
        <span>{message}</span>
        {narrated && job?.estimate?.eta_seconds ? (
          <span className='opacity-60'>· {formatEta(job.estimate.eta_seconds, _)}</span>
        ) : null}
      </div>
    </div>
  );
};

export default NarrationBanner;
