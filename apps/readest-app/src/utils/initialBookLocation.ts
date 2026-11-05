// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-05 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.

import type { BookDoc, LandmarkItem } from '@/libs/document';

const SKIPPABLE_LANDMARK_TYPES = new Set(['cover', 'toc']);

const getSectionIndex = (bookDoc: BookDoc, landmark: LandmarkItem): number => {
  if (!landmark.href) return -1;
  const [path] = bookDoc.splitTOCHref(landmark.href);
  return bookDoc.sections.findIndex((section) => section.id === path || section.href === path);
};

/**
 * Resolve a conservative first-open location from EPUB navigation semantics.
 *
 * Only a contiguous run of initial spine documents explicitly identified as a
 * cover or table of contents is skipped. Labels, filenames, document text, and
 * bodymatter landmarks are deliberately ignored so authored front matter and
 * ambiguous starts remain exactly where the publisher put them.
 */
export const getMeaningfulFirstLocation = (bookDoc: BookDoc): string | null => {
  const { landmarks, sections } = bookDoc;
  if (!landmarks?.length || !sections.length) return null;

  const skippable = new Set(
    landmarks
      .filter((item) => item.type?.some((type) => SKIPPABLE_LANDMARK_TYPES.has(type)))
      .map((item) => getSectionIndex(bookDoc, item))
      .filter((index) => index >= 0),
  );
  if (!skippable.size) return null;

  const firstLinear = sections.findIndex((section) => section.linear !== 'no');
  if (firstLinear < 0 || !skippable.has(firstLinear)) return null;

  for (let index = firstLinear + 1; index < sections.length; index += 1) {
    const section = sections[index]!;
    if (section.linear === 'no' || skippable.has(index)) continue;
    return section.cfi || null;
  }
  return null;
};
