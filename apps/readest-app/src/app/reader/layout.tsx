// Added 2026-11-03 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
import type { Viewport } from 'next';

// The reader has its own pinch-zoom and gestures, so browser zoom stays blocked here only.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function ReaderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
