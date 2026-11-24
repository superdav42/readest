// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Plays the short sample clip of a listen option (book page). One shared audio element:
// starting a sample stops the one playing.
let audio: HTMLAudioElement | null = null;
let playingUrl: string | null = null;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/** The sample url playing now, or null. */
export const getPlayingSample = (): string | null => playingUrl;

export const subscribeSample = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const stopSample = (): void => {
  if (audio) audio.pause();
  if (playingUrl !== null) {
    playingUrl = null;
    notify();
  }
};

/** Start the sample at `url` (stopping any other); the same url again pauses it. */
export const toggleSample = async (url: string): Promise<void> => {
  if (playingUrl === url) {
    stopSample();
    return;
  }
  audio ??= new Audio();
  audio.pause();
  const end = () => {
    if (playingUrl === url) stopSample();
  };
  audio.onended = end;
  audio.onerror = end;
  audio.src = url;
  playingUrl = url;
  notify();
  try {
    await audio.play();
  } catch {
    if (playingUrl === url) stopSample();
  }
};
