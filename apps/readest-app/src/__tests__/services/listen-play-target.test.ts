import { describe, expect, it } from 'vitest';
import type { ListenOptions } from '@/services/gutenbergLibrary';
import { resolvePlayTarget } from '@/services/listen/playTarget';

const text = (hash: string) => ({ hash, url: `https://cdn.example/${hash}.epub` });

// A group: the default text is work 28885, a recording was built against work 11.
const options = {
  work_id: 28885,
  lang: 'en',
  title: 'Alice',
  text: text('default'),
  recordings: [
    { key: 'librivox-13477', status: 'ready', work_id: 11, text: text('t11') },
    { key: 'librivox-4240', status: 'ready', work_id: 28885, text: text('default') },
    { key: 'librivox-7', status: 'unchecked', work_id: 928, text: text('own928') },
    { key: 'librivox-old', status: 'ready' },
  ],
  ai: {
    available: true,
    status: 'ready',
    key: 'ai-kokoro',
    label: 'AI',
    sample_url: null,
    work_id: 11,
    text: text('t11'),
  },
} as unknown as ListenOptions;

describe('resolvePlayTarget', () => {
  it('plays a recording against the work and text it was built on', () => {
    expect(resolvePlayTarget(options, 'librivox-13477')).toEqual({
      workId: 11,
      text: text('t11'),
      openText: null,
    });
  });

  it('plays a recording of the default text with that text', () => {
    expect(resolvePlayTarget(options, 'librivox-4240')).toMatchObject({ workId: 28885 });
  });

  it('opens the member edition of a recording that is not built yet', () => {
    expect(resolvePlayTarget(options, 'librivox-7')).toEqual({
      workId: 928,
      text: null,
      openText: text('own928'),
    });
  });

  it('plays the AI narration against the work that has it', () => {
    expect(resolvePlayTarget(options, 'ai-kokoro')).toEqual({
      workId: 11,
      text: text('t11'),
      openText: null,
    });
  });

  it('falls back to the page work and text for an older catalog answer', () => {
    expect(resolvePlayTarget(options, 'librivox-old')).toEqual({
      workId: 28885,
      text: text('default'),
      openText: null,
    });
  });
});
