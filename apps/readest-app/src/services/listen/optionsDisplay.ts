// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-24 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
import type { ListenOptions, ListenRecording } from '@/services/gutenbergLibrary';

type Translate = (key: string, values?: Record<string, string>) => string;
type Group = NonNullable<ListenOptions['group']>;
type GroupVersion = Group['versions'][number];

export type VisibleVersion = Omit<GroupVersion, 'best'> & {
  best: NonNullable<GroupVersion['best']>;
};

export const getRecordingVersionDetail = (
  options: ListenOptions,
  recording: ListenRecording,
  translate: Translate,
): string => {
  if (!options.group || !recording.version_label) return '';

  const recordedVersions = new Set(
    options.recordings.map((item) => item.work_id ?? item.version_label).filter(Boolean),
  );
  return recordedVersions.size > 1
    ? translate('Read from: {{version}}', { version: recording.version_label })
    : '';
};

export const getVisibleVersions = (options: ListenOptions): VisibleVersion[] =>
  options.group?.versions.filter((version): version is VisibleVersion => version.best !== null) ??
  [];
