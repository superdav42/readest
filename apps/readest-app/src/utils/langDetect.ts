// Added 2026-11-04 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
// Language detection from text. Split out of ./lang so `franc-min` (about 170 KB with its
// trigram data) stays out of every page that only needs the cheap language helpers; import
// this module dynamically where the library page can reach the caller.
import { franc } from 'franc-min';
import { code6393to6391, inferLangFromScript, isValidLang, normalizedLangCode } from './lang';

export const detectLanguage = (content: string): string => {
  try {
    const sample = content.substring(0, 1000);
    const iso6393Lang = franc(sample);
    const iso6391Lang = code6393to6391(iso6393Lang);
    if (iso6391Lang) return iso6391Lang;
    // franc returns "und" for short CJK text such as a TXT title line. Defaulting
    // to English there sends the caller down the wrong path (e.g. TXT chapter
    // detection never applies the Chinese regexps), so read the script instead.
    // See issue #6172.
    return inferLangFromScript(sample, '') || 'en';
  } catch {
    console.warn('Language detection failed, defaulting to en.');
    return 'en';
  }
};

// A PDF rarely declares a language, and its text layer is always tagged `en`, so
// Read Aloud picks the voice from the page being read. Short pages (a cover, a
// heading) are left alone: too little text to tell English from its neighbours.
export const getPDFSpeechLang = (primaryLang: string | undefined, pageText: string): string => {
  if (isValidLang(primaryLang) && !['en', 'eng'].includes(normalizedLangCode(primaryLang))) {
    return primaryLang!;
  }
  const text = pageText.replace(/\s+/g, ' ').trim();
  return text.length >= 100 ? detectLanguage(text) : 'en';
};
