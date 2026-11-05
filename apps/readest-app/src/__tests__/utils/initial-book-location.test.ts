// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-05 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.

import { describe, expect, it } from 'vitest';
import type { BookDoc, SectionItem } from '@/libs/document';
import { getMeaningfulFirstLocation } from '@/utils/initialBookLocation';

const section = (id: string, cfi: string, linear = 'yes'): SectionItem => ({
  id,
  cfi,
  linear,
  size: 1,
  createDocument: async () => document.implementation.createHTMLDocument(),
});

const bookDoc = (overrides: Partial<BookDoc> = {}): BookDoc => ({
  metadata: { title: 'Book', author: 'Author', language: 'en' },
  rendition: {},
  dir: 'ltr',
  sections: [],
  splitTOCHref: (href) => href.split('#'),
  getCover: async () => null,
  ...overrides,
});

describe('getMeaningfulFirstLocation', () => {
  it('skips a contiguous cover and navigation prefix identified by EPUB landmarks', () => {
    const doc = bookDoc({
      sections: [
        section('cover.xhtml', 'cover-cfi'),
        section('nav.xhtml', 'nav-cfi'),
        section('preface.xhtml', 'preface-cfi'),
      ],
      landmarks: [
        { id: 0, label: 'Cover', href: 'cover.xhtml', index: 0, type: ['cover'] },
        { id: 1, label: 'Contents', href: 'nav.xhtml#toc', index: 0, type: ['toc'] },
      ],
    });

    expect(getMeaningfulFirstLocation(doc)).toBe('preface-cfi');
  });

  it('preserves authored front matter that is not explicitly cover or navigation', () => {
    const doc = bookDoc({
      sections: [section('letter.xhtml', 'letter-cfi'), section('chapter-1.xhtml', 'chapter-cfi')],
      landmarks: [
        { id: 0, label: 'Start', href: 'chapter-1.xhtml', index: 0, type: ['bodymatter'] },
      ],
    });

    expect(getMeaningfulFirstLocation(doc)).toBeNull();
  });

  it('keeps the existing start when cover metadata is not at the initial linear section', () => {
    const doc = bookDoc({
      sections: [section('preface.xhtml', 'preface-cfi'), section('cover.xhtml', 'cover-cfi')],
      landmarks: [{ id: 0, label: 'Cover', href: 'cover.xhtml', index: 0, type: ['cover'] }],
    });

    expect(getMeaningfulFirstLocation(doc)).toBeNull();
  });
});
