import { useTranslation } from '@/hooks/useTranslation';

/**
 * The search box at the top of the library looks through the books on the device only. When it
 * finds none, say that the whole catalog is one button away (the "Search all books" button).
 */
const CatalogSearchHint = ({ localMatches }: { localMatches: number }) => {
  const _ = useTranslation();
  if (localMatches > 0) return null;
  return (
    <p role='note' className='text-base-content/70 w-full px-4 text-center text-sm'>
      {_('No matches on this device. Use Search all books to look in the whole catalog.')}
    </p>
  );
};

export default CatalogSearchHint;
