// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-31 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Bring a catalog edition (an EPUB on the library CDN) into the library so it can be read:
// reuse the copy already there, else download and import it.
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { downloadFile } from '@/libs/storage';
import { isTauriAppPlatform } from '@/services/environment';
import { findLibraryEdition, type DiscoverCard } from '@/services/gutenbergLibrary';
import { useLibraryStore } from '@/store/libraryStore';

/** Web only: books larger than this open while they download; smaller ones download first. */
const STREAM_MIN_BYTES = 3 * 1024 * 1024;

type Edition = Pick<DiscoverCard, 'work_id' | 'lang' | 'url'> & {
  size?: number | null;
  /** Reuse only this exact file (a newer narration edition replaces an older one). */
  hash?: string;
  /** Read-along editions are never streamed: narration reads whole audio files out of the
   * EPUB, which over range requests took ~25 s to start; the CDN sends the file in seconds. */
  kind?: DiscoverCard['kind'];
};

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

export const openCatalogBook = async (
  appService: AppService,
  edition: Edition,
  onProgress: (fraction: number) => void = () => undefined,
): Promise<Book> => {
  const existing = findLibraryEdition(useLibraryStore.getState().library, edition);
  if (existing) return existing;
  const { library, setLibrary } = useLibraryStore.getState();
  let book: Book | null = null;
  let streaming = false;
  if (isTauriAppPlatform()) {
    // Apps: the native downloader saves the file at full speed and the native EPUB
    // parser opens it from disk. Streaming would send every small range read through
    // the HTTP bridge (11 s for a 290 KB book on Android).
    const path = await appService.resolveFilePath(
      `catalog-${edition.work_id}-${edition.lang}.epub`,
      'Cache',
    );
    await downloadFile({
      appService,
      dst: path,
      cfp: '',
      url: edition.url,
      onProgress: ({ progress, total }) => total > 0 && onProgress(progress / total),
    });
    book = await appService.importBook(path, library);
    await appService.deleteFile(path, 'None').catch(() => undefined);
  } else if ((edition.size ?? 0) > STREAM_MIN_BYTES && edition.kind !== 'readalong') {
    // Web, large books: read while it downloads. Importing from the URL without copying
    // lets the reader fetch only the parts it shows (range requests); the whole book
    // then downloads in the background.
    book = await appService.importBook(edition.url, library, { saveBook: false }).catch(() => null);
    streaming = !!book;
  }
  if (!book) {
    // Small books on the web (most are under 1 MB), or a host without range support.
    book = await appService.importBook(await downloadEpub(edition.url, onProgress), library);
  }
  if (!book) throw new Error('import_failed');
  setLibrary([...library]);
  await appService.saveLibraryBooks(library);
  if (streaming) {
    const downloaded = book;
    appService
      .downloadBook(downloaded)
      .then(async () => {
        const current = useLibraryStore.getState().library;
        useLibraryStore.getState().setLibrary([...current]);
        await appService.saveLibraryBooks(current);
      })
      .catch((error) => console.warn('Background download failed', error));
  }
  return book;
};
