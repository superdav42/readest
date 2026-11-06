## Fork UX decisions

The application design language remains canonical in `apps/readest-app/DESIGN.md`. This file records
fork-specific product decisions that should survive future upstream merges.

### Mobile reading

- Mobile books open on the reading surface with application controls hidden. A deliberate center tap
  reveals the header and footer; page-turn zones, authored links, selection, highlights, narration
  follow gestures, and keyboard navigation retain their existing meanings.
- Controls dismiss only through an explicit reading-surface action or navigation. Focused controls,
  open menus, settings, and dialogs must not be hidden by a timer.
- The quick typography panel exposes the active serif/sans-serif category, its bundled or custom
  typeface, font size, page margin, and line spacing. It writes the existing per-book view settings,
  keeps the current passage, and leaves the full Font and Layout settings available through More
  Settings.
- Fresh mobile defaults favour non-justified text and comfortable spacing, but quick controls never
  reset saved preferences or force overrides over authored poetry, tables, RTL, or fixed-layout
  content.
- Reader chrome uses existing safe-area, orientation, theme, e-ink, and responsive mechanisms rather
  than introducing a separate mobile shell.
- Independent deployments keep annotation creation, viewing, notes, highlights, and clearing, but do
  not expose annotation-file import or export in reader menus and do not respond to those commands.
  Standard Readest deployments retain the transfer actions.
- Independent deployments do not expose or respond to manual Pair/Manage Audiobook actions. Existing
  pairings remain stored and playable, and catalog-provided narration, read-along highlighting, and
  voice selection keep their standard reader controls.
- Independent deployments do not expose proofreading in the selection toolbar, its customizer, or
  the book menu, and its shortcut cannot open the proofreader or replacement-rule manager. Existing
  rules remain stored and continue to transform content; standard Readest deployments remain unchanged.
- Independent deployments expose a single reading pane and no Parallel Read actions. Opening a saved
  multi-book reader route uses its first book without deleting either library book or changing either
  saved passage; standard Readest deployments retain parallel reading.
