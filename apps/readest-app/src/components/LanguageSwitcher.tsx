'use client';

// Header language selector: one choice switches the interface language and the
// language books are listed and read in (see services/gutenbergLibrary.ts).
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { PiGlobe } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import {
  announceContentLanguage,
  fetchLibraryLanguages,
  getCatalogBase,
  getContentLanguage,
  type LibraryLanguage,
} from '@/services/gutenbergLibrary';
import { getDirFromLanguage } from '@/utils/rtl';

// Content language -> Readest UI locale where they differ.
const UI_LOCALE: Record<string, string> = { zh: 'zh-CN' };

const FALLBACK: LibraryLanguage[] = [
  { code: 'en', name: 'English', available: 0, narration: true },
];

export default function LanguageSwitcher({ className }: { className?: string }) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [languages, setLanguages] = useState<LibraryLanguage[]>(FALLBACK);
  const [current, setCurrent] = useState(getContentLanguage());

  useEffect(() => {
    fetchLibraryLanguages()
      .then(setLanguages)
      .catch(() => setLanguages(FALLBACK));
  }, []);

  if (!getCatalogBase()) return null;

  const choose = async (code: string) => {
    if (code === current) return;
    const { settings, setSettings, saveSettings, applyUILanguage } = useSettingsStore.getState();
    const locale = UI_LOCALE[code] ?? code;
    const previousDir = getDirFromLanguage(getContentLanguage());
    applyUILanguage(locale);
    setCurrent(code);
    const next = {
      ...settings,
      globalViewSettings: { ...settings.globalViewSettings, uiLanguage: locale },
    };
    setSettings(next);
    await saveSettings(envConfig, next);
    await announceContentLanguage(code);
    // Layout direction is fixed at load: switching between LTR and RTL needs a reload.
    if (getDirFromLanguage(code) !== previousDir) window.location.reload();
  };

  return (
    <div className={clsx('dropdown dropdown-end', className)}>
      <button
        tabIndex={0}
        type='button'
        aria-label={_('Language')}
        title={_('Language')}
        className='btn btn-ghost h-8 min-h-8 gap-1 rounded-full px-2 text-sm font-normal'
      >
        <PiGlobe className='h-5 w-5' />
        <span className='uppercase'>{current}</span>
      </button>
      <ul
        tabIndex={0}
        className='dropdown-content menu bg-base-100 rounded-box eink-bordered z-50 mt-2 max-h-96 w-56 flex-nowrap overflow-y-auto p-2 shadow'
      >
        {languages.map((lang) => (
          <li key={lang.code}>
            <button
              type='button'
              lang={lang.code}
              className={clsx('flex justify-between', lang.code === current && 'active')}
              onClick={() => {
                (document.activeElement as HTMLElement | null)?.blur();
                void choose(lang.code);
              }}
            >
              <span>{lang.name}</span>
              <span className='text-base-content/50 text-xs'>{lang.available || ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
