// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-22 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Library read-along voices (LibriVox, AI, dramatized) are streamed audio tracks plus a sync
// map. This saves a voice on the device so it plays with no connection: the sync map and every
// built track are stored, the voice list of the work is remembered, and the player reads the
// saved copy first.
//
//   web    Cache Storage (one entry per URL; tracks play from an object URL)
//   apps   files under the app data directory (native downloader; the native player plays the
//          path, desktop plays it through the loopback media server)
//
// The manifest (what was saved, and the voice listing to show with no connection) is kept in
// localStorage; every status is checked against the files, so evicted or deleted storage shows
// as not saved instead of being trusted.
import { getInitializedAppService, isTauriAppPlatform } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { LibraryVoiceInfo, LibraryVoices } from './libraryVoice';

const CACHE_NAME = 'librebooks-voice-offline-v1';
const MANIFEST_KEY = 'librebooks-voice-offline';
const DIR = 'voice-offline';

export interface SavedVoice {
  workId: number;
  lang: string;
  key: string;
  savedAt: number;
  /** The listing as it was saved: the text edition and this one voice. */
  listing: LibraryVoices;
  /** URLs of the files stored for it: the sync map and the built tracks. */
  files: string[];
  bytes: number;
}

type Manifest = Record<string, SavedVoice>;

export type VoiceOfflineState = 'none' | 'partial' | 'saved';

export interface VoiceOfflineStatus {
  state: VoiceOfflineState;
  /** Tracks stored on this device. */
  saved: number;
  /** Tracks of the whole recording. */
  total: number;
  /** Tracks the catalog has built so far (a voice made as people listen is not complete). */
  built: number;
  bytes: number;
}

interface FileStore {
  has(url: string): Promise<boolean>;
  /** Download url into the store; resolves with the bytes stored. */
  save(url: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<number>;
  text(url: string): Promise<string | null>;
  /** A URL or path the player can read the stored file from, or null. */
  playable(url: string): Promise<string | null>;
  remove(url: string): Promise<void>;
}

const contentTypeOf = (url: string): string =>
  url.endsWith('.json') ? 'application/json' : url.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';

// ---- web: Cache Storage -------------------------------------------------------------------

const objectUrls = new Map<string, string>();
const MAX_OBJECT_URLS = 4;

const webStore: FileStore = {
  async has(url) {
    return !!(await (await caches.open(CACHE_NAME)).match(url));
  },
  async save(url, onProgress, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`voice_offline_${res.status}`);
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
    const blob = new Blob(chunks as BlobPart[], { type: contentTypeOf(url) });
    await (await caches.open(CACHE_NAME)).put(
      url,
      new Response(blob, { headers: { 'Content-Type': contentTypeOf(url) } }),
    );
    onProgress(1);
    return blob.size;
  },
  async text(url) {
    const res = await (await caches.open(CACHE_NAME)).match(url);
    return res ? await res.text() : null;
  },
  async playable(url) {
    const known = objectUrls.get(url);
    if (known) return known;
    const res = await (await caches.open(CACHE_NAME)).match(url);
    if (!res) return null;
    const objectUrl = URL.createObjectURL(await res.blob());
    objectUrls.set(url, objectUrl);
    while (objectUrls.size > MAX_OBJECT_URLS) {
      const [oldest, oldUrl] = objectUrls.entries().next().value as [string, string];
      objectUrls.delete(oldest);
      URL.revokeObjectURL(oldUrl);
    }
    return objectUrl;
  },
  async remove(url) {
    const known = objectUrls.get(url);
    if (known) {
      URL.revokeObjectURL(known);
      objectUrls.delete(url);
    }
    await (await caches.open(CACHE_NAME)).delete(url);
  },
};

// ---- apps: files in the app data directory ----------------------------------------------

/** .../voices/1727/en/librivox-20840-e74ed667/tracks/00.mp3 -> voice-offline/1727__en__...__00.mp3 */
const relativePath = (url: string): string => {
  const path = new URL(url).pathname.replace(/^\/+/, '').replace(/^.*?voices\//, '');
  return `${DIR}/${path.replace(/[^A-Za-z0-9._-]+/g, '__')}`;
};

const appService = (): AppService => {
  const service = getInitializedAppService();
  if (!service) throw new Error('voice_offline_no_app_service');
  return service;
};

const fileStore: FileStore = {
  async has(url) {
    return await appService().exists(relativePath(url), 'Data');
  },
  async save(url, onProgress) {
    const app = appService();
    await app.createDir(DIR, 'Data', true);
    const rel = relativePath(url);
    const { downloadFile } = await import('@/libs/storage');
    await downloadFile({
      appService: app,
      dst: await app.resolveFilePath(rel, 'Data'),
      cfp: '',
      url,
      onProgress: ({ progress, total }) => total > 0 && onProgress(progress / total),
    });
    const file = await app.openFile(rel, 'Data');
    return file.size;
  },
  async text(url) {
    const app = appService();
    const rel = relativePath(url);
    return (await app.exists(rel, 'Data')) ? await (await app.openFile(rel, 'Data')).text() : null;
  },
  async playable(url) {
    const app = appService();
    const rel = relativePath(url);
    if (!(await app.exists(rel, 'Data'))) return null;
    const path = await app.resolveFilePath(rel, 'Data');
    // The native players (Android, iOS) play a path; the desktop <audio> needs a URL it can seek.
    if (app.isAndroidApp || app.isIOSApp) return path;
    const { getLocalMediaUrl } = await import('@/services/audiobook/mediaProxy');
    return (await getLocalMediaUrl(path, contentTypeOf(url))) ?? path;
  },
  async remove(url) {
    const app = appService();
    const rel = relativePath(url);
    if (await app.exists(rel, 'Data')) await app.deleteFile(rel, 'Data');
  },
};

const store = (): FileStore => (isTauriAppPlatform() ? fileStore : webStore);

export const voiceOfflineSupported = (): boolean =>
  isTauriAppPlatform() || (typeof caches !== 'undefined' && typeof localStorage !== 'undefined');

export const isOffline = (): boolean =>
  typeof navigator !== 'undefined' && navigator.onLine === false;

// ---- manifest ---------------------------------------------------------------------------

const manifestKey = (workId: number, lang: string, key: string): string =>
  `${workId}:${lang}:${key}`;

const readManifest = (): Manifest => {
  try {
    return JSON.parse(localStorage.getItem(MANIFEST_KEY) || '{}') as Manifest;
  } catch {
    return {};
  }
};

const writeManifest = (manifest: Manifest): void => {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  } catch (error) {
    console.warn('Voice offline: could not write the manifest', error);
  }
};

export const getSavedVoice = (workId: number, lang: string, key: string): SavedVoice | null =>
  readManifest()[manifestKey(workId, lang, key)] ?? null;

const builtTracks = (info: LibraryVoiceInfo) =>
  info.tracks.filter((track) => track.ready !== false);

/** What is stored on this device of a voice, checked against the files. */
export const voiceOfflineStatus = async (
  workId: number,
  lang: string,
  info: LibraryVoiceInfo,
): Promise<VoiceOfflineStatus> => {
  const none: VoiceOfflineStatus = {
    state: 'none',
    saved: 0,
    total: info.tracks.length,
    built: builtTracks(info).length,
    bytes: 0,
  };
  const entry = getSavedVoice(workId, lang, info.key);
  if (!entry || !voiceOfflineSupported()) return none;
  const files = new Set(entry.files);
  let saved = 0;
  try {
    for (const track of builtTracks(info)) {
      if (files.has(track.href) && (await store().has(track.href))) saved += 1;
    }
    const synced = files.has(info.sync_url) && (await store().has(info.sync_url));
    const state: VoiceOfflineState =
      !synced || saved === 0 ? 'none' : saved === info.tracks.length ? 'saved' : 'partial';
    return { ...none, state, saved, bytes: entry.bytes };
  } catch {
    return none;
  }
};

/** Ask the browser to keep this origin's storage when space runs low (best effort). */
const requestPersistence = async (): Promise<void> => {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not available: the saved copy may be evicted, which the status then shows.
  }
};

/** Tracks from the one being heard to the end, then the earlier ones. */
export const downloadOrder = <T>(tracks: T[], startTrack: number): T[] => {
  const start = Math.min(Math.max(Math.trunc(startTrack) || 0, 0), tracks.length);
  return [...tracks.slice(start), ...tracks.slice(0, start)];
};

/**
 * Store a voice: its sync map and every track the catalog has built, starting at startTrack and
 * wrapping to the earlier ones. Tracks already stored are
 * kept, so saving again after more tracks were built (or after an update) adds what is new, and
 * files of an older build are removed. Progress is reported in audio seconds, 0..1.
 */
export const saveVoiceOffline = async (
  listing: LibraryVoices,
  info: LibraryVoiceInfo,
  onProgress: (fraction: number, savedTracks: number) => void = () => undefined,
  signal?: AbortSignal,
  startTrack = 0,
): Promise<VoiceOfflineStatus> => {
  if (!voiceOfflineSupported()) throw new Error('voice_offline_unsupported');
  await requestPersistence();
  const id = manifestKey(listing.work_id, listing.lang, info.key);
  const previous = readManifest()[id];
  const built = downloadOrder(info.tracks, startTrack).filter((track) => track.ready !== false);
  const wanted = new Set([info.sync_url, ...built.map((track) => track.href)]);
  const before = new Set(previous?.files ?? []);
  const kept = new Set<string>();
  const totalSeconds = built.reduce((sum, track) => sum + track.seconds, 0) || 1;
  const files = store();
  let doneSeconds = 0;
  let savedTracks = 0;
  let bytes = previous?.bytes ?? 0;

  const remember = () => {
    const manifest = readManifest();
    manifest[id] = {
      workId: listing.work_id,
      lang: listing.lang,
      key: info.key,
      savedAt: Date.now(),
      listing: { ...listing, voices: [info] },
      files: [...kept],
      bytes,
    };
    writeManifest(manifest);
  };

  if (before.has(info.sync_url) && (await files.has(info.sync_url))) {
    kept.add(info.sync_url);
  } else {
    bytes += await files.save(info.sync_url, () => undefined, signal);
    kept.add(info.sync_url);
  }
  remember();

  for (const track of built) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (before.has(track.href) && (await files.has(track.href))) {
      kept.add(track.href);
    } else {
      bytes += await files.save(
        track.href,
        (fraction) =>
          onProgress((doneSeconds + fraction * track.seconds) / totalSeconds, savedTracks),
        signal,
      );
      kept.add(track.href);
      // After every track, so an interrupted save resumes where it stopped.
      remember();
    }
    savedTracks += 1;
    doneSeconds += track.seconds;
    onProgress(doneSeconds / totalSeconds, savedTracks);
  }

  // Files of an older build of this voice are no longer referenced.
  for (const url of before) {
    if (!wanted.has(url)) await files.remove(url).catch(() => undefined);
  }
  return await voiceOfflineStatus(listing.work_id, listing.lang, info);
};

// ---- background download (Play on an unmetered connection) -------------------------------

interface ActiveDownload {
  listing: LibraryVoices;
  info: LibraryVoiceInfo;
  /** A newer build arrived while this one was running. */
  dirty: boolean;
  promise: Promise<void>;
}

const activeDownloads = new Map<string, ActiveDownload>();

/**
 * Save a voice beside playback, from startTrack on. One download runs per voice: a second call
 * while it runs returns the running one. It is not tied to the reader, so closing the book does
 * not stop it.
 */
export const startVoiceDownload = (
  listing: LibraryVoices,
  info: LibraryVoiceInfo,
  startTrack = 0,
): Promise<void> => {
  const id = manifestKey(listing.work_id, listing.lang, info.key);
  const running = activeDownloads.get(id);
  if (running) return running.promise;
  const entry: ActiveDownload = { listing, info, dirty: false, promise: Promise.resolve() };
  activeDownloads.set(id, entry);
  entry.promise = (async () => {
    try {
      do {
        entry.dirty = false;
        await saveVoiceOffline(entry.listing, entry.info, undefined, undefined, startTrack);
      } while (entry.dirty);
    } catch (error) {
      console.warn('Voice offline: the background download stopped', error);
    } finally {
      activeDownloads.delete(id);
    }
  })();
  return entry.promise;
};

/** A voice that grew: add its new tracks to a download that is running. */
export const topUpVoiceDownload = (
  workId: number,
  lang: string,
  info: LibraryVoiceInfo,
): boolean => {
  const entry = activeDownloads.get(manifestKey(workId, lang, info.key));
  if (!entry) return false;
  entry.info = info;
  entry.dirty = true;
  return true;
};

/** Delete a saved voice from the device. */
export const removeVoiceOffline = async (
  workId: number,
  lang: string,
  key: string,
): Promise<void> => {
  const manifest = readManifest();
  const id = manifestKey(workId, lang, key);
  const entry = manifest[id];
  if (!entry) return;
  for (const url of entry.files)
    await store()
      .remove(url)
      .catch(() => undefined);
  delete manifest[id];
  writeManifest(manifest);
};

/**
 * The voices saved for a work and language, as a listing: what the reader shows with no
 * connection (or when the catalog cannot be reached). The saved voice that was the default stays
 * the default; otherwise the first saved voice is.
 */
export const savedVoicesListing = async (
  workId: number,
  lang: string,
): Promise<LibraryVoices | null> => {
  if (!voiceOfflineSupported()) return null;
  const entries = Object.values(readManifest()).filter(
    (entry) => entry.workId === workId && entry.lang === lang,
  );
  const voices: LibraryVoiceInfo[] = [];
  let first: SavedVoice | null = null;
  for (const entry of entries) {
    const info = entry.listing.voices[0];
    if (!info) continue;
    if ((await voiceOfflineStatus(workId, lang, info)).state === 'none') continue;
    first ??= entry;
    voices.push(info);
  }
  if (!first || !voices.length) return null;
  const hasDefault = voices.some((voice) => voice.default);
  return {
    ...first.listing,
    voices: voices.map((voice, index) => ({
      ...voice,
      default: hasDefault ? voice.default : index === 0,
    })),
  };
};

const isSaved = (url: string): boolean =>
  Object.values(readManifest()).some((entry) => entry.files.includes(url));

/** The saved text of a URL (a sync map), or null when it is not stored. */
export const savedText = async (url: string): Promise<string | null> => {
  if (!voiceOfflineSupported() || !isSaved(url)) return null;
  try {
    return await store().text(url);
  } catch {
    return null;
  }
};

/** Where the player reads a track from when it is saved on this device; null to stream it. */
export const savedTrackSource = async (url: string): Promise<string | null> => {
  if (!voiceOfflineSupported() || !isSaved(url)) return null;
  try {
    return await store().playable(url);
  } catch {
    return null;
  }
};
