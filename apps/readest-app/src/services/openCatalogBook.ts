// SPDX-License-Identifier: AGPL-3.0-only
// Modified 2026-11-04, 2026-11-14 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
// Added 2026-10-31 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Bring a catalog edition (an EPUB on the library CDN) into the library so it can be read:
// reuse the copy already there, else download and import it.
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { downloadFile } from '@/libs/storage';
import { isTauriAppPlatform } from '@/services/environment';
import {
  fetchTextEdition,
  findLibraryEdition,
  getSharedBookUrl,
  type DiscoverCard,
} from '@/services/gutenbergLibrary';
import { useLibraryStore } from '@/store/libraryStore';
import { getLocalBookFilename } from '@/utils/book';
import { configureZip } from '@/utils/zip';

/** Web only: books larger than this open while they download; smaller ones download first. */
const STREAM_MIN_BYTES = 3 * 1024 * 1024;

type Edition = Pick<DiscoverCard, 'work_id' | 'lang' | 'url'> & {
  size?: number | null;
  /** Reuse only this exact file (a newer narration edition replaces an older one). */
  hash?: string;
  /** Read-along editions stream too: narration waits for the background download and reads
   * its audio from the downloaded copy (readStreamedBookEntry), not over range requests. */
  kind?: DiscoverCard['kind'];
};

type ZipEntry = import('@zip.js/zip.js').Entry;

/** Books opened by streaming since the page loaded, by hash, with their background download. */
const streamedDownloads = new Map<string, Promise<void>>();
/** The most recently read downloaded copy's zip entries (one book is narrated at a time). */
let downloadedCopy: { hash: string; entries: Promise<ZipEntry[] | null> } | null = null;

/** True for a book opened by streaming since the page loaded (its download may be done). */
export const isStreamedBook = (hash: string): boolean => streamedDownloads.has(hash);

const openDownloadedCopy = async (appService: AppService, hash: string) => {
  const book = useLibraryStore.getState().library.find((b) => b.hash === hash && !b.deletedAt);
  if (!book) return null;
  const file = await appService.openFile(getLocalBookFilename(book), 'Books');
  await configureZip();
  const { ZipReader, BlobReader } = await import('@zip.js/zip.js');
  return await new ZipReader(new BlobReader(file)).getEntries();
};

/**
 * Read one file (an audio clip) out of a streamed book's downloaded copy, waiting for the
 * background download first. Reading it through the open book instead means range requests
 * for whole audio files (about 25 s before narration started). Null when the book was not
 * streamed here or the download failed: the caller then reads from the open book.
 */
export const readStreamedBookEntry = async (
  appService: AppService,
  hash: string,
  href: string,
  type: string,
): Promise<Blob | null> => {
  const download = streamedDownloads.get(hash);
  if (!download) return null;
  try {
    await download;
    const copy =
      downloadedCopy?.hash === hash
        ? downloadedCopy
        : { hash, entries: openDownloadedCopy(appService, hash).catch(() => null) };
    downloadedCopy = copy;
    const entries = await copy.entries;
    const entry = entries?.find((e) => e.filename === href);
    if (!entry || entry.directory) {
      if (!entries) downloadedCopy = null;
      return null;
    }
    const { BlobWriter } = await import('@zip.js/zip.js');
    return await entry.getData(new BlobWriter(type));
  } catch (error) {
    console.warn('Narration: could not read the downloaded copy', error);
    return null;
  }
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

/**
 * Open the text first. A read-along edition carries every audio clip (up to hundreds of MB),
 * and importing one freezes a slow phone for many seconds. For a read-along edition this
 * device does not hold yet, return the text-only edition of the same work and language (its
 * translation or original, a fraction of the size): the reader shows it at once and offers the
 * narration, which is then fetched on request (NarrationBanner). Any other edition, one the
 * device already has, or a failed lookup returns the edition unchanged.
 */
export const preferTextEdition = async (
  appService: AppService,
  edition: Edition,
): Promise<Edition> => {
  if (edition.kind !== 'readalong') return edition;
  const local = findLibraryEdition(useLibraryStore.getState().library, {
    work_id: edition.work_id,
    lang: edition.lang,
  });
  if (local && (await appService.isBookAvailable(local))) return edition;
  const text = await fetchTextEdition(edition.work_id, edition.lang);
  if (!text) return edition;
  return {
    work_id: text.work_id,
    lang: text.lang,
    url: text.url,
    size: text.size,
    kind: text.kind,
  };
};

export const openCatalogBook = async (
  appService: AppService,
  edition: Edition,
  onProgress: (fraction: number) => void = () => undefined,
): Promise<Book> => {
  const existing = findLibraryEdition(useLibraryStore.getState().library, edition);
  // Catalog metadata can seed a shelf row before its EPUB exists on this device. Reuse only
  // a readable local or streaming source; importing below fills that row with the real file.
  if (existing && (await appService.isBookAvailable(existing))) return existing;
  // A deleted copy comes back at its own content hash, so its notes and place still belong to it.
  const sourceUrl = (existing && getSharedBookUrl(existing)) || edition.url;
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
      url: sourceUrl,
      onProgress: ({ progress, total }) => total > 0 && onProgress(progress / total),
    });
    book = await appService.importBook(path, library);
    await appService.deleteFile(path, 'None').catch(() => undefined);
  } else if ((edition.size ?? 0) > STREAM_MIN_BYTES) {
    // Web, large books: read while it downloads. Importing from the URL without copying
    // lets the reader fetch only the parts it shows (range requests); the whole book
    // then downloads in the background.
    book = await appService.importBook(sourceUrl, library, { saveBook: false }).catch(() => null);
    streaming = !!book;
  }
  if (!book) {
    // Small books on the web (most are under 1 MB), or a host without range support.
    book = await appService.importBook(await downloadEpub(sourceUrl, onProgress), library);
  }
  if (!book) throw new Error('import_failed');
  setLibrary([...library]);
  await appService.saveLibraryBooks(library);
  if (streaming) {
    const downloaded = book;
    // Never rejects: narration waits on it and falls back to the open book if it failed.
    const download = appService
      .downloadBook(downloaded)
      .then(async () => {
        const current = useLibraryStore.getState().library;
        useLibraryStore.getState().setLibrary([...current]);
        await appService.saveLibraryBooks(current);
      })
      .catch((error) => console.warn('Background download failed', error));
    streamedDownloads.set(downloaded.hash, download);
  }
  return book;
};
