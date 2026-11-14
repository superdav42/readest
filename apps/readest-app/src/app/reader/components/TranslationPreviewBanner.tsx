// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-31, rewritten 2026-11-13 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// A book opened from a translation preview: only the beginning is translated (by our own fast
// translation process); the rest is in the original language. Keeps the reader informed about
// the complete translation being prepared — queue position or progress with time left — and
// offers a "Switch" button once it is published.
'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { MdCheckCircle, MdExpandLess, MdExpandMore, MdTranslate } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import {
  fetchWork,
  forgetRequestedBook,
  getPreviewBook,
  setPreviewBook,
  type LibraryWork,
} from '@/services/gutenbergLibrary';
import { openCatalogBook } from '@/services/openCatalogBook';

const POLL_MS = 30_000;

export const formatEta = (seconds: number | undefined, _: (s: string, o?: object) => string) => {
  if (!seconds || seconds <= 0) return '';
  if (seconds < 90) return _('about a minute');
  if (seconds < 3600) return _('about {{n}} min', { n: Math.round(seconds / 60) });
  return _('about {{n}} h', { n: Math.round(seconds / 360) / 10 });
};

const languageName = (code: string, uiLang: string) => {
  try {
    return new Intl.DisplayNames([uiLang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

const TranslationPreviewBanner: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { appService } = useEnv();
  const book = useBookDataStore((s) => s.booksData[bookKey.split('-')[0]!]?.book);
  const preview = book ? getPreviewBook(book.hash) : null;
  const [work, setWork] = useState<LibraryWork | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [switching, setSwitching] = useState(false);

  // Follow the complete translation.
  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    const poll = () =>
      fetchWork(preview.work_id, preview.lang)
        .then((w) => !cancelled && setWork(w))
        .catch(() => undefined);
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [preview?.work_id, preview?.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!work?.best && work.best.lang === preview?.lang && work.best.kind !== 'original';
  const job = work?.jobs.find((j) => j.kind === 'translation');

  useEffect(() => {
    if (ready) setExpanded(true);
  }, [ready]);

  const switchToTranslation = useCallback(async () => {
    if (!appService || !preview || !work?.best || !book) return;
    setSwitching(true);
    try {
      // By hash: the preview and the complete translation are different files of the same work.
      const opened = await openCatalogBook(appService, {
        work_id: preview.work_id,
        lang: preview.lang,
        url: work.best.url,
        hash: work.best.hash,
      });
      setPreviewBook(book.hash, preview.work_id, preview.lang, false);
      forgetRequestedBook(preview.work_id, preview.lang);
      navigateToReader(router, [opened.hash]);
    } catch (error) {
      console.warn('Could not open the translation', error);
      eventDispatcher.dispatch('toast', {
        message: _('Could not open this book. Check your connection and try again.'),
        type: 'error',
      });
    } finally {
      setSwitching(false);
    }
  }, [appService, preview, work, book, router, _]);

  if (!preview || !book) return null;
  const language = languageName(preview.lang, preview.lang);
  const percent = job?.status === 'running' ? (job.estimate?.percent ?? 0) : 0;
  const status = ready
    ? _('The high-quality {{language}} translation is ready.', { language })
    : job?.status === 'running'
      ? _('High-quality {{language}} translation: {{percent}}% done, {{eta}} left', {
          language,
          percent,
          eta: formatEta(job.estimate?.eta_seconds, _),
        })
      : job?.status === 'queued' || job?.status === 'blocked'
        ? _('High-quality {{language}} translation: in line (#{{position}}), {{eta}}', {
            language,
            position: job.position ?? 1,
            eta: formatEta(job.estimate?.eta_seconds, _),
          })
        : job?.status === 'failed'
          ? _('The high-quality translation hit a problem. We will retry it.')
          : _('High-quality {{language}} translation requested.', { language });

  return (
    <div
      className='pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3'
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 2.75rem)' }}
    >
      <div
        role='status'
        aria-live='polite'
        className={clsx(
          'pointer-events-auto flex max-w-md flex-col gap-1.5 rounded-2xl px-3 py-2 text-sm shadow-lg',
          ready ? 'bg-success text-success-content' : 'bg-base-200/95 text-base-content',
        )}
      >
        <div className='flex items-center gap-2'>
          {ready ? (
            <MdCheckCircle className='h-4 w-4 shrink-0' />
          ) : (
            <MdTranslate className='h-4 w-4 shrink-0 text-amber-500' />
          )}
          <span className='font-medium'>
            {ready ? _('Translation ready') : _('Translation preview')}
          </span>
          <button
            type='button'
            className='ml-auto opacity-70'
            aria-label={expanded ? _('Hide details') : _('Show details')}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <MdExpandMore className='h-5 w-5' /> : <MdExpandLess className='h-5 w-5' />}
          </button>
        </div>
        {expanded && (
          <>
            {!ready && (
              <p className='text-xs leading-snug opacity-80'>
                {_(
                  'Only the beginning is translated so far. The rest is in the original language until the complete translation is ready.',
                )}
              </p>
            )}
            <p className='text-xs leading-snug opacity-80'>{status}</p>
            {!ready && (
              <div className='bg-base-300 h-1 w-full overflow-hidden rounded-full'>
                <div
                  className={clsx(
                    'bg-primary h-1 transition-[width]',
                    percent === 0 && 'animate-pulse',
                  )}
                  style={{ width: `${Math.max(percent, 4)}%` }}
                />
              </div>
            )}
            {ready && (
              <button
                type='button'
                className='btn btn-sm self-start'
                disabled={switching}
                onClick={switchToTranslation}
              >
                {switching ? _('Opening book…') : _('Switch to the high-quality translation')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default TranslationPreviewBanner;
