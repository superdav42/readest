// Modified 2026-11-04 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
export { parseSmil, parseSmilClock, type SmilPar } from './parseSmil';
export {
  loadMediaOverlaySection,
  MediaOverlaySection,
  type NarrationPar,
} from './MediaOverlaySection';
export { MediaOverlayTTS } from './MediaOverlayTTS';
export {
  audioType,
  MediaOverlayClient,
  MEDIA_OVERLAY_CLIENT_NAME,
  MEDIA_OVERLAY_VOICE_ID,
} from './MediaOverlayClient';
export { findNarratedSection, hasMediaOverlays } from './narratedSections';
