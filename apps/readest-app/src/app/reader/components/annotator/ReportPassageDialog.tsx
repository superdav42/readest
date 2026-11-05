// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-05 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
// Readers report a faulty passage of a translated library edition. The library
// re-translates reported passages with a stronger model in its next review.
'use client';

import { useId, useState } from 'react';

import ModalPortal from '@/components/ModalPortal';
import { useTranslation } from '@/hooks/useTranslation';
import { type PassageReportCategory, reportPassage } from '@/services/gutenbergLibrary';
import { eventDispatcher } from '@/utils/event';
import { stubTranslation as __ } from '@/utils/misc';

interface ReportPassageDialogProps {
  workId: number;
  lang: string;
  quote: string;
  hash?: string;
  onClose: () => void;
}

const CATEGORIES: { value: PassageReportCategory; label: string }[] = [
  { value: 'meaning', label: __('The meaning is wrong') },
  { value: 'missing', label: __('Something is missing') },
  { value: 'grammar', label: __('Grammar or spelling') },
  { value: 'untranslated', label: __('Not translated') },
  { value: 'formatting', label: __('Formatting') },
  { value: 'other', label: __('Other') },
];

export default function ReportPassageDialog({
  workId,
  lang,
  quote,
  hash,
  onClose,
}: ReportPassageDialogProps) {
  const _ = useTranslation();
  const id = useId();
  const [category, setCategory] = useState<PassageReportCategory>('meaning');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const shown = quote.length > 280 ? `${quote.slice(0, 280)}…` : quote;

  const send = async () => {
    setSending(true);
    try {
      await reportPassage({ workId, lang, quote, category, comment, hash });
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Thank you. This passage will be checked again.'),
        timeout: 3000,
      });
      onClose();
    } catch (error) {
      const tooMany = error instanceof Error && error.message === 'library_api_429';
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: tooMany
          ? _('Too many reports. Please try again later.')
          : _('Could not send the report. Please try again later.'),
        timeout: 4000,
      });
      setSending(false);
    }
  };

  return (
    <ModalPortal>
      <dialog className='modal modal-open' aria-labelledby={`${id}-title`} onCancel={onClose}>
        <div className='modal-box bg-base-100 w-[min(460px,calc(100vw-2rem))] rounded-2xl'>
          <h3 id={`${id}-title`} className='text-base-content text-base font-semibold'>
            {_('Report a translation problem')}
          </h3>
          <figure className='mt-3'>
            <figcaption className='text-base-content/75 text-sm'>
              {_('Selected passage')}
            </figcaption>
            <blockquote className='bg-base-200 text-base-content mt-1 max-h-32 overflow-y-auto rounded-lg px-3 py-2 text-sm'>
              {shown}
            </blockquote>
          </figure>
          <fieldset className='mt-4'>
            <legend className='text-base-content/75 mb-1 text-sm'>{_('What is wrong?')}</legend>
            <div className='grid grid-cols-1 gap-1 sm:grid-cols-2'>
              {CATEGORIES.map((option) => (
                <label
                  key={option.value}
                  className='flex min-h-11 cursor-pointer items-center gap-2 text-sm'
                >
                  <input
                    type='radio'
                    className='radio radio-sm'
                    name={`${id}-category`}
                    value={option.value}
                    checked={category === option.value}
                    onChange={() => setCategory(option.value)}
                  />
                  {_(option.label)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className='mt-3 block text-sm' htmlFor={`${id}-comment`}>
            <span className='text-base-content/75'>{_('Details (optional)')}</span>
          </label>
          <textarea
            id={`${id}-comment`}
            className='textarea textarea-bordered mt-1 w-full text-sm'
            rows={3}
            maxLength={1000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className='modal-action mt-4'>
            <button
              type='button'
              className='btn btn-ghost min-h-11'
              onClick={onClose}
              disabled={sending}
            >
              {_('Cancel')}
            </button>
            <button
              type='button'
              className='btn btn-primary min-h-11'
              onClick={send}
              disabled={sending}
            >
              {sending ? _('Sending…') : _('Send report')}
            </button>
          </div>
        </div>
      </dialog>
    </ModalPortal>
  );
}
