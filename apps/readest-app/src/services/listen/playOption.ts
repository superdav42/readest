// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Play one way of listening to a book (a LibriVox recording or the AI narration): open the
// text, choose that voice and start playing when the reader opens.
import type { AppService } from '@/types/system';
import type { useAppRouter } from '@/hooks/useAppRouter';
import { fetchWork, fetchWorkVoices, type ListenOptions } from '@/services/gutenbergLibrary';
import { openCatalogBook, preferTextEdition } from '@/services/openCatalogBook';
import { setChosenLibraryVoice } from '@/services/tts/libraryVoice';
import { startVoiceDownload, voiceOfflineSupported } from '@/services/tts/voiceOffline';
import { connectionKind } from './connection';
import { navigateToReader } from '@/utils/nav';
import { setPendingTTSAutoplay } from '@/utils/ttsAutoplay';

export interface PlayContext {
  appService: AppService;
  router: ReturnType<typeof useAppRouter>;
  workId: number;
  lang: string;
  /** The voices text edition; null when no voice is built yet. */
  text: ListenOptions['text'];
  onProgress?: (fraction: number) => void;
}

/** What is played: the key of the voice to choose. */
export interface PlayOption {
  key: string;
}

export const playListenOption = async (ctx: PlayContext, option: PlayOption): Promise<void> => {
  const { appService, router, workId, lang, text, onProgress } = ctx;
  let edition: Parameters<typeof openCatalogBook>[1];
  if (text) {
    edition = { work_id: workId, lang, url: text.url, hash: text.hash, kind: 'readalong' };
  } else {
    // Nothing built yet: the normal best edition, as Discover opens it. The cold-start flows
    // (VoiceBanner, NarrationBanner) take over when Speak runs.
    const best = (await fetchWork(workId, lang)).best;
    if (!best) throw new Error('no_edition');
    edition = await preferTextEdition(appService, {
      work_id: workId,
      lang: best.lang,
      url: best.url,
      hash: best.hash,
      kind: best.kind,
    });
  }
  const book = await openCatalogBook(appService, edition, onProgress);
  if (text) setChosenLibraryVoice(workId, lang, option.key);
  setPendingTTSAutoplay(book.hash);
  navigateToReader(router, [book.hash]);
  // Streaming starts at once; on an unmetered connection the voice is also saved while it plays.
  // Cellular or unknown: stream only. Never awaited, so playback is never blocked by it.
  if (text && connectionKind() === 'unmetered') {
    void downloadWhilePlaying(workId, lang, option.key);
  }
};

const downloadWhilePlaying = async (workId: number, lang: string, key: string): Promise<void> => {
  try {
    if (!voiceOfflineSupported()) return;
    const listing = await fetchWorkVoices(workId, lang);
    const info = listing?.voices.find((voice) => voice.key === key);
    if (listing && info) await startVoiceDownload(listing, info, 0);
  } catch (error) {
    console.warn('Play: could not save the voice while playing', error);
  }
};
