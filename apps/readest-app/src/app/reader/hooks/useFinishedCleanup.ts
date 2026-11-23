// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Delete when finished: once a library voice has been heard to the end of the last narrated
// section (or 98% of its audio), and the reader leaves the book, the saved voice and the text
// edition are removed from the device. Bookmarks, notes, highlights and the reading position
// stay (deleteBook 'local' keeps config.json and the library record), and opening the book again
// downloads it back. Nothing is removed with Keep on or Delete when finished off.
import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useListeningSettings } from '@/hooks/useListeningSettings';
import { cleanUpFinished, isFinished, type FinishedTarget } from '@/services/listen/finished';
import type { TTSController } from '@/services/tts/TTSController';
import { removeVoiceOffline } from '@/services/tts/voiceOffline';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { identityOf } from './useVoiceOnDemand';

export const useFinishedCleanup = (bookKey: string, controller: TTSController | null) => {
  const { appService } = useEnv();
  const { listening } = useListeningSettings();
  const finished = useRef<FinishedTarget | null>(null);
  const deleteWhenFinished = useRef(listening.deleteWhenFinished);
  deleteWhenFinished.current = listening.deleteWhenFinished;

  useEffect(() => {
    if (!controller) return;
    const target = (): FinishedTarget | null => {
      const voice = controller.activeLibraryVoice;
      const identity = identityOf(bookKey);
      const book = useBookDataStore.getState().getBookData(bookKey)?.book;
      if (!voice || !identity || !book) return null;
      return { ...identity, voiceKey: voice.info.key, book };
    };
    // Heard to 98%: finished. Listening again from earlier takes it back.
    const onMark = () => {
      const share = controller.libraryPlayedShare();
      if (share === null) return;
      finished.current = isFinished({ endedAtLastSection: false, share }) ? target() : null;
    };
    const onEnded = (event: Event) => {
      const { reason } = (event as CustomEvent<{ reason: string }>).detail;
      if (reason === 'ended' && controller.activeLibraryVoice) {
        finished.current = target() ?? finished.current;
      }
    };
    controller.addEventListener('tts-highlight-mark', onMark);
    controller.addEventListener('tts-session-ended', onEnded);
    return () => {
      controller.removeEventListener('tts-highlight-mark', onMark);
      controller.removeEventListener('tts-session-ended', onEnded);
    };
  }, [bookKey, controller]);

  // The reader leaves the book (not while the listener is on the last page).
  useEffect(
    () => () => {
      const done = finished.current;
      finished.current = null;
      if (!done || !appService) return;
      const library = useLibraryStore.getState().library;
      const book = library.find((b) => b.hash === done.book.hash) ?? done.book;
      void cleanUpFinished(
        { ...done, book },
        {
          deleteWhenFinished: deleteWhenFinished.current,
          deleteBook: (b, action) => appService.deleteBook(b, action),
          removeVoice: removeVoiceOffline,
        },
      )
        .then(async (removed) => {
          if (!removed) return;
          const { library: current, setLibrary } = useLibraryStore.getState();
          setLibrary([...current]);
          await appService.saveLibraryBooks(current);
        })
        .catch((error) => console.warn('Delete when finished failed', error));
    },
    [appService],
  );
};
