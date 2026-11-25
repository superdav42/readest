// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Book page: every way to listen to a book (each LibriVox recording and the AI narration, with
// a Sample and a Play button) and Read now. `?work=<id>&lang=<code>`.
'use client';

import clsx from 'clsx';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useLibrary } from '@/hooks/useLibrary';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { useOpenEdition } from '@/app/library/hooks/useOpenEdition';
import {
  type LibraryWork,
  type ListenOptions,
  fetchListenOptions,
  fetchWork,
  getContentLanguage,
} from '@/services/gutenbergLibrary';
import { playListenOption } from '@/services/listen/playOption';
import { resolvePlayTarget } from '@/services/listen/playTarget';
import {
  getRecordingVersionDetail,
  getVisibleVersions,
  type VisibleVersion,
} from '@/services/listen/optionsDisplay';
import { stopSample } from '@/services/listen/samplePlayer';
import { eventDispatcher } from '@/utils/event';
import { getHorizontalInsetStyle } from '@/utils/insets';
import { navigateToLibrary } from '@/utils/nav';
import { formatPlaybackTime } from '@/utils/time';
import { Toast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import PlayerHeader from '@/app/player/components/PlayerHeader';
import ListenRow from './components/ListenRow';
import VersionsList from './components/VersionsList';

const BookRoute = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const { appService } = useEnv();
  const { safeAreaInsets, isIPhoneDuo } = useThemeStore();
  useTheme({ systemUIVisible: false });

  const workId = Number(searchParams?.get('work'));
  const lang = searchParams?.get('lang') || getContentLanguage();

  const [options, setOptions] = useState<ListenOptions | null>(null);
  const [work, setWork] = useState<LibraryWork | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const { opening, openEdition } = useOpenEdition();
  // The reader finds the book in the library store: when this page is the first one loaded (a
  // reload or a link), the library and settings must be read before Play or Read now navigates.
  const { libraryLoaded } = useLibrary();

  const validWork = Number.isInteger(workId) && workId > 0;
  useEffect(() => {
    if (!validWork) navigateToLibrary(router);
  }, [validWork, router]);

  useEffect(() => {
    if (!validWork) return;
    let cancelled = false;
    setOptions(null);
    void fetchListenOptions(workId, lang).then((result) => !cancelled && setOptions(result));
    fetchWork(workId, lang)
      .then((result) => !cancelled && setWork(result))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workId, lang]);

  // Leaving the page stops the sample.
  useEffect(() => stopSample, []);

  const handleGoBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else navigateToLibrary(router);
  }, [router]);
  useKeyDownActions({ onCancel: handleGoBack });

  const title = work?.title || options?.title || '';

  const play = async (key: string) => {
    if (!appService || !libraryLoaded || !options || playing) return;
    stopSample();
    setPlaying(key);
    try {
      // A recording is played against the ebook it was built on, which can be another version of
      // this book (a work group), not the one the page was opened for.
      const target = resolvePlayTarget(options, key);
      await playListenOption(
        {
          appService,
          router,
          workId: target.workId,
          lang,
          text: target.text,
          openText: target.openText,
        },
        { key },
      );
    } catch (error) {
      console.warn('Book page: could not play', workId, error);
      eventDispatcher.dispatch('toast', {
        message: _('Could not open this book. Check your connection and try again.'),
        type: 'error',
      });
    } finally {
      setPlaying(null);
    }
  };

  const readNow = () => {
    stopSample();
    // Offline, the catalog edition is unknown: the copy already on the device is reused.
    const best = work?.best;
    void openEdition(
      best
        ? { work_id: workId, lang: best.lang, url: best.url, hash: best.hash, kind: best.kind }
        : { work_id: workId, lang, url: options?.text?.url ?? '' },
      { title, cover: '' },
    );
  };

  const openVersion = (version: VisibleVersion) => {
    stopSample();
    void openEdition(
      {
        work_id: version.work_id,
        lang: version.best.lang,
        url: version.best.url,
        hash: version.best.hash,
        kind: version.best.kind,
      },
      { title: version.title, cover: '' },
    );
  };

  const rows = useMemo(() => {
    if (!options) return [];
    const recordings = options.recordings.map((rec) => {
      const meta = [
        rec.seconds > 0 ? formatPlaybackTime(rec.seconds) : '',
        rec.year ? String(rec.year) : '',
        rec.solo ? _('solo') : '',
      ].filter(Boolean);
      const readers = rec.readers.join(', ');
      return {
        key: rec.key,
        label: rec.label || rec.title,
        details: [readers && readers !== rec.label ? readers : '', ...meta]
          .filter(Boolean)
          .join(' · '),
        versionDetail: getRecordingVersionDetail(options, rec, _),
        sampleUrl: rec.sample_url,
      };
    });
    if (options.ai.available) {
      recordings.push({
        key: options.ai.key,
        label: _('AI narration'),
        details: _('synthetic voice, every book'),
        versionDetail: '',
        sampleUrl: options.ai.sample_url,
      });
    }
    return recordings;
  }, [options, _]);

  const versions = useMemo(() => (options ? getVisibleVersions(options) : []), [options]);

  if (!validWork) return <Spinner loading />;

  return (
    <div
      className='bg-base-100 full-height relative flex select-none flex-col overflow-hidden'
      style={{
        paddingTop: `${safeAreaInsets?.top || 0}px`,
        paddingBottom: `${safeAreaInsets?.bottom || 0}px`,
        ...getHorizontalInsetStyle(safeAreaInsets, isIPhoneDuo),
      }}
    >
      <PlayerHeader title={title} subtitle={_('Listen')} onGoBack={handleGoBack} />
      <div className='mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-2'>
        <button
          type='button'
          className='btn btn-contrast self-start'
          disabled={!!opening || !libraryLoaded}
          onClick={readNow}
        >
          {_('Read now')}
        </button>
        {!options ? (
          <Spinner loading />
        ) : (
          <ul className={clsx('flex flex-col gap-2')}>
            {rows.map((row) => (
              <ListenRow
                key={row.key}
                label={row.label}
                details={row.details}
                versionDetail={row.versionDetail}
                sampleUrl={row.sampleUrl}
                busy={playing === row.key}
                disabled={!!playing || !!opening || !libraryLoaded}
                onPlay={() => void play(row.key)}
              />
            ))}
          </ul>
        )}
        <VersionsList
          versions={versions}
          disabled={!!opening || !libraryLoaded}
          onOpen={openVersion}
        />
        {opening && (
          <p className='text-base-content/70 text-sm' role='status'>
            {_('Opening book…')}
            {opening.progress > 0 &&
              opening.progress < 1 &&
              ` ${Math.round(opening.progress * 100)}%`}
          </p>
        )}
      </div>
      <Toast />
    </div>
  );
};

const BookPage = () => (
  <Suspense fallback={<div className='full-height bg-base-100' />}>
    <BookRoute />
  </Suspense>
);

export default BookPage;
