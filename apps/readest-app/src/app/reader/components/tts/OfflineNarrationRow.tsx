// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-22 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// The Read Aloud sheet's row for listening to the narration with no connection: says whether it
// is saved on this device and saves it (or removes a saved voice).
import clsx from 'clsx';
import React from 'react';
import { MdCheckCircleOutline, MdDeleteOutline, MdOutlineFileDownload } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import type { OfflineNarration } from '../../hooks/useOfflineNarration';

const OfflineNarrationRow: React.FC<{ offline: OfflineNarration; iconSize: number }> = ({
  offline,
  iconSize,
}) => {
  const _ = useTranslation();
  if (!offline.kind) return null;
  const { state, busy, failed, saved, total, built } = offline;
  const percent = Math.round(offline.progress * 100);
  const saveable = !busy && !offline.offline && state !== 'saved';

  let detail: string;
  if (busy) detail = percent > 0 ? _('Saving… {{percent}}%', { percent }) : _('Saving…');
  else if (failed) detail = _('Could not save. Tap to try again.');
  else if (state === 'saved') detail = _('Saved on this device');
  else if (state === 'partial') {
    detail =
      built < total
        ? _('{{saved}} of {{total}} parts saved. The rest is still being prepared.', {
            saved,
            total,
          })
        : _('{{saved}} of {{total}} parts saved', { saved, total });
  } else if (offline.offline) detail = _('Not saved on this device. Connect to save it.');
  else
    detail =
      offline.kind === 'voice'
        ? _('Save the recording to listen without a connection')
        : _('Download the narration to listen without a connection');

  return (
    <div className='not-eink:bg-base-200 eink-bordered flex w-full items-center gap-1 rounded-xl'>
      <button
        type='button'
        aria-label={_('Listen offline')}
        disabled={!saveable}
        onClick={offline.save}
        className='flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 disabled:opacity-100'
      >
        {state === 'saved' ? (
          <MdCheckCircleOutline size={iconSize} className='shrink-0' />
        ) : (
          <MdOutlineFileDownload
            size={iconSize}
            className={clsx('shrink-0', busy && 'animate-pulse')}
          />
        )}
        <div className='flex min-w-0 flex-1 flex-col items-start'>
          <span className='text-sm font-semibold'>{_('Listen offline')}</span>
          <span className='text-base-content/60 line-clamp-2 text-start text-xs'>{detail}</span>
        </div>
      </button>
      {offline.remove && !busy && (
        <button
          type='button'
          aria-label={_('Remove from this device')}
          title={_('Remove from this device')}
          onClick={offline.remove}
          className='btn btn-ghost btn-circle btn-sm me-1 shrink-0'
        >
          <MdDeleteOutline size={iconSize} />
        </button>
      )}
    </div>
  );
};

export default OfflineNarrationRow;
