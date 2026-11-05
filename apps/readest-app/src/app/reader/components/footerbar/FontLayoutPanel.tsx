// Modified 2026-11-05 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TbBoxMargin } from 'react-icons/tb';
import { RxLineHeight } from 'react-icons/rx';
import { PiGear } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveViewSettings } from '@/helpers/settings';
import { NON_FREE_FONTS, SANS_SERIF_FONTS, SERIF_FONTS } from '@/services/constants';
import { getOSPlatform } from '@/utils/misc';
import Slider from '@/components/Slider';

const FONT_SIZE_LIMITS = {
  MIN: 8,
  MAX: 30,
  DEFAULT: 16,
} as const;

const LINE_HEIGHT_LIMITS = {
  MIN: 8,
  MAX: 24,
  DEFAULT: 16,
  MULTIPLIER: 10,
} as const;

const MARGIN_CONSTANTS = {
  MAX_MARGIN_PX: 88,
  MAX_GAP_PERCENT: 10,
  MARGIN_RATIO: 50,
} as const;

interface FontLayoutPanelProps {
  bookKey: string;
  actionTab: string;
  bottomOffset: string;
  marginIconSize: number;
  forceMobileLayout: boolean;
  // Keeps the panel clear of iPhone Duo's side status strip (#6307).
  insetStyle?: React.CSSProperties;
}

export const FontLayoutPanel: React.FC<FontLayoutPanelProps> = ({
  bookKey,
  actionTab,
  bottomOffset,
  marginIconSize,
  forceMobileLayout,
  insetStyle,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getView, getViewSettings, setHoveredBookKey } = useReaderStore();
  const { setSettingsDialogBookKey, setSettingsDialogOpen, setRequestedPanel } = useSettingsStore();
  const customFontRecords = useCustomFontStore((state) => state.fonts);
  const viewSettings = getViewSettings(bookKey);
  const view = getView(bookKey);
  const [fontCategory, setFontCategory] = useState(viewSettings?.defaultFont ?? 'Serif');
  const [serifFont, setSerifFont] = useState(viewSettings?.serifFont ?? 'Bitter');
  const [sansSerifFont, setSansSerifFont] = useState(viewSettings?.sansSerifFont ?? 'Roboto');

  useEffect(() => {
    setFontCategory(viewSettings?.defaultFont ?? 'Serif');
    setSerifFont(viewSettings?.serifFont ?? 'Bitter');
    setSansSerifFont(viewSettings?.sansSerifFont ?? 'Roboto');
  }, [bookKey, viewSettings?.defaultFont, viewSettings?.sansSerifFont, viewSettings?.serifFont]);

  const filterAvailableFonts = useCallback(
    (font: string) =>
      !['android', 'linux'].includes(getOSPlatform()) || !NON_FREE_FONTS.includes(font),
    [],
  );
  const customFonts = useMemo(
    () =>
      Array.from(
        new Set(
          customFontRecords
            .filter((font) => font.loaded && !font.error && !font.deletedAt)
            .map((font) => font.family || font.name),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [customFontRecords],
  );
  const serifOptions = useMemo(
    () =>
      Array.from(new Set([serifFont, ...customFonts, ...SERIF_FONTS.filter(filterAvailableFonts)])),
    [customFonts, filterAvailableFonts, serifFont],
  );
  const sansSerifOptions = useMemo(
    () =>
      Array.from(
        new Set([sansSerifFont, ...customFonts, ...SANS_SERIF_FONTS.filter(filterAvailableFonts)]),
      ),
    [customFonts, filterAvailableFonts, sansSerifFont],
  );
  const selectedFont = fontCategory === 'Sans-serif' ? sansSerifFont : serifFont;
  const selectedFontOptions = fontCategory === 'Sans-serif' ? sansSerifOptions : serifOptions;
  const selectedGenericFamily = fontCategory === 'Sans-serif' ? 'sans-serif' : 'serif';

  const handleFontCategoryChange = useCallback(
    (category: string) => {
      setFontCategory(category);
      saveViewSettings(envConfig, bookKey, 'defaultFont', category);
    },
    [bookKey, envConfig],
  );

  const handleFontFaceChange = useCallback(
    (font: string) => {
      if (fontCategory === 'Sans-serif') {
        setSansSerifFont(font);
        saveViewSettings(envConfig, bookKey, 'sansSerifFont', font);
      } else {
        setSerifFont(font);
        saveViewSettings(envConfig, bookKey, 'serifFont', font);
      }
    },
    [bookKey, envConfig, fontCategory],
  );

  const handleFontSizeChange = useCallback(
    (value: number) => {
      saveViewSettings(envConfig, bookKey, 'defaultFontSize', value);
    },
    [envConfig, bookKey],
  );

  const handleMarginChange = useCallback(
    (value: number) => {
      const currentViewSettings = getViewSettings(bookKey);
      if (!currentViewSettings) return;

      const { MAX_MARGIN_PX, MAX_GAP_PERCENT } = MARGIN_CONSTANTS;
      const marginPx = Math.round((value / 100) * MAX_MARGIN_PX);
      const gapPercent = Math.round((value / 100) * MAX_GAP_PERCENT);

      currentViewSettings.marginTopPx = marginPx;
      currentViewSettings.marginBottomPx = marginPx / 2;
      currentViewSettings.marginLeftPx = marginPx / 2;
      currentViewSettings.marginRightPx = marginPx / 2;

      saveViewSettings(envConfig, bookKey, 'gapPercent', gapPercent, false, false);
      view?.renderer.setAttribute('margin', `${marginPx}px`);
      view?.renderer.setAttribute('gap', `${gapPercent}%`);

      if (currentViewSettings?.scrolled) {
        view?.renderer.setAttribute('flow', 'scrolled');
      }
    },
    [envConfig, bookKey, view, getViewSettings],
  );

  const handleLineHeightChange = useCallback(
    (value: number) => {
      saveViewSettings(envConfig, bookKey, 'lineHeight', value / LINE_HEIGHT_LIMITS.MULTIPLIER);
    },
    [envConfig, bookKey],
  );

  const handleOpenSettings = useCallback(() => {
    setHoveredBookKey('');
    setSettingsDialogBookKey(bookKey);
    setRequestedPanel('Font');
    setSettingsDialogOpen(true);
  }, [
    bookKey,
    setHoveredBookKey,
    setSettingsDialogBookKey,
    setRequestedPanel,
    setSettingsDialogOpen,
  ]);

  const getMarginProgressValue = useCallback((marginPx: number, gapPercent: number) => {
    const { MAX_MARGIN_PX, MAX_GAP_PERCENT, MARGIN_RATIO } = MARGIN_CONSTANTS;
    return (marginPx / MAX_MARGIN_PX + gapPercent / MAX_GAP_PERCENT) * MARGIN_RATIO;
  }, []);

  const classes = clsx(
    'footerbar-font-mobile not-eink:bg-base-200 eink:bg-base-100 absolute flex w-full flex-col items-center gap-y-6 px-4 transition-all',
    'eink:border-base-content eink:border-t',
    !forceMobileLayout && 'sm:hidden',
    // Paddings stay constant in both states (the slide is transform-only) so
    // offsetHeight always reports the panel's settled height; the TTS mini
    // player measures it to stack above the expanded panel.
    'pb-4 pt-8',
    actionTab === 'font'
      ? 'pointer-events-auto translate-y-0 ease-out'
      : 'pointer-events-none invisible translate-y-full overflow-hidden ease-in',
  );

  return (
    <div
      className={classes}
      style={{
        bottom: appService?.isAndroidApp
          ? `calc(env(safe-area-inset-bottom) + 64px)`
          : bottomOffset,
        ...insetStyle,
      }}
    >
      <div className='flex w-full items-end gap-3'>
        <label className='flex min-w-0 flex-1 flex-col gap-1.5 text-sm'>
          <span className='text-base-content/70'>{_('Font Category')}</span>
          <select
            aria-label={_('Font Category')}
            className='select eink-bordered bg-base-100 h-11 min-h-11 w-full'
            value={fontCategory}
            onChange={(event) => handleFontCategoryChange(event.target.value)}
          >
            <option value='Serif'>{_('Serif Font')}</option>
            <option value='Sans-serif'>{_('Sans-Serif Font')}</option>
          </select>
        </label>
        <label className='flex min-w-0 flex-[1.35] flex-col gap-1.5 text-sm'>
          <span className='text-base-content/70'>
            {_(fontCategory === 'Sans-serif' ? 'Sans-Serif Font' : 'Serif Font')}
          </span>
          <select
            aria-label={_(fontCategory === 'Sans-serif' ? 'Sans-Serif Font' : 'Serif Font')}
            className='select eink-bordered bg-base-100 h-11 min-h-11 w-full'
            style={{ fontFamily: `'${selectedFont}', ${selectedGenericFamily}` }}
            value={selectedFont}
            onChange={(event) => handleFontFaceChange(event.target.value)}
          >
            {selectedFontOptions.map((font) => (
              <option
                key={font}
                value={font}
                style={{ fontFamily: `'${font}', ${selectedGenericFamily}` }}
              >
                {font}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Slider
        label={_('Font Size')}
        initialValue={viewSettings?.defaultFontSize ?? FONT_SIZE_LIMITS.DEFAULT}
        bubbleLabel={`${viewSettings?.defaultFontSize ?? FONT_SIZE_LIMITS.DEFAULT}`}
        minLabel='A'
        maxLabel='A'
        minClassName='text-xs'
        maxClassName='text-base'
        onChange={handleFontSizeChange}
        min={FONT_SIZE_LIMITS.MIN}
        max={FONT_SIZE_LIMITS.MAX}
      />
      <div className='flex w-full items-center justify-between gap-x-6'>
        <Slider
          label={_('Page Margin')}
          initialValue={getMarginProgressValue(
            viewSettings?.marginTopPx ?? 44,
            viewSettings?.gapPercent ?? 5,
          )}
          bubbleElement={<TbBoxMargin size={marginIconSize} />}
          minLabel={_('Small')}
          maxLabel={_('Large')}
          step={10}
          onChange={handleMarginChange}
        />
        <Slider
          label={_('Line Spacing')}
          initialValue={(viewSettings?.lineHeight ?? 1.6) * LINE_HEIGHT_LIMITS.MULTIPLIER}
          bubbleElement={<RxLineHeight size={marginIconSize} />}
          minLabel={_('Small')}
          maxLabel={_('Large')}
          min={LINE_HEIGHT_LIMITS.MIN}
          max={LINE_HEIGHT_LIMITS.MAX}
          onChange={handleLineHeightChange}
        />
      </div>
      {/* The negative margin halves the gap above this row: the sliders are
          peers of each other, this is a trailing escape hatch and reads better
          tucked closer. `self-end` follows `dir`, so it mirrors in RTL. */}
      <button
        type='button'
        className='btn btn-ghost btn-sm text-base-content/70 -mt-2 h-8 min-h-8 gap-1.5 self-end px-2 font-normal'
        onClick={handleOpenSettings}
      >
        <PiGear size={16} />
        {_('More Settings')}
      </button>
    </div>
  );
};
