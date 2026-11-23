// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
import clsx from 'clsx';
import { useSyncExternalStore } from 'react';
import { PiPause, PiPlay } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { getPlayingSample, subscribeSample, toggleSample } from '@/services/listen/samplePlayer';

interface ListenRowProps {
  label: string;
  details: string;
  sampleUrl: string | null;
  busy: boolean;
  disabled: boolean;
  onPlay: () => void;
}

const ListenRow = ({ label, details, sampleUrl, busy, disabled, onPlay }: ListenRowProps) => {
  const _ = useTranslation();
  const playingUrl = useSyncExternalStore(subscribeSample, getPlayingSample, () => null);
  const samplePlaying = !!sampleUrl && playingUrl === sampleUrl;

  return (
    <li
      className={clsx(
        'eink-bordered border-base-content/10 rounded-xl border px-3 py-3',
        'flex flex-wrap items-center gap-2',
      )}
    >
      <div className='min-w-0 flex-1 basis-48'>
        <div className='line-clamp-2 text-sm font-semibold'>{label}</div>
        {details && <div className='text-base-content/70 line-clamp-2 text-xs'>{details}</div>}
      </div>
      <button
        type='button'
        className='btn btn-ghost btn-sm eink-bordered gap-1'
        disabled={!sampleUrl}
        onClick={() => sampleUrl && void toggleSample(sampleUrl)}
      >
        {samplePlaying ? <PiPause className='h-4 w-4' /> : <PiPlay className='h-4 w-4' />}
        {samplePlaying ? _('Pause') : _('Sample')}
      </button>
      <button
        type='button'
        className='btn btn-contrast btn-sm gap-1'
        disabled={disabled}
        onClick={onPlay}
      >
        <PiPlay className='h-4 w-4' />
        {busy ? _('Opening…') : _('Play')}
      </button>
    </li>
  );
};

export default ListenRow;
