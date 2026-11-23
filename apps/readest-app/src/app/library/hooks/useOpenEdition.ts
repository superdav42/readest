// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Download (or reuse) a catalog edition and open it in the reader, with the "Opening…" progress
// and error toast. Shared by Discover and the book page.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { openCatalogBook, preferTextEdition } from '@/services/openCatalogBook';
import { type DiscoverCard, setPreviewBook } from '@/services/gutenbergLibrary';

/** Give up on opening a book when its download or import has not advanced for this long. */
const OPEN_STALL_MS = 3 * 60_000;

export interface OpeningState {
  title: string;
  cover: string;
  progress: number;
  /** Set while waiting for a requested translation's preview: what the wait is on. */
  waiting?: string;
  /** The untranslated edition, offered while waiting. */
  original?: { work_id: number; lang: string; url: string; size?: number | null };
}

export interface OpenableEdition {
  work_id: number;
  lang: string;
  url: string;
  size?: number | null;
  hash?: string;
  kind?: DiscoverCard['kind'];
}

export const useOpenEdition = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { appService } = useEnv();
  const [opening, setOpening] = useState<OpeningState | null>(null);
  // Which open the overlay belongs to: cancelling (or a stall) invalidates it, so a late
  // download or import never navigates away from where the reader went back to.
  const openAttempt = useRef(0);

  /** Download (or reuse) an edition and open it. */
  const openEdition = useCallback(
    async (
      edition: OpenableEdition,
      display: { title: string; cover: string },
      options: { preview?: boolean; attempt?: number; keepNarration?: boolean } = {},
    ) => {
      if (!appService || (options.attempt === undefined && opening)) return;
      const attempt = options.attempt ?? ++openAttempt.current;
      const current = () => openAttempt.current === attempt;
      setOpening({ ...display, progress: 0 });
      try {
        // A read-along opens as its text-only edition (unless the listener asked to listen
        // or already has the narration here); the narration is offered in the reader.
        const target = options.keepNarration
          ? edition
          : await preferTextEdition(appService, edition);
        if (!current()) return;
        const book = await openCatalogBook(appService, target, (progress) => {
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

  // A download or import that makes no progress for this long is given up on, so the full-screen
  // overlay can never trap the reader (it used to stay on screen until the app was restarted).
  // Waiting for a translation to be prepared can take longer and has its own limit.
  const isDownloading = opening !== null && !opening.waiting;
  const openingProgress = opening?.progress;
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

  return { opening, setOpening, openAttempt, openEdition, cancelOpening };
};
