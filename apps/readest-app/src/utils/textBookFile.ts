// Added 2026-11-04 for the Gutenberg AI fork of Readest (AGPL-3.0); see MODIFICATIONS.md.
// Split out of ./txt so the library page can wrap pasted text without loading the TXT converter.

// First non-empty line of pasted or shared text, as a book title.
export const getTextTitle = (text: string): string =>
  (text.split('\n').find((line) => line.trim()) ?? '').trim().slice(0, 80);

// Wrap pasted or shared text as a .txt file for the normal import path. The
// TXT importer titles the book after the file name, so a blank title falls
// back to the text's first line, then to `fallbackTitle`.
export const createTextBookFile = (text: string, title: string, fallbackTitle: string): File => {
  // "Briefing: today" -> "Briefing - today"; trailing dots and spaces are
  // not allowed in Windows file names.
  const name = (title.trim() || getTextTitle(text))
    .replace(/\s*[<>:"/\\|?*\x00-\x1f]+\s*/g, ' - ')
    .slice(0, 80)
    .replace(/^[\s-]+|[\s.-]+$/g, '');
  return new File([text], `${name || fallbackTitle}.txt`, { type: 'text/plain' });
};
