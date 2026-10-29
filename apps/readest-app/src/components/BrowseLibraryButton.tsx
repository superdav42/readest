// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-28 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// The operator's catalog is the heart of a shared-library deployment: a first-time
// reader should see where the books are without opening a menu.
import clsx from 'clsx';
import { PiBooks } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { getLibraryBrowsePath } from '@/services/gutenbergLibrary';

interface BrowseLibraryButtonProps {
  className?: string;
  /** `tile`: a bookshelf tile beside the books; `button`: a header or empty-state button. */
  variant?: 'button' | 'tile' | 'primary';
}

const BrowseLibraryButton: React.FC<BrowseLibraryButtonProps> = (props) => {
  // No catalog configured (stock Readest): render nothing and touch no router.
  const path = getLibraryBrowsePath();
  return path ? <BrowseLibraryButtonInner {...props} path={path} /> : null;
};

const BrowseLibraryButtonInner: React.FC<BrowseLibraryButtonProps & { path: string }> = ({
  className,
  variant = 'button',
  path,
}) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const label = _('Browse books');
  const open = () => router.push(path);

  if (variant === 'tile') {
    return (
      <button
        type='button'
        aria-label={label}
        onClick={open}
        className={clsx(
          'bookitem-main eink-bordered bg-base-100/50 hover:bg-base-300/50 flex aspect-28/41 w-full flex-col',
          'items-center justify-center gap-3 rounded-sm px-2 text-center',
          'focus-visible:ring-base-content/15 focus-visible:outline-hidden focus-visible:ring-2',
          className,
        )}
      >
        <PiBooks aria-hidden className='text-base-content/60 size-10' />
        <span className='text-base-content/70 text-sm font-medium leading-tight'>{label}</span>
      </button>
    );
  }
  if (variant === 'primary') {
    return (
      <button type='button' onClick={open} className={clsx('btn btn-primary w-full', className)}>
        <PiBooks aria-hidden className='size-5' />
        {label}
      </button>
    );
  }
  return (
    <button
      type='button'
      onClick={open}
      title={label}
      className={clsx(
        'btn btn-ghost h-8 min-h-8 gap-1.5 rounded-full px-2.5 font-normal sm:px-3',
        'bg-base-300/45 hover:bg-base-300',
        className,
      )}
    >
      <PiBooks aria-hidden className='size-[18px]' />
      <span className='hidden text-sm sm:inline'>{label}</span>
    </button>
  );
};

export default BrowseLibraryButton;
