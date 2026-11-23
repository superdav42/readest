// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-22 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// What the Read Aloud sheet says about playing the narration with no connection, and the one
// action that makes it possible:
//   voice    a library voice (LibriVox, AI, dramatized) is playing: its tracks and sync map are
//            stored on this device (voiceOffline)
//   edition  the open book is an AI read-along edition: its audio is inside the book file, so it
//            is saved when the book file is on this device; a streamed copy is downloaded
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useListeningSettings } from '@/hooks/useListeningSettings';
import { connectionKind, type ConnectionKind } from '@/services/listen/connection';
import { estimateVoiceBytes, shouldAskBeforeDownload } from '@/services/listen/downloadGuard';
import { useBookDataStore } from '@/store/bookDataStore';
import { fetchWorkVoices } from '@/services/gutenbergLibrary';
import { hasMediaOverlays } from '@/services/tts/mediaOverlay/narratedSections';
import type { LibraryVoiceInfo, LibraryVoices } from '@/services/tts/libraryVoice';
import type { TTSController } from '@/services/tts/TTSController';
import {
  isOffline,
  removeVoiceOffline,
  saveVoiceOffline,
  voiceOfflineStatus,
  voiceOfflineSupported,
  type VoiceOfflineState,
} from '@/services/tts/voiceOffline';
import type { Book } from '@/types/book';
import { identityOf } from './useVoiceOnDemand';

export type OfflineKind = 'voice' | 'edition';

/** The guard is asking: the size (0 when unknown) and the connection the download would use. */
export interface DownloadPrompt {
  bytes: number;
  connection: ConnectionKind;
}

export interface OfflineNarration {
  kind: OfflineKind | null;
  state: VoiceOfflineState;
  saved: number;
  total: number;
  /** Tracks the catalog has built so far (a voice made as people listen is not complete). */
  built: number;
  busy: boolean;
  /** 0..1 while saving. */
  progress: number;
  failed: boolean;
  offline: boolean;
  /** Starts the download, or sets `prompt` when the guard asks first. */
  save: () => void;
  prompt: DownloadPrompt | null;
  confirmSave: () => void;
  cancelSave: () => void;
  /** Only a saved library voice can be removed here; books are removed from the library. */
  remove?: () => void;
}

type Target =
  | { kind: 'voice'; workId: number; lang: string; info: LibraryVoiceInfo; listing: LibraryVoices }
  | { kind: 'edition'; book: Book };

const IDLE = { state: 'none' as VoiceOfflineState, saved: 0, total: 0, built: 0 };

export const useOfflineNarration = (
  bookKey: string,
  getController: () => TTSController | null,
  enabled: boolean,
): OfflineNarration => {
  const { appService } = useEnv();
  const bookData = useBookDataStore((s) => s.getBookData(bookKey));
  const target = useRef<Target | null>(null);
  const [kind, setKind] = useState<OfflineKind | null>(null);
  const [status, setStatus] = useState(IDLE);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [offline, setOffline] = useState(isOffline());
  const [prompt, setPrompt] = useState<DownloadPrompt | null>(null);
  const { listening } = useListeningSettings();

  useEffect(() => {
    const update = () => setOffline(isOffline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const book = bookData?.book;
  const localCopy = useCallback(
    async (candidate: Book | undefined) =>
      !!candidate && !!appService && (await appService.getBookFileSize(candidate)) !== null,
    [appService],
  );

  const refresh = useCallback(async () => {
    const found = await resolveTarget();
    target.current = found;
    setKind(found?.kind ?? null);
    if (!found) return;
    if (found.kind === 'voice') {
      const next = await voiceOfflineStatus(found.workId, found.lang, found.info);
      setStatus({ state: next.state, saved: next.saved, total: next.total, built: next.built });
    } else {
      setStatus({ ...IDLE, state: (await localCopy(found.book)) ? 'saved' : 'none' });
    }

    async function resolveTarget(): Promise<Target | null> {
      if (!enabled || !book) return null;
      const identity = identityOf(bookKey);
      const voice = getController()?.activeLibraryVoice;
      if (voice && identity && voiceOfflineSupported()) {
        const listing = (await fetchWorkVoices(identity.workId, identity.lang)) ?? {
          work_id: identity.workId,
          lang: identity.lang,
          text: { hash: book.hash, url: '' },
          voices: [voice.info],
        };
        return { kind: 'voice', ...identity, info: voice.info, listing };
      }
      return hasMediaOverlays(bookData?.bookDoc) ? { kind: 'edition', book } : null;
    }
  }, [bookKey, book, bookData?.bookDoc, enabled, getController, localCopy]);

  useEffect(() => {
    const update = () => void refresh().catch(() => setKind(null));
    update();
    // Another voice (or the book's own narration) was picked in the sheet.
    const controller = enabled ? getController() : null;
    controller?.addEventListener('library-voice-change', update);
    return () => controller?.removeEventListener('library-voice-change', update);
  }, [refresh, enabled, getController]);

  const saving = useRef<AbortController | null>(null);
  useEffect(() => () => saving.current?.abort(), []);

  const start = useCallback(() => {
    const found = target.current;
    if (!found || !appService || busy) return;
    const controller = new AbortController();
    saving.current = controller;
    setBusy(true);
    setFailed(false);
    setProgress(0);
    const run = async () => {
      if (found.kind === 'voice') {
        await saveVoiceOffline(found.listing, found.info, setProgress, controller.signal);
      } else {
        await appService.downloadBook(found.book);
      }
    };
    run()
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('Offline narration: could not save', error);
          setFailed(true);
        }
      })
      .finally(async () => {
        setBusy(false);
        await refresh().catch(() => undefined);
      });
  }, [appService, busy, refresh]);

  // An explicit download asks first on cellular/unknown or above the size (unless turned off).
  const save = useCallback(() => {
    const found = target.current;
    if (!found || busy) return;
    const bytes = found.kind === 'voice' ? estimateVoiceBytes(found.info) : 0;
    const connection = connectionKind();
    if (shouldAskBeforeDownload(listening, connection, bytes)) setPrompt({ bytes, connection });
    else start();
  }, [busy, listening, start]);

  const confirmSave = useCallback(() => {
    setPrompt(null);
    start();
  }, [start]);

  const cancelSave = useCallback(() => setPrompt(null), []);

  const remove = useCallback(() => {
    const found = target.current;
    if (found?.kind !== 'voice') return;
    void removeVoiceOffline(found.workId, found.lang, found.info.key).then(refresh);
  }, [refresh]);

  return {
    kind,
    ...status,
    busy,
    progress,
    failed,
    offline,
    save,
    prompt,
    confirmSave,
    cancelSave,
    remove: kind === 'voice' && status.state !== 'none' ? remove : undefined,
  };
};
