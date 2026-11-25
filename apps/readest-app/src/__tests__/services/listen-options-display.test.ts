import { describe, expect, it } from 'vitest';
import type { ListenOptions } from '@/services/gutenbergLibrary';
import { getRecordingVersionDetail, getVisibleVersions } from '@/services/listen/optionsDisplay';

const translate = (key: string, values?: Record<string, string>) =>
  key.replace('{{version}}', values?.['version'] ?? '');

const groupedOptions = {
  work_id: 28885,
  lang: 'en',
  title: 'Alice',
  text: null,
  recordings: [
    { key: 'one', work_id: 28885, version_label: 'Illustrated edition' },
    { key: 'two', work_id: 11, version_label: 'Standard text' },
  ],
  ai: { available: false },
  group: {
    primary_id: 28885,
    versions: [
      {
        work_id: 28885,
        label: 'Illustrated edition',
        title: 'Alice illustrated by Arthur Rackham',
        default: true,
        best: {
          kind: 'original',
          lang: 'en',
          hash: 'rackham',
          url: 'https://cdn.example/rackham.epub',
        },
      },
      {
        work_id: 11,
        label: 'Standard text',
        title: "Alice's Adventures in Wonderland",
        default: false,
        best: null,
      },
    ],
  },
} as unknown as ListenOptions;

describe('listen options display', () => {
  it('builds a recording version detail only when multiple versions have recordings', () => {
    expect(
      getRecordingVersionDetail(groupedOptions, groupedOptions.recordings[0]!, translate),
    ).toBe('Read from: Illustrated edition');

    expect(
      getRecordingVersionDetail(
        { ...groupedOptions, group: null },
        groupedOptions.recordings[0]!,
        translate,
      ),
    ).toBe('');

    expect(
      getRecordingVersionDetail(
        { ...groupedOptions, recordings: [groupedOptions.recordings[0]!] },
        groupedOptions.recordings[0]!,
        translate,
      ),
    ).toBe('');
  });

  it('returns only versions with an edition that can be opened', () => {
    expect(getVisibleVersions(groupedOptions)).toEqual([groupedOptions.group!.versions[0]]);
    expect(getVisibleVersions({ ...groupedOptions, group: null })).toEqual([]);
  });
});
