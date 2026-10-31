// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-10-28 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// A deployment may ship under its own name (build-time NEXT_PUBLIC_APP_NAME, e.g.
// Librebooks). The About window still credits Readest and links the AGPL source.
import { getRuntimeConfig } from '@/services/runtimeConfig';

export const APP_NAME = process.env['NEXT_PUBLIC_APP_NAME'] || 'Readest';
export const APP_TAGLINE =
  process.env['NEXT_PUBLIC_APP_TAGLINE'] || 'Where You Read, Digest and Get Insight';
export const APP_DESCRIPTION = process.env['NEXT_PUBLIC_APP_DESCRIPTION'] || '';
export const APP_URL = process.env['NEXT_PUBLIC_APP_URL'] || 'https://web.readest.com/';

/**
 * A renamed or self-hosted deployment: Readest's own offers and services (Premium, the
 * Readest download, release notes, community and legal pages) don't apply to it.
 */
export const isIndependentDeployment = () =>
  APP_NAME !== 'Readest' || !!getRuntimeConfig()?.selfHosted;
