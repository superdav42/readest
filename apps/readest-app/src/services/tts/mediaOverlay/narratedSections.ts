// Added 2026-11-04 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
// Cheap book queries kept apart from the Media Overlay engine (./index), so the library page
// can ask "is this book narrated?" without loading the narration player.
import type { BookDoc } from '@/libs/document';

// Whether this book can be narrated from its own recording: at least one
// section carries a Media Overlay, and the container can hand us the SMIL and
// the audio. Only EPUB satisfies the latter.
export const hasMediaOverlays = (book: BookDoc | null | undefined): boolean =>
  !!book?.loadText &&
  !!book.loadBlob &&
  !!book.sections?.some((section) => section.mediaOverlay?.href);

// Nearest section at or after (direction 1) / at or before (direction -1)
// `from` that has a Media Overlay. Sections without one carry no narration, so
// playback steps over them. Returns -1 when there is none left.
export const findNarratedSection = (book: BookDoc, from: number, direction: 1 | -1): number => {
  const sections = book.sections ?? [];
  for (let i = from; i >= 0 && i < sections.length; i += direction) {
    if (sections[i]?.mediaOverlay?.href) return i;
  }
  return -1;
};
