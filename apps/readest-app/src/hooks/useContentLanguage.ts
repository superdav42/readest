// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-25 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
// Kept out of services/gutenbergLibrary.ts so that module stays usable from
// server components (it is imported by cloudService/bookService).
import { useEffect, useState } from 'react';
import { CONTENT_LANGUAGE_EVENT, getContentLanguage } from '@/services/gutenbergLibrary';
import { eventDispatcher } from '@/utils/event';

/** Current content language, updated when the reader switches language. */
export const useContentLanguage = (): string => {
  const [lang, setLang] = useState(getContentLanguage());
  useEffect(() => {
    const onChange = (event: CustomEvent) => setLang((event.detail as { lang: string }).lang);
    eventDispatcher.on(CONTENT_LANGUAGE_EVENT, onChange);
    return () => eventDispatcher.off(CONTENT_LANGUAGE_EVENT, onChange);
  }, []);
  return lang;
};
