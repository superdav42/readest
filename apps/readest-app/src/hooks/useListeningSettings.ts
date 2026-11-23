// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
import { useCallback } from 'react';
import { useEnv } from '@/context/EnvContext';
import { saveSysSettings } from '@/helpers/settings';
import { readListeningSettings, type ListeningSettings } from '@/services/listen/downloadGuard';
import { useSettingsStore } from '@/store/settingsStore';

/** The listening settings with defaults applied, and a setter that persists one field. */
export const useListeningSettings = () => {
  const { envConfig } = useEnv();
  const stored = useSettingsStore((s) => s.settings?.listening);
  const update = useCallback(
    async (patch: Partial<ListeningSettings>) => {
      const current = useSettingsStore.getState().settings?.listening;
      await saveSysSettings(envConfig, 'listening', { ...current, ...patch });
    },
    [envConfig],
  );
  return { listening: readListeningSettings(stored), update };
};
