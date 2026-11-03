// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-01 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Narration that is still being made. After Speak asks for narration (useTTSControl), the
// library narrates from the reader's chapter and publishes a read-along edition within
// seconds, then larger ones as it goes. This banner follows that: it says how far along the
// narration is, opens the first narrated edition at the same place and starts playing, and
// when playback reaches the end of what is narrated so far, opens the larger edition there
// and carries on playing.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PiHeadphones } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { markBookDeleted } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';
import { reloadReaderWith } from '@/utils/nav';
import { isTauriAppPlatform } from '@/services/environment';
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
/** While a listener follows a growing narration: a part that runs out is followed quickly. */
const LISTEN_POLL_MS = 4000;
const SLOW_POLL_MS = 20_000;

type Wanted = {
  workId: number;
  lang: string;
  autoplay: boolean;
  since: number;
  /** Speak found no narration from this section on yet: waiting for it to be narrated. */
  atSection?: number;
};
type Landing = {
  hash: string;
  index: number;
  anchor?: string;
  autoplay: boolean;
  /** The partial narration edition this one replaces: removed from the device after landing. */
  replaces?: string;
};

const readWanted = (): Wanted | null => {
  try {
    return JSON.parse(sessionStorage.getItem(NARRATION_WANTED_KEY) || 'null') as Wanted | null;
  } catch {
    return null;
  }
};

const NarrationBanner: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const bookData = useBookDataStore((s) => s.getBookData(bookKey));
  const getView = useReaderStore((s) => s.getView);
  const getProgress = useReaderStore((s) => s.getProgress);
  const [work, setWork] = useState<LibraryWork | null>(null);
  const [wanted, setWanted] = useState<Wanted | null>(readWanted);
  const [switching, setSwitching] = useState(false);
  /** Autoplay was refused (a fresh page load in a browser): the listener has to tap. */
  const [needsTap, setNeedsTap] = useState(false);
  /** Last playback state: 'playing', 'paused' (by the listener) or 'stopped' (ended). */
  const playback = useRef<string | null>(null);
  /** Whether audio has actually played for this book on this page (autoplay can be refused). */
  const played = useRef(false);
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
  // Shown while narration is wanted or still being made for this book.
  const active = workId !== null && (isWanted || (narrated && !!job));
  // Followed (polled) whenever it may still grow: a narrated book is checked until the server
  // reports no narration job, which also covers a reload into a newer edition.
  const following = workId !== null && (isWanted || narrated);

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
      // Big illustrated books take a while to open on a phone: wait up to a minute.
      // Ready when the view is initialised and has a reading position (what speech needs; the
      // same readiness Readest's own autoplay waits for in useBooksManager).
      const state = useReaderStore.getState().viewStates[bookKey];
      const ready = !!view?.book && !!state?.inited && !!getProgress(bookKey);
      if (!ready && ++tries < 240) return;
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
        // Waiting at a chapter the narration hadn't reached: stay there (speaking it again
        // either plays or asks again). Otherwise, on a page without narration (a cover or
        // contents page), show the first narrated section, where playback starts.
        const waiting = readWanted()?.atSection != null;
        if (waiting && !section?.mediaOverlay?.href) {
          // This edition doesn't narrate the listener's chapter yet (it may have narrated a
          // later one first): keep waiting here rather than start further on.
          if (landing!.replaces) void removeSuperseded(landing!.replaces);
          return;
        }
        if (!waiting && !section?.mediaOverlay?.href) {
          const narratedIndex = findNarratedSection(view.book, landing!.index, 1);
          if (narratedIndex >= 0) await view.goTo(narratedIndex);
        }
        setTimeout(() => eventDispatcher.dispatch('tts-speak', { bookKey }), 600);
        setTimeout(
          () => !played.current && readWanted()?.atSection == null && setNeedsTap(true),
          5000,
        );
      }
      if (landing!.replaces) void removeSuperseded(landing!.replaces);
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, bookKey, getView, getProgress]);

  /**
   * A growing narration is published as a series of editions; each one opened is a new file
   * (on Android a full download). Once the reader is in the newer one, the older partial copy
   * is removed from the device so the library keeps one copy of the book.
   */
  const removeSuperseded = async (hash: string) => {
    if (!appService || hash === book?.hash) return;
    const old = useLibraryStore.getState().library.find((b) => b.hash === hash && !b.deletedAt);
    if (!old) return;
    try {
      await appService.deleteBook(old, 'local');
      markBookDeleted(old, Date.now(), false);
      await useLibraryStore.getState().updateBook(envConfig, old);
    } catch (error) {
      console.warn('Narration: could not remove the older edition', error);
    }
  };

  useEffect(() => {
    const onRequested = () => setWanted(readWanted());
    const onPlayback = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; state?: string };
      if (detail.bookKey && detail.bookKey !== bookKey) return;
      playback.current = detail.state ?? null;
      if (detail.state === 'playing') {
        played.current = true;
        setNeedsTap(false);
        // Narration reached the chapter the listener was waiting at.
        const current = readWanted();
        if (current?.atSection != null) {
          const { atSection: _reached, ...rest } = current;
          sessionStorage.setItem(NARRATION_WANTED_KEY, JSON.stringify(rest));
          setWanted(rest);
        }
      }
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
          kind: 'readalong',
          lang: latest.best.lang,
          url: latest.best.url,
          hash,
        });
        const place = currentPlace();
        sessionStorage.setItem(
          LANDING_KEY,
          JSON.stringify({
            hash: opened.hash,
            ...place,
            autoplay,
            // Only a partial narration edition is replaced; the plain book the listener
            // started from stays in the library.
            replaces: narrated && book ? book.hash : undefined,
          } satisfies Landing),
        );
        if (isTauriAppPlatform()) {
          // Apps: a full load (the native narration player needs no user gesture).
          reloadReaderWith(opened.hash);
        } else {
          // Web: swap the book in place. A new page load would lose the listener's tap, and
          // browsers (Firefox by default) then refuse to start audio on their own.
          eventDispatcher.dispatch('open-book-in-reader', { bookHash: opened.hash });
        }
      } catch (error) {
        console.warn('Narration: could not open the newer edition', error);
        switchedTo.current = null;
      } finally {
        setSwitching(false);
      }
    },
    [appService, workId, switching, currentPlace, narrated, book],
  );

  // Follow the narration while it is being made.
  useEffect(() => {
    if (workId === null || !book || !following) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      const latest = await fetchWork(workId, lang).catch(() => null);
      if (cancelled || !latest) return;
      setWork(latest);
      const best = latest.best;
      const newer = best?.kind === 'readalong' && !!best.hash && best.hash !== book.hash;
      const jobActive = latest.jobs.some((j) => j.kind === 'readalong');
      if (!jobActive && best?.kind === 'readalong' && !newer) {
        // The whole book is narrated and open: nothing more to follow.
        forgetRequestedBook(workId, lang, 'readalong');
        sessionStorage.removeItem(NARRATION_WANTED_KEY);
        clearInterval(timer);
        return;
      }
      if (!newer) return;
      const latestWish = readWanted();
      if (isWanted && (!narrated || latestWish?.atSection != null)) {
        // The first narration exists, or a newer one may reach the chapter the listener is
        // waiting at: open it here and start listening. The wish stays in session storage,
        // so each later part also carries on playing when one runs out.
        await switchTo(latest, wanted!.autoplay);
        return;
      }
      // Playback ran out at the end of the narrated part: open the larger edition there and
      // carry on playing. Nothing else switches editions (on a phone each switch is a full
      // download and reload, which would interrupt someone reading); a listener in an older
      // edition simply moves on when they reach its end.
      const view = getView(bookKey);
      const index = getProgress(bookKey)?.index ?? 0;
      const ranOut =
        // Only after audio has really played here: a refused autoplay also ends as
        // 'stopped', and switching then would reload in a loop without a sound.
        played.current &&
        playback.current === 'stopped' &&
        !!view?.book &&
        narrated &&
        findNarratedSection(view.book, index + 1, 1) === -1;
      if (ranOut) await switchTo(latest, true);
    };
    void poll();
    timer = setInterval(
      poll,
      !narrated || readWanted()?.atSection != null
        ? FAST_POLL_MS
        : isWanted
          ? LISTEN_POLL_MS
          : SLOW_POLL_MS,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId, lang, book?.hash, following, narrated, isWanted]);

  if (!active) return null;
  const percent = Math.max(1, Number((job?.progress ?? '').match(/(\d+)%/)?.[1] ?? 0));
  const message = switching
    ? _('Opening the narration…')
    : !narrated
      ? job?.status === 'queued' || job?.status === 'blocked'
        ? _('Narration starts in a moment (#{{position}} in line)…', {
            position: job.position ?? 1,
          })
        : _('Preparing narration… it starts in a few seconds')
      : wanted?.atSection != null && isWanted
        ? _("Narration hasn't reached this chapter yet. It will start here shortly.")
        : job
          ? _('Narration in progress: {{percent}}% of the book narrated', { percent })
          : null;
  if (needsTap && narrated) {
    return (
      <div
        className='pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3'
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 3.25rem)' }}
      >
        <button
          type='button'
          onClick={() => {
            setNeedsTap(false);
            eventDispatcher.dispatch('tts-speak', { bookKey });
          }}
          className='bg-primary text-primary-content pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-md'
        >
          <PiHeadphones className='h-4 w-4' />
          <span>{_('Ready to listen')}</span>
        </button>
      </div>
    );
  }
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
