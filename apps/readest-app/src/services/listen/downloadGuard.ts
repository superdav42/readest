// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// When an explicit download of a voice asks first. Play never asks: on Wi-Fi it downloads by
// design and otherwise it only streams.
import type { SystemSettings } from '@/types/settings';
import type { LibraryVoiceInfo } from '@/services/tts/libraryVoice';
import type { ConnectionKind } from './connection';

export type ListeningSettings = NonNullable<SystemSettings['listening']>;

export const DEFAULT_GUARD_MEGABYTES = 100;
const BITS_PER_SECOND = 64_000;

export const readListeningSettings = (
  stored: SystemSettings['listening'],
): Required<ListeningSettings> => ({
  guardDownloads: stored?.guardDownloads ?? true,
  guardMegabytes: stored?.guardMegabytes ?? DEFAULT_GUARD_MEGABYTES,
  deleteWhenFinished: stored?.deleteWhenFinished ?? true,
});

/** Size of the built tracks: audio seconds at 64 kbps. */
export const estimateVoiceBytes = (info: LibraryVoiceInfo): number =>
  info.tracks
    .filter((track) => track.ready !== false)
    .reduce((sum, track) => sum + (track.seconds * BITS_PER_SECOND) / 8, 0);

export const shouldAskBeforeDownload = (
  settings: Required<ListeningSettings>,
  connection: ConnectionKind,
  bytes: number,
): boolean =>
  settings.guardDownloads &&
  (connection !== 'unmetered' || bytes > settings.guardMegabytes * 1024 * 1024);
