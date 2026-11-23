// SPDX-License-Identifier: AGPL-3.0-only
// Added 2026-11-23 for the Gutenberg AI fork of Readest; see MODIFICATIONS.md.
//
// What kind of connection the device is on, to decide whether a voice may be downloaded while it
// plays. Unlike `isMetered()` (src/utils/network.ts, false when unknown) the default here is the
// cautious one: callers treat 'unknown' like cellular.
export type ConnectionKind = 'unmetered' | 'cellular' | 'unknown';

interface NetworkInformationLike {
  type?: string;
  saveData?: boolean;
}

export const connectionKind = (): ConnectionKind => {
  if (typeof navigator === 'undefined') return 'unknown';
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!connection) return 'unknown';
  if (connection.saveData === true) return 'cellular';
  if (connection.type === 'wifi' || connection.type === 'ethernet') return 'unmetered';
  if (connection.type === 'cellular') return 'cellular';
  return 'unknown';
};
