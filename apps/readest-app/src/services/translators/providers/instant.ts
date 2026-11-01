// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-31 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Instant machine translation on the device: the Bergamot engine (public/bergamot, MPL-2.0)
// with Firefox Translations models mirrored on the deployment's library CDN
// (`<libraryFilesUrl>/meta/mt-registry.json`). No text leaves the device, so this is the
// one translator a self-hosted library allows. It fills the gap while a high-quality
// translation is being prepared; models download once (~15 MB per language) and are cached.
import { getRuntimeConfig } from '@/services/runtimeConfig';
import type { TranslationProvider } from '../types';

interface BergamotResponse {
  target: { text: string };
}
interface BergamotTranslator {
  translate(request: {
    from: string;
    to: string;
    text: string;
    html: boolean;
    priority?: number;
  }): Promise<BergamotResponse>;
}
interface ModelFile {
  name: string;
  size: number;
  expectedSha256Hash: string;
}
type Registry = Record<string, Record<string, ModelFile>>;

const MODEL_CACHE = 'librebooks-mt-models-v1';

export const getInstantRegistryUrl = (): string | null => {
  const files = getRuntimeConfig()?.libraryFilesUrl;
  return files ? `${files}/meta/mt-registry.json` : null;
};

let registryPromise: Promise<Registry> | null = null;
const loadRegistry = (): Promise<Registry> => {
  const url = getInstantRegistryUrl();
  if (!url) return Promise.reject(new Error('instant_translation_not_configured'));
  registryPromise ??= fetch(url, { credentials: 'omit' })
    .then((res) => {
      if (!res.ok) throw new Error(`mt_registry_${res.status}`);
      return res.json() as Promise<Registry>;
    })
    .catch((error) => {
      registryPromise = null;
      throw error;
    });
  return registryPromise;
};

const lang2 = (code: string) => code.toLowerCase().split(/[-_]/)[0]!;

/** Languages instant translation can produce from English (empty when not configured). */
export const getInstantTargets = async (): Promise<string[]> => {
  try {
    return Object.keys(await loadRegistry())
      .filter((pair) => pair.startsWith('en'))
      .map((pair) => pair.slice(2));
  } catch {
    return [];
  }
};

export const isInstantSupported = async (from: string, to: string): Promise<boolean> =>
  lang2(from) === 'en' && (await getInstantTargets()).includes(lang2(to));

const sha256 = async (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/** A model file: from the device cache, else downloaded, unzipped and checked. */
const fetchModelFile = async (url: string, checksum?: string): Promise<ArrayBuffer> => {
  const cache =
    typeof caches !== 'undefined' ? await caches.open(MODEL_CACHE).catch(() => null) : null;
  const cached = await cache?.match(url);
  if (cached) return cached.arrayBuffer();
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok || !res.body) throw new Error(`mt_model_${res.status}`);
  const buffer = url.endsWith('.gz')
    ? await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : await res.arrayBuffer();
  // crypto.subtle needs a secure context; the app's own origin may not count as one.
  if (checksum && crypto?.subtle && (await sha256(buffer)) !== checksum)
    throw new Error('mt_model_checksum');
  await cache?.put(url, new Response(buffer.slice(0))).catch(() => undefined);
  return buffer;
};

let translatorPromise: Promise<BergamotTranslator> | null = null;
const loadTranslator = (): Promise<BergamotTranslator> => {
  translatorPromise ??= (async () => {
    const registryUrl = getInstantRegistryUrl();
    if (!registryUrl) throw new Error('instant_translation_not_configured');
    // The engine is a plain ES module served from /bergamot (not bundled): it starts its own worker.
    const engine = (await import(
      /* webpackIgnore: true */ `${location.origin}/bergamot/translator.js`
    )) as {
      TranslatorBacking: new (options: object) => object;
      BatchTranslator: new (options: object, backing: object) => BergamotTranslator;
    };
    class CdnBacking extends engine.TranslatorBacking {
      async fetch(url: string, checksum?: string) {
        return fetchModelFile(url, checksum);
      }
    }
    const options = { registryUrl, workers: 1, batchSize: 8, downloadTimeout: 0 };
    return new engine.BatchTranslator(options, new CdnBacking(options));
  })().catch((error) => {
    translatorPromise = null;
    throw error;
  });
  return translatorPromise;
};

export const instantProvider: TranslationProvider = {
  name: 'instant',
  label: 'Instant (on device)',
  concurrency: 4,
  translate: async (texts, sourceLang, targetLang) => {
    const from = !sourceLang || sourceLang.toUpperCase() === 'AUTO' ? 'en' : lang2(sourceLang);
    const to = lang2(targetLang);
    if (from === to) return texts;
    if (!(await isInstantSupported(from, to))) throw new Error(`instant_unsupported_${from}_${to}`);
    const translator = await loadTranslator();
    return Promise.all(
      texts.map((text) =>
        text.trim()
          ? translator.translate({ from, to, text, html: false }).then((r) => r.target.text)
          : Promise.resolve(text),
      ),
    );
  },
};
