import { describe, expect, it } from 'vitest';
import { languageLabel } from '@/services/gutenbergLibrary';

const languages = [
  { code: 'en', name: 'English', available: 0, narration: true },
  { code: 'fr', name: 'Français', available: 3, narration: false },
];

describe('languageLabel', () => {
  it('uses the catalog name when listed', () => {
    expect(languageLabel('fr', languages)).toBe('Français');
  });

  it('falls back to the browser language name when not listed', () => {
    expect(languageLabel('de', languages)).toBe('Deutsch');
  });

  it('falls back to the browser language name for an empty list', () => {
    expect(languageLabel('en', [])).toBe('English');
  });
});
