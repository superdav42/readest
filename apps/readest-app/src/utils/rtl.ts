import { getUserLang } from './misc';

export const getDirFromLanguage = (lang: string) => {
  if (!lang) return 'auto';
  const rtlLanguages = new Set(['ar', 'he', 'fa', 'ur', 'dv', 'ps', 'sd', 'yi']);
  const primaryLang = lang.split('-')[0]!.toLowerCase();
  return rtlLanguages.has(primaryLang) ? 'rtl' : 'auto';
};

export const getDirFromUILanguage = () => {
  const lang = getUserLang();
  return getDirFromLanguage(lang);
};

/**
 * `dir` for a page this fork owns (book page, Discover): 'rtl' for a right-to-left interface
 * language, else no attribute. Upstream keeps the rest of the app left-to-right on purpose and
 * adds targeted fixes (see `ui-rtl` in Providers), so this is applied per page, not on <html>.
 */
export const getUiDirAttr = (): 'rtl' | undefined =>
  getDirFromUILanguage() === 'rtl' ? 'rtl' : undefined;
