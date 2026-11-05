import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSidebarStore } from '@/store/sidebarStore';

const saveViewSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const brand = vi.hoisted(() => ({ independentDeployment: false }));

vi.mock('@/helpers/settings', () => ({ saveViewSettings }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/app/reader/hooks/useBooksManager', () => ({
  default: () => ({ openParallelView: vi.fn() }),
}));
vi.mock('@/utils/appBrand', () => ({
  APP_NAME: 'Readest',
  isIndependentDeployment: () => brand.independentDeployment,
}));

// eslint-disable-next-line import/first
import BookMenu from '@/app/reader/components/sidebar/BookMenu';

const setBook = (bookDoc: object, viewSettings: object) => {
  (useReaderStore.setState as unknown as (state: unknown) => void)({
    bookKeys: ['book1'],
    viewStates: { book1: { viewSettings } },
  });
  (useBookDataStore.setState as unknown as (state: unknown) => void)({
    booksData: {
      book1: {
        id: 'book1',
        book: { format: 'EPUB' },
        file: null,
        config: null,
        docFormat: 'EPUB',
        bookDoc,
      },
    },
  });
};

beforeEach(() => {
  brand.independentDeployment = false;
  (useSettingsStore.setState as unknown as (state: unknown) => void)({
    settings: DEFAULT_SYSTEM_SETTINGS,
  });
  useSidebarStore.setState({ sideBarBookKey: 'book1' });
  saveViewSettings.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('BookMenu page thumbnails toggle', () => {
  it('hides annotation transfer actions only for independent deployments', () => {
    setBook({}, { showTOCThumbnails: true });
    const { rerender } = render(<BookMenu />);
    expect(screen.getByRole('menuitem', { name: 'Export Annotations' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Import Annotations' })).not.toBeNull();

    brand.independentDeployment = true;
    rerender(<BookMenu />);
    expect(screen.queryByRole('menuitem', { name: 'Export Annotations' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Import Annotations' })).toBeNull();
    expect(screen.getByText('Clear Annotations')).not.toBeNull();
  });

  it('hides manual audiobook pairing only for independent deployments', () => {
    setBook({ rendition: {}, toc: [{}] }, { showTOCThumbnails: true });
    const { rerender } = render(<BookMenu />);
    expect(screen.getByRole('menuitem', { name: 'Pair Audiobook' })).not.toBeNull();

    brand.independentDeployment = true;
    rerender(<BookMenu />);
    expect(screen.queryByRole('menuitem', { name: 'Pair Audiobook' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Proofread' })).not.toBeNull();
    expect(screen.getByText('Clear Annotations')).not.toBeNull();
  });

  it('is not offered for books without page thumbnails', () => {
    setBook({}, { showTOCThumbnails: true });
    render(<BookMenu />);
    expect(screen.queryByRole('menuitem', { name: 'Show Page Thumbnails' })).toBeNull();
  });

  it('turns page thumbnails off for the current book only', () => {
    setBook({ getPageThumbnail: vi.fn() }, { showTOCThumbnails: true });
    const setIsDropdownOpen = vi.fn();
    render(<BookMenu setIsDropdownOpen={setIsDropdownOpen} />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Show Page Thumbnails' }));

    expect(saveViewSettings).toHaveBeenCalledWith(
      {},
      'book1',
      'showTOCThumbnails',
      false,
      true,
      false,
    );
    expect(setIsDropdownOpen).toHaveBeenCalledWith(false);
  });

  it('turns page thumbnails back on', () => {
    setBook({ getPageThumbnail: vi.fn() }, { showTOCThumbnails: false });
    render(<BookMenu />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Show Page Thumbnails' }));

    expect(saveViewSettings).toHaveBeenCalledWith(
      {},
      'book1',
      'showTOCThumbnails',
      true,
      true,
      false,
    );
  });
});
