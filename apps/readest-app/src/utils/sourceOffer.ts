// SPDX-License-Identifier: AGPL-3.0-only
// Gutenberg AI fork of Readest (added 2026-10-25): AGPL section 13 source offer.
//
// A modified version served over a network must offer its users the
// Corresponding Source of the running version. The fork's repository comes
// from runtime config (SOURCE_REPOSITORY_URL); the exact commit is baked in at
// build time (NEXT_PUBLIC_SOURCE_COMMIT), so the link always matches the code
// that is running.
import { getRuntimeConfig } from '@/services/runtimeConfig';

export const UPSTREAM_REPOSITORY_URL = 'https://github.com/readest/readest';

const commit = (): string => process.env['NEXT_PUBLIC_SOURCE_COMMIT'] || '';

/** True when this deployment runs a modified version (it names its own repository). */
export const isModifiedVersion = (): boolean => !!getRuntimeConfig()?.sourceRepositoryUrl;

/** URL of the Corresponding Source for the running version. */
export const getSourceCodeUrl = (): string => {
  const repo = (getRuntimeConfig()?.sourceRepositoryUrl || UPSTREAM_REPOSITORY_URL).replace(
    /\/+$/,
    '',
  );
  return commit() ? `${repo}/tree/${commit()}` : repo;
};

export const getSourceCommit = (): string => commit().slice(0, 12);
