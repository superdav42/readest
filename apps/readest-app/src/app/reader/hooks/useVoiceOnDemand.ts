// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-12 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Read-along voices are built as people listen. A LibriVox recording is cleaned and aligned a
// few tracks at a time (migration 0391), so while a library voice plays this hook
//   * tells the catalog where the listener is (request_voice: the track and the two after it),
//     which queues a reader-priority job when they are not built yet,
//   * swaps newer builds into the voice in place (more tracks, or tracks cleaned again), and
//   * when playback reaches the end of what is built, shows "preparing" and carries on by itself
//     as soon as the next part is published.
import { RefObject, useEffect, useRef } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';
import {
  fetchWorkVoices,
  parseWorkId,
  requestVoice,
  toContentLanguage,
} from '@/services/gutenbergLibrary';
import { LibraryVoice } from '@/services/tts/libraryVoice';
import type { TTSController } from '@/services/tts/TTSController';

/** Tracks asked for after the one being listened to. */
const AHEAD = 2;
/** How often a listener's place is reported while playing. */
const FOLLOW_MS = 15_000;
/**
 * Delay before the next "is it ready yet?" question of a listener who is waiting for a voice or its
 * next part: quick while a build is likely to finish soon (the first minute: the original
 * recording's tracks appear), then slower, so one waiting listener costs a few requests a minute
 * instead of dozens. `waited` is the time spent waiting so far, in ms.
 */
export const pollDelay = (waited: number): number =>
  waited < 60_000 ? 3_000 : waited < 180_000 ? 6_000 : 10_000;
/** Give up waiting after this long (the job may have failed or the queue is deep). */
const WAIT_GIVE_UP_MS = 10 * 60_000;

export const VOICE_WAIT_EVENT = 'voice-wait';
export const VOICE_PREPARING_EVENT = 'voice-preparing';

export type VoiceWait = {
  bookKey: string;
  /** The section playback could not enter because no voice track times it yet. */
  fromSection: number;
  /** 'end': playback ran out of the built tracks. 'jump': the listener started beyond them. */
  mode: 'end' | 'jump';
};

/** Track whose time span contains this share of the recording (0..1). */
export const trackAtShare = (seconds: number[], share: number): number => {
  const total = seconds.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let at = 0;
  for (let i = 0; i < seconds.length; i++) {
    at += seconds[i]!;
    if (at / total > share) return i;
  }
  return Math.max(seconds.length - 1, 0);
};

type Identity = { workId: number; lang: string };

export const identityOf = (bookKey: string): Identity | null => {
  const view = useReaderStore.getState().getView(bookKey);
  const metadata = view?.book?.metadata as
    | { identifier?: string; language?: string | string[] }
    | undefined;
  const workId = parseWorkId(metadata?.identifier);
  if (workId === null) return null;
  const book = useBookDataStore.getState().getBookData(bookKey)?.book;
  const lang = toContentLanguage(
    (Array.isArray(metadata?.language) ? metadata.language[0] : metadata?.language) ||
      book?.primaryLanguage,
  );
  return { workId, lang };
};

export const useVoiceOnDemand = (
  bookKey: string,
  controllerRef: RefObject<TTSController | null>,
) => {
  const waiting = useRef(false);

  // While a library voice sounds: report the place, take newer builds.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let busy = false;
    /** The last answer was not 'ready': a build is on its way, so look for it. */
    let building = false;
    let identity: Identity | null = null;

    const follow = async () => {
      const controller = controllerRef.current;
      const voice = controller?.activeLibraryVoice;
      if (busy || !controller || !voice || voice.info.kind !== 'human') return;
      const track = controller.currentLibraryTrack();
      if (track === null) return;
      identity ??= identityOf(bookKey);
      if (!identity) return;
      busy = true;
      try {
        const answer = await requestVoice(identity.workId, identity.lang, track, AHEAD);
        if (answer.status === 'unavailable') return;
        const wasBuilding = building;
        building = answer.status !== 'ready';
        // A build is queued or running, or just finished: look for what it published.
        if (building || wasBuilding) {
          const listing = await fetchWorkVoices(identity.workId, identity.lang, true);
          const info = listing?.voices.find((v) => v.key === voice.info.key);
          if (info) await controller.refreshLibraryVoice(info);
        }
      } catch (error) {
        console.warn('Voice on demand: could not follow the listener', error);
      } finally {
        busy = false;
      }
    };

    const onState = (event: CustomEvent) => {
      const detail = event.detail as { bookKey?: string; state?: string };
      if (detail.bookKey !== bookKey) return;
      clearInterval(timer);
      timer = undefined;
      if (detail.state === 'playing') {
        // Soon after playback starts, then regularly.
        setTimeout(() => void follow(), 2000);
        timer = setInterval(() => void follow(), FOLLOW_MS);
      }
    };
    eventDispatcher.on('tts-playback-state', onState);
    return () => {
      clearInterval(timer);
      eventDispatcher.off('tts-playback-state', onState);
    };
  }, [bookKey, controllerRef]);

  // Playback ran out of built tracks, or started beyond them: wait for the next part.
  useEffect(() => {
    const onWait = async (event: CustomEvent) => {
      const detail = event.detail as VoiceWait;
      if (detail.bookKey !== bookKey || waiting.current) return;
      const identity = identityOf(bookKey);
      const view = useReaderStore.getState().getView(bookKey);
      if (!identity || !view?.book) return;
      waiting.current = true;
      const announce = (preparing: boolean) =>
        eventDispatcher.dispatch(VOICE_PREPARING_EVENT, { bookKey, preparing });
      announce(true);
      const began = Date.now();
      let loaded: LibraryVoice | null = null;
      try {
        while (Date.now() - began < WAIT_GIVE_UP_MS) {
          const listing = await fetchWorkVoices(identity.workId, identity.lang, true);
          const info = listing?.voices.find((v) => v.kind === 'human' && v.default) ?? null;
          if (!info) break;
          // Which track to ask for: the first not built when playback ran out; for a start far
          // ahead, the track at the same share of the book as the listener's section.
          const unbuilt = info.tracks.findIndex((t) => t.ready === false);
          let track = unbuilt >= 0 ? unbuilt : 0;
          if (detail.mode === 'jump') {
            const sizes = (view.book.sections ?? []).map((s) => s.size || 0);
            const all = sizes.reduce((a, b) => a + b, 0);
            const before = sizes.slice(0, detail.fromSection).reduce((a, b) => a + b, 0);
            track = trackAtShare(
              info.tracks.map((t) => t.seconds),
              all ? before / all : 0,
            );
          }
          const answer = await requestVoice(identity.workId, identity.lang, track, AHEAD);
          // The sync map is fetched once per published build, not on every look.
          if (!loaded || loaded.info.sync_url !== info.sync_url) loaded = new LibraryVoice(info);
          const voice = loaded;
          await voice.load().catch(() => undefined);
          if (voice.loaded) {
            const forward = voice.findSection(view.book, detail.fromSection, 1);
            // 'end': carry on at the next timed section. 'jump': at the listener's own section
            // when it is timed; once the tracks asked for are built, at the nearest timed one.
            const target =
              detail.mode === 'end'
                ? forward
                : forward === detail.fromSection || answer.status === 'ready'
                  ? forward >= 0
                    ? forward
                    : voice.findSection(view.book, detail.fromSection, -1)
                  : -1;
            if (target >= 0) {
              announce(false);
              waiting.current = false;
              await view.goTo(target);
              setTimeout(() => eventDispatcher.dispatch('tts-speak', { bookKey }), 600);
              return;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, pollDelay(Date.now() - began)));
        }
      } catch (error) {
        console.warn('Voice on demand: waiting for the next part failed', error);
      }
      announce(false);
      waiting.current = false;
      eventDispatcher.dispatch('toast', {
        message: 'The next part is not ready yet. Try again in a moment.',
        type: 'info',
        timeout: 5000,
      });
    };
    eventDispatcher.on(VOICE_WAIT_EVENT, onWait);
    return () => eventDispatcher.off(VOICE_WAIT_EVENT, onWait);
  }, [bookKey]);
};
