import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'en' }));
vi.mock('@/utils/misc', async (orig) => ({
  ...(await orig<typeof import('@/utils/misc')>()),
  getUserLang: () => lang.value,
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));

import { getUiDirAttr } from '@/utils/rtl';
import CatalogSearchHint from '@/app/library/components/CatalogSearchHint';

describe('getUiDirAttr', () => {
  beforeEach(() => {
    lang.value = 'en';
  });

  it('is rtl for a right-to-left interface language', () => {
    lang.value = 'ar';
    expect(getUiDirAttr()).toBe('rtl');
    lang.value = 'he';
    expect(getUiDirAttr()).toBe('rtl');
  });

  it('leaves other languages alone (no attribute)', () => {
    expect(getUiDirAttr()).toBeUndefined();
    lang.value = 'fi';
    expect(getUiDirAttr()).toBeUndefined();
  });
});

describe('CatalogSearchHint', () => {
  afterEach(cleanup);

  it('points to the whole catalog when nothing on the device matches', () => {
    render(<CatalogSearchHint localMatches={0} />);
    expect(screen.getByRole('note').textContent).toContain('Search all books');
  });

  it('is absent when there are matches on the device', () => {
    render(<CatalogSearchHint localMatches={3} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
