// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-20 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// A deployment under its own name (build-time NEXT_PUBLIC_APP_NAME, e.g. Librebooks) swaps the
// product name inside a translated string that names Readest ("Require a PIN to open Readest").
// The name stays in Latin script in every locale, so the translation is kept; with no custom
// name this returns the text unchanged. Same source as APP_NAME in appBrand.ts, read directly so
// a test that mocks appBrand does not need to know about this helper.
const APP_NAME = process.env['NEXT_PUBLIC_APP_NAME'] || 'Readest';

export const brandText = (text: string): string =>
  APP_NAME === 'Readest' ? text : text.replace(/Readest/g, () => APP_NAME);
