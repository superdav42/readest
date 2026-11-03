// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-03 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// Stand-in for `posthog-js` and `posthog-js/react` in builds made with DISABLE_POSTHOG=true
// (next.config.mjs aliases both here). Self-hosted libraries send no analytics, and the SDK
// (about 180 KB) was part of every page's first load. Same surface as the calls Readest makes;
// nothing is recorded or sent.
import type { ReactNode } from 'react';

const noop = () => undefined;

const posthog = {
  __loaded: false,
  init: noop,
  capture: noop,
  captureException: noop,
  identify: noop,
  reset: noop,
  register: noop,
  register_for_session: noop,
  opt_in_capturing: noop,
  opt_out_capturing: noop,
  has_opted_in_capturing: () => false,
  has_opted_out_capturing: () => true,
};

export default posthog;

export const PostHogProvider = ({ children }: { children: ReactNode; client?: unknown }) =>
  children;
export const usePostHog = () => posthog;
