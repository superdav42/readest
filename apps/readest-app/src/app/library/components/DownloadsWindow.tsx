// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Downloads: what listening has saved on this device (voices and their text editions), with
// Keep and Delete per voice, Delete all, and the storage settings. Deleting removes the voice
// and the book file only ('local', never 'purge'): notes, bookmarks and the reading place stay.
import { useCallback, useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { BoxedList, SettingsRow, SettingsSwitchRow } from '@/components/settings/primitives';
import { useEnv } from '@/context/EnvContext';
import { useListeningSettings } from '@/hooks/useListeningSettings';
import { useTranslation } from '@/hooks/useTranslation';
import { getBookLanguage, getBookWorkId } from '@/services/gutenbergLibrary';
import { isVoiceKept, setVoiceKept } from '@/services/listen/finished';
import { libraryVoiceName } from '@/services/tts/libraryVoice';
import { listSavedVoices, removeVoiceOffline, type SavedVoice } from '@/services/tts/voiceOffline';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import { formatBytes } from '@/utils/book';

export const setDownloadsDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('downloads_window');
  dialog?.dispatchEvent(new CustomEvent('setDialogVisibility', { detail: { visible } }));
};

/** The library's copy of the text edition a saved voice belongs to. */
const textEditionOf = (entry: SavedVoice, library: Book[]): Book | undefined => {
  const same = library.filter(
    (book) =>
      !book.deletedAt &&
      getBookWorkId(book) === entry.workId &&
      getBookLanguage(book) === entry.lang,
  );
  return same.find((book) => book.hash === entry.listing.text.hash) ?? same[0];
};

export const DownloadsWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { listening, update } = useListeningSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [voices, setVoices] = useState<SavedVoice[]>([]);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setVoices(listSavedVoices()), []);

  useEffect(() => {
    const el = document.getElementById('downloads_window');
    const onVisibility = (event: Event) => {
      const { visible } = (event as CustomEvent<{ visible: boolean }>).detail;
      setIsOpen(visible);
      setConfirmAll(false);
      if (visible) reload();
    };
    el?.addEventListener('setDialogVisibility', onVisibility);
    return () => el?.removeEventListener('setDialogVisibility', onVisibility);
  }, [reload]);

  const remove = async (entries: SavedVoice[]) => {
    if (!appService) return;
    setBusy(true);
    try {
      const { library, setLibrary } = useLibraryStore.getState();
      for (const entry of entries) {
        await removeVoiceOffline(entry.workId, entry.lang, entry.key);
        const book = textEditionOf(entry, library);
        if (book && (await appService.getBookFileSize(book)) !== null) {
          await appService.deleteBook(book, 'local');
        }
      }
      setLibrary([...library]);
      await appService.saveLibraryBooks(library);
    } catch (error) {
      console.warn('Downloads: could not delete', error);
    } finally {
      setBusy(false);
      setConfirmAll(false);
      reload();
    }
  };

  const library = useLibraryStore((s) => s.library);
  const total = voices.reduce((sum, entry) => sum + entry.bytes, 0);
  const ghostBtn = 'btn btn-ghost btn-sm eink-bordered';

  return (
    <Dialog
      id='downloads_window'
      isOpen={isOpen}
      title={_('Downloads')}
      onClose={() => setIsOpen(false)}
      boxClassName='sm:w-[480px]! sm:max-w-(--breakpoint-sm)! sm:h-auto'
    >
      {isOpen && (
        <div className='flex flex-col gap-5 px-2 pb-2 pt-3'>
          <BoxedList title={_('Saved recordings')}>
            {voices.length === 0 && <SettingsRow label={_('Nothing is saved on this device')} />}
            {voices.map((entry) => {
              const info = entry.listing.voices[0];
              const book = textEditionOf(entry, library);
              return (
                <SettingsRow
                  key={`${entry.workId}:${entry.lang}:${entry.key}`}
                  label={book?.title ?? `#${entry.workId}`}
                  description={[
                    info ? libraryVoiceName(info) : entry.key,
                    formatBytes(entry.bytes),
                    new Date(entry.savedAt).toLocaleDateString(),
                  ].join(' · ')}
                >
                  <div className='flex items-center gap-2'>
                    <label className='flex items-center gap-1.5 text-xs'>
                      <input
                        type='checkbox'
                        className='checkbox checkbox-sm'
                        defaultChecked={isVoiceKept(entry.workId, entry.lang)}
                        onChange={(e) => setVoiceKept(entry.workId, entry.lang, e.target.checked)}
                      />
                      {_('Keep')}
                    </label>
                    <button
                      type='button'
                      className={ghostBtn}
                      disabled={busy}
                      onClick={() => void remove([entry])}
                    >
                      {_('Delete')}
                    </button>
                  </div>
                </SettingsRow>
              );
            })}
            {voices.length > 0 && (
              <SettingsRow label={_('Total used')} description={formatBytes(total)}>
                {confirmAll ? (
                  <button
                    type='button'
                    className='btn btn-contrast btn-sm'
                    disabled={busy}
                    onClick={() => void remove(voices)}
                  >
                    {_('Confirm')}
                  </button>
                ) : (
                  <button
                    type='button'
                    className={ghostBtn}
                    disabled={busy}
                    onClick={() => setConfirmAll(true)}
                  >
                    {_('Delete all')}
                  </button>
                )}
              </SettingsRow>
            )}
          </BoxedList>

          <BoxedList title={_('Storage')}>
            <SettingsSwitchRow
              label={_('Delete when finished')}
              description={_('Remove a finished audiobook from this device. Your notes stay.')}
              checked={listening.deleteWhenFinished}
              onChange={() => void update({ deleteWhenFinished: !listening.deleteWhenFinished })}
            />
            <SettingsSwitchRow
              label={_('Ask before large or mobile-data downloads')}
              checked={listening.guardDownloads}
              onChange={() => void update({ guardDownloads: !listening.guardDownloads })}
            />
            <SettingsRow label={_('Large download size (MB)')}>
              <input
                type='number'
                min={1}
                className='input input-sm eink-bordered w-24 text-end'
                defaultValue={listening.guardMegabytes}
                disabled={!listening.guardDownloads}
                onBlur={(e) => {
                  const megabytes = Math.round(Number(e.target.value));
                  if (megabytes > 0) void update({ guardMegabytes: megabytes });
                }}
              />
            </SettingsRow>
          </BoxedList>
        </div>
      )}
    </Dialog>
  );
};

export default DownloadsWindow;
