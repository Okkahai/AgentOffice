# Design system

Black terminal minimalism with precise, structured interaction. A development instrument, not a dashboard.
Tokens live at the top of `ui/style.css`; change them there, never inline.

## Colour (meaning only)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#090b0d` | app background |
| `--surface` / `--raised` | `#101316` / `#171b1f` | inputs, graph canvas / selected rows, buttons |
| `--line` / `--line-soft` | `#293038` / `#1c2126` | panel borders / row separators |
| `--text` / `--text-2` / `--text-3` | `#e7e9ea` / `#9299a1` / `#626c75` | primary / secondary / labels and empty states |
| `--ok` | `#78b9a2` | passed, approved, completed, exited 0 |
| `--warn` | `#c8a66c` | blocked, attention count, warnings |
| `--err` | `#d47b7b` | failed, conflict, blocking finding, destructive buttons |
| `--info` | `#82afc2` | in progress (running, verifying, reviewing, merging), focus ring |

A colour that does not carry one of these meanings is not used. No gradients, glows, glass, scanlines.

## Type
- UI text: Inter, falling back to Segoe UI Variable / system UI. 13 px base, 16 px view titles, 600 weight max.
- Technical text: JetBrains Mono, falling back to Cascadia Mono / Consolas. Ids, branches, SHAs, timestamps, tags, section labels, terminal. Tabular numerals.
- Section labels: 11 px mono, uppercase, 0.08em tracking, `--text-3`.

## Components
- **Status tag**: `[RUNNING]`, `[EXITED 0]`, `[BLOCKED]`. Mono 11 px, brackets in `--text-3`, word in its meaning colour. The only TUI ornament used throughout.
- **Tables** over cards. Hairline separators, hover = `--surface`, selection = `--raised`.
- **Pipeline strip**: seven stages, one number each; zero is muted, failures red, done green.
- **Task graph**: layered left to right by dependency depth, 216 x 46 nodes, 2 px status bar on the left edge, thin curved edges. No animation.
- **Inspector**: right panel, resizable (340 to 1100 px), tabs Terminal / Diff / Review / Events. Terminal is real PTY output in xterm.js.
- **Activity panel**: bottom, resizable and collapsible, filter + severity select, newest first, bounded to 400 rows (full trail is in SQLite).
- **Command palette**: Ctrl/Cmd+K, word-prefix search over views, tasks and actions.

## Spacing and shape
4 / 8 / 12 / 16 / 24 px scale. Radius 3 to 4 px (6 px for the palette). Borders 1 px.

## Motion
None, except the browser's own focus and hover changes. State changes are shown by text and colour, never by animation.

## Keyboard
Ctrl/Cmd+K palette, Alt+1..7 views, Alt+A activity panel, Alt+B sidebar, Esc closes the palette or inspector, Enter submits a goal (Shift+Enter for a newline). Shortcuts are ignored while focus is in an input or the terminal.

## Rules from the brief
No pixel art, characters, rooms or decorative ASCII. No fake progress, metrics or activity: every number and state comes from stored rows or events.
