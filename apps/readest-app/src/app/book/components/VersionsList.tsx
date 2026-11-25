// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-24 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
import { useTranslation } from '@/hooks/useTranslation';
import type { VisibleVersion } from '@/services/listen/optionsDisplay';

interface VersionsListProps {
  versions: VisibleVersion[];
  disabled: boolean;
  onOpen: (version: VisibleVersion) => void;
}

const VersionsList = ({ versions, disabled, onOpen }: VersionsListProps) => {
  const _ = useTranslation();
  if (!versions.length) return null;

  return (
    <section className='flex flex-col gap-2' aria-labelledby='book-versions-title'>
      <h2 id='book-versions-title' className='text-lg font-semibold tracking-tight'>
        {_('Versions')}
      </h2>
      <ul className='eink-bordered border-base-content/10 divide-base-content/10 flex flex-col divide-y rounded-xl border'>
        {versions.map((version) => (
          <li key={version.work_id} className='flex flex-wrap items-center gap-3 px-3 py-3'>
            <div className='min-w-0 flex-1 basis-48'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-sm font-semibold'>{version.label}</span>
                {version.default && (
                  <span className='eink-bordered bg-base-200 rounded-full px-2 py-0.5 text-xs'>
                    {_('Default')}
                  </span>
                )}
              </div>
              <div className='text-base-content/70 text-xs'>{version.title}</div>
            </div>
            <button
              type='button'
              className='btn btn-contrast btn-sm'
              disabled={disabled}
              aria-label={_('Open {{title}}', { title: version.title })}
              onClick={() => onOpen(version)}
            >
              {_('Open')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default VersionsList;
