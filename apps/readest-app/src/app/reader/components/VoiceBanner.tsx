// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-12 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Cold start of a read-along voice. A book whose LibriVox recording has not been processed yet
// has no voice: Speak asks the catalog for one (request_voice, a reader-priority job that builds
// the first tracks in minutes) and this banner plays the ORIGINAL recording from the LibriVox
// archive meanwhile. As soon as the voice is published it opens the read-along text edition at
// the sentence the original audio had reached and carries on with the cleaned voice.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PiHeadphones, PiPlay, PiX } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';
import { reloadReaderWith } from '@/utils/nav';
import { isTauriAppPlatform } from '@/services/environment';
import {
  fetchWorkVoices,
  parseWorkId,
  requestVoice,
  toContentLanguage,
  type VoiceSource,
} from '@/services/gutenbergLibrary';
import { openCatalogBook } from '@/services/openCatalogBook';
import { sectionIndexForHref } from '@/services/tts/libraryVoice';
import { VOICE_PREPARING_EVENT } from '../hooks/useVoiceOnDemand';

/** Set by Speak when it asks for a voice: { workId, lang, since }. */
export const VOICE_WANTED_KEY = 'gai:voiceWanted';
/** Where to land in the read-along edition: { hash, sectionHref, sentenceId, autoplay }. */
const LANDING_KEY = 'gai:voiceLanding';
export const VOICE_REQUESTED_EVENT = 'voice-requested';

const POLL_MS = 2500;
/** Stop asking after this long without a voice (the job failed or the queue is deep). */
const GIVE_UP_MS = 15 * 60_000;

type Wanted = { workId: number; lang: string; since: number };
type Landing = { hash: string; sectionHref?: string; sentenceId?: string; autoplay: boolean };
type SyncMap = {
  sections: { href: string; pars: [string, number, number, number, number][] }[];
};

const readWanted = (): Wanted | null => {
  try {
    return JSON.parse(sessionStorage.getItem(VOICE_WANTED_KEY) || 'null') as Wanted | null;
  } catch {
    return null;
  }
};

/** The sentence a recording position falls in (or the nearest one before it) in a sync map. */
export const sentenceAt = (
  sync: SyncMap,
  track: number,
  seconds: number,
): { sectionHref: string; sentenceId: string } | null => {
  let before: { sectionHref: string; sentenceId: string; begin: number } | null = null;
  let first: { sectionHref: string; sentenceId: string } | null = null;
  for (const section of sync.sections) {
    for (const [id, t, begin, end] of section.pars) {
      first ??= { sectionHref: section.href, sentenceId: id };
      if (t !== track) continue;
      if (begin <= seconds && seconds < end) return { sectionHref: section.href, sentenceId: id };
      if (begin <= seconds && (!before || begin > before.begin)) {
        before = { sectionHref: section.href, sentenceId: id, begin };
      }
    }
  }
  return before ? { sectionHref: before.sectionHref, sentenceId: before.sentenceId } : first;
};

/**
 * Start reading aloud at a sentence. A bare tts-speak starts at the first passage of the page
 * shown, which is up to a page (minutes of audio) before the sentence the listener had reached;
 * the sentence's own range starts exactly there. Waits for the section to render, falls back to
 * the page start when the sentence cannot be found.
 */
const speakFromSentence = async (
  bookKey: string,
  sectionIndex: number,
  sentenceId: string | undefined,
) => {
  let range: Range | null = null;
  if (sentenceId && sectionIndex >= 0) {
    for (let tries = 0; tries < 20 && !range; tries++) {
      const view = useReaderStore.getState().getView(bookKey);
      const doc = view?.renderer
        ?.getContents?.()
        .find((content: { index?: number }) => content.index === sectionIndex)?.doc;
      const element = doc?.getElementById(sentenceId);
      if (doc && element) {
        range = doc.createRange();
        range.selectNodeContents(element);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
  eventDispatcher.dispatch(
    'tts-speak',
    range ? { bookKey, range, index: sectionIndex } : { bookKey },
  );
};

const VoiceBanner: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const bookData = useBookDataStore((s) => s.getBookData(bookKey));
  const getView = useReaderStore((s) => s.getView);
  const getProgress = useReaderStore((s) => s.getProgress);
  const [wanted, setWanted] = useState<Wanted | null>(readWanted);
  const [source, setSource] = useState<VoiceSource | null>(null);
  const [playing, setPlaying] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** The next part of a voice built as the listener goes is being made (useVoiceOnDemand). */
  const [preparingNext, setPreparingNext] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const track = useRef(0);
  const switched = useRef(false);

  const book = bookData?.book;
  const metadata = bookData?.bookDoc?.metadata as
    | { identifier?: string; language?: string | string[] }
    | undefined;
  const workId = parseWorkId(metadata?.identifier);
  const lang = toContentLanguage(
    (Array.isArray(metadata?.language) ? metadata?.language[0] : metadata?.language) ||
      book?.primaryLanguage,
  );
  const isWanted = !!wanted && wanted.workId === workId && wanted.lang === lang && !dismissed;

  useEffect(() => {
    const onRequested = () => {
      switched.current = false;
      setDismissed(false);
      setWanted(readWanted());
    };
    const onPreparing = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; preparing?: boolean };
      if (detail.bookKey === bookKey) setPreparingNext(!!detail.preparing);
    };
    eventDispatcher.on(VOICE_REQUESTED_EVENT, onRequested);
    eventDispatcher.on(VOICE_PREPARING_EVENT, onPreparing);
    return () => {
      eventDispatcher.off(VOICE_REQUESTED_EVENT, onRequested);
      eventDispatcher.off(VOICE_PREPARING_EVENT, onPreparing);
    };
  }, [bookKey]);

  const stopOriginal = useCallback(() => {
    audio.current?.pause();
    setPlaying(false);
  }, []);

  const playTrack = useCallback(async (src: VoiceSource, index: number) => {
    const entry = src.tracks[index];
    if (!entry) {
      setPlaying(false);
      return;
    }
    track.current = index;
    if (!audio.current) audio.current = new Audio();
    const element = audio.current;
    element.onended = () => void playTrack(src, index + 1);
    element.src = entry.url;
    try {
      await element.play();
      setPlaying(true);
      setNeedsTap(false);
    } catch {
      // Autoplay refused (the tap that asked for the voice is long gone): offer a button.
      setPlaying(false);
      setNeedsTap(true);
    }
  }, []);

  // Ask for the voice and follow it: play the original while waiting, open the read-along when
  // it is published.
  useEffect(() => {
    if (!isWanted || !wanted || !book || workId === null) return;
    let cancelled = false;
    let started = false;
    const poll = async () => {
      if (cancelled || switched.current) return;
      if (Date.now() - wanted.since > GIVE_UP_MS) {
        sessionStorage.removeItem(VOICE_WANTED_KEY);
        setWanted(null);
        stopOriginal();
        return;
      }
      const answer = await requestVoice(workId, lang, 0, 2).catch(() => null);
      if (cancelled || !answer) return;
      if (answer.status === 'unavailable') {
        // No recording after all: let a later Speak fall back to AI narration.
        sessionStorage.removeItem(VOICE_WANTED_KEY);
        setWanted(null);
        stopOriginal();
        eventDispatcher.dispatch('toast', {
          message: _('No recording of this book is available yet.'),
          type: 'info',
          timeout: 5000,
        });
        return;
      }
      if (answer.source && !started) {
        started = true;
        setSource(answer.source);
        void playTrack(answer.source, 0);
      }
      const listing = await fetchWorkVoices(workId, lang, true).catch(() => null);
      const info = listing?.voices?.find((v) => v.kind === 'human') ?? null;
      if (cancelled || !listing || !info) return;
      // The voice exists.
      switched.current = true;
      const atTrack = track.current;
      const seconds = audio.current?.currentTime ?? 0;
      const wasPlaying = !!audio.current && !audio.current.paused;
      stopOriginal();
      sessionStorage.removeItem(VOICE_WANTED_KEY);
      setWanted(null);
      if (listing.text.hash === book.hash) {
        // This very edition carries it: start it.
        setTimeout(() => eventDispatcher.dispatch('tts-speak', { bookKey }), 300);
        return;
      }
      if (!appService) return;
      setSwitching(true);
      try {
        const sync = (await (await fetch(info.sync_url)).json()) as SyncMap;
        const place = sentenceAt(sync, atTrack, seconds);
        const opened = await openCatalogBook(appService, {
          work_id: workId,
          kind: 'original',
          lang,
          url: listing.text.url,
          hash: listing.text.hash,
        });
        sessionStorage.setItem(
          LANDING_KEY,
          JSON.stringify({
            hash: opened.hash,
            ...(place ?? {}),
            autoplay: wasPlaying || playing,
          } satisfies Landing),
        );
        if (isTauriAppPlatform()) reloadReaderWith(opened.hash);
        else eventDispatcher.dispatch('open-book-in-reader', { bookHash: opened.hash });
      } catch (error) {
        console.warn('Voice: could not open the read-along edition', error);
        switched.current = false;
      } finally {
        setSwitching(false);
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWanted, wanted?.since, workId, lang, book?.hash]);

  // Stop the original recording when the banner goes away (the book is closed or swapped).
  useEffect(() => () => audio.current?.pause(), []);

  // Land at the sentence the original recording had reached, and keep listening.
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
      const state = useReaderStore.getState().viewStates[bookKey];
      const ready = !!view?.book && !!state?.inited && !!getProgress(bookKey);
      if (!ready && ++tries < 240) return;
      clearInterval(timer);
      sessionStorage.removeItem(LANDING_KEY);
      if (!view?.book) return;
      const index = landing!.sectionHref
        ? sectionIndexForHref(view.book, landing!.sectionHref)
        : -1;
      const section = index >= 0 ? view.book.sections?.[index] : undefined;
      try {
        await view.goTo(
          section?.id && landing!.sentenceId
            ? `${section.id}#${landing!.sentenceId}`
            : index >= 0
              ? index
              : 0,
        );
      } catch {
        if (index >= 0) await view.goTo(index);
      }
      if (landing!.autoplay) {
        setTimeout(() => void speakFromSentence(bookKey, index, landing!.sentenceId), 600);
      }
    }, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.hash, bookKey]);

  const dismiss = () => {
    stopOriginal();
    sessionStorage.removeItem(VOICE_WANTED_KEY);
    setDismissed(true);
    setWanted(null);
  };

  if (!isWanted && !preparingNext) return null;
  const message = switching
    ? _('Opening the cleaned read-along…')
    : preparingNext
      ? _('Preparing the next part of the recording…')
      : playing
        ? _('Playing the original recording while the cleaned read-along is prepared')
        : source
          ? null
          : _('Preparing the recording… it starts in a few seconds');
  const top = { top: 'calc(env(safe-area-inset-top, 0px) + 3.25rem)' };
  if (needsTap && source && isWanted && !switching) {
    return (
      <div
        className='pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3'
        style={top}
      >
        <button
          type='button'
          onClick={() => void playTrack(source, track.current)}
          className='bg-primary text-primary-content pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm shadow-md'
        >
          <PiPlay className='h-4 w-4' />
          <span>{_('Listen to the original recording now')}</span>
        </button>
      </div>
    );
  }
  if (!message) return null;
  return (
    <div
      className='pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3'
      style={top}
    >
      <div
        role='status'
        aria-live='polite'
        className='bg-base-200/95 text-base-content pointer-events-auto flex max-w-[min(28rem,100%)] items-center gap-2 rounded-full py-1 pe-1 ps-3 text-xs shadow-md'
      >
        <PiHeadphones className={playing ? 'h-4 w-4 shrink-0' : 'h-4 w-4 shrink-0 animate-pulse'} />
        <span className='min-w-0 truncate'>{message}</span>
        <button
          type='button'
          onClick={dismiss}
          aria-label={_('Close')}
          title={_('Close')}
          className='btn btn-ghost btn-circle btn-xs shrink-0'
        >
          <PiX className='h-3.5 w-3.5' />
        </button>
      </div>
    </div>
  );
};

export default VoiceBanner;
