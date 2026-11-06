# Interface mode: the mascot as the harness' main view

Status: implemented in 2.8.0 · applies to the **web client half** of the plugin
(`dsh/client.js`) plus one host route (`dsh/index.js`) and one config key
(`dsh/config.js`).

## Goal

Let the mascot be the face of the harness: a full-window view with her chat and
her sprite, while DeepSeek Harness keeps running behind it (sessions, tools,
Telegram). The normal GUI must still be one click away, and the default must stay
the current behaviour.

## What API the checkout actually exposes

Researched against the installed build (DSH Desktop **0.2.2-rc.1**,
`resources/app.asar`) before writing any code. The relevant sources are the
package references shipped inside the asar:

- `dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/README.md` (window chrome:
  frame, columns, panels, `ctx.layout`)
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-workspace/README.md` (slot
  registration policy: `slots.inject` + `slots.register`)
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/README.md` and
  `lib/client.js` (a real global-panel consumer: it registers a `main` panel and
  calls `ctx.layout.selectPanel(id)`)
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-slots` (bundled package; the
  `ctx.slots` service: `inject`, `register`, `entries`, `provideRoot`)

### What a client plugin is

Client plugins are **not** plain ESM imports from the harness. They are lazy-CJS
bundles loaded by the web app's module loader:

```js
window.__ModuleLoader__.load({
  id: 'dsh-whale-maid-mascot',
  factory(require) {
    const module = { exports: {} }
    // ... use require('react') and the injected services ...
    module.exports.apply = function apply(ctx) { /* ... */ }
    module.exports.inject = ['slots', 'layout', /* ... */]
    return module.exports
  },
})
```

The factory's `require` resolves only the loader's implicit externals (for
example `react`); it does **not** load arbitrary npm packages or the harness'
source modules.

### Is there a public "surface" API?

There is no noun called "surface". The public, documented way to own a view is a
**global panel**:

| Piece | Contract |
| --- | --- |
| Declare/contribute to a slot | `ctx.slots.inject('<slot>', () => ctx.slots.register({ name, ... }, Component))`; the contribution is withdrawn if the slot declaration collapses and re-added when it returns. |
| The view slot | the root-scoped, **keyed** `main` slot. `conversation` is the reserved key for the Conversation; any other `key` is a global panel. |
| Switch views | `ctx.layout.selectPanel('<key>')`, or `ctx.layout.selectPanel(null)` to return to the Conversation. It throws if the panel is not registered. |
| Window chrome | `ctx.layout.toggleSidebar()` (the same action as Mod+B), `ctx.layout.openRightbar/closeRightbar`, `ctx.layout.beginNavigation()`. |
| Overlay layer | `shell.overlay`: root-scoped slot, `position:absolute; inset:0; z-index:20`, children get `pointer-events:auto`; the frame's documented layer for frame-wide content (used by dialogs). |
| Other root seats | `shell.bottom` (full-width row under the columns, empty by default), `shell.leading` (macOS window-chrome seat). |

Layout facts that shaped the design (from the ui-layout README and its CSS):

- the frame is a three-column CSS grid (`sidebar | center | rightbar`) with the
  `main` panel living in the centre column and its own `overflow:hidden`;
- the sidebar keeps a 56 px rail when collapsed at ≥768 px, so "collapse the
  sidebar" alone does **not** produce a true edge-to-edge view;
- `shell.overlay` covers the whole frame (including the rail and the columns)
  but stays under the frame's title-bar strip: on Windows the frame reserves
  `--dsh-windows-titlebar-height` above the columns through a `:before` drag
  strip, and the overlay layer starts at the frame's padding box;
- `selectPanel` is in-memory state: **there is no URL/deep-link for panels**. The
  docs explicitly say layout state resets on reload. A "start in this view"
  preference therefore has to come from the plugin's own configuration, not from
  a route.

### The chosen approach (least invasive, public API only)

1. **Host config** `interfaceMode: 'classic' | 'fullscreen'` in
   `~/.dsh/whale-maid.json`, default `classic`. The host serves it to the browser
   through `GET /whale-maid-mascot/interface` (`{ mode, personaName }`), so the
   preference is host-side and applies to every browser that opens the harness.
2. **Client** registers a global panel `main` with `key: 'whale-maid'` directly
   through `ctx.slots.register(...)` inside a try/catch (never
   `ctx.slots.inject('main', …)`: waiting on a slot the build does not declare
   keeps the client entry in `loading` and aborts the app boot). The panel does
   **not** reimplement chat or sessions: on mount it moves the two nodes the
   plugin already owns — `.wm-root` (mascot) and `.wm-chat` (the chat panel) —
   into its own stage, with plugin-scoped CSS
   (`html[data-whm-interface="fullscreen"] .wm-surface-*`). On unmount the nodes
   and their inline styles are restored to `<body>`. If the harness does not
   declare `main`, the registration is skipped and the overlay fallback is used.
3. In fullscreen mode the client calls `ctx.layout.selectPanel('whale-maid')`,
   collapses the sidebar through `ctx.layout.toggleSidebar()` (only when it was
   expanded; the previous state is restored on exit), and closes the right panel
   when possible.
4. `interfaceMode: 'fullscreen'` makes the client open the panel on load
   (`initInterfaceMode` → `/interface` → `setInterfaceMode`). This is the
   "preference of start" the docs allow; no deep link is invented.
5. **Always reversible:** a `Modo clásico` button in the surface header, and a
   `Pantalla completa` / `Volver al modo clásico` item in the mascot's context
   menu. Both call the same toggle; exit is `selectPanel(null)` plus the sidebar
   restore.
6. **Fallback:** if the harness build does not expose `slots`/`layout` (or React
   is unavailable to the loader), the same surface is appended to `<body>` as a
   plugin-scoped fixed overlay (`z-index: 2147483200`). The mode still works, only
   without the harness-native sidebar collapse. This is the documented
   "CSS scope + start preference" alternative, used only when the public API is
   absent.

### Why not a new route / surface

- The web app renders only the `root` slot; there is no public API to mount a
  whole new URL route or to replace the shell. The only public ways to own the
  window are the keyed `main` slot and `shell.overlay`.
- `shell.overlay` is a frame-wide layer, but it is primarily the dialog layer,
  stays under the title-bar strip, and would need the very same DOM move plus a
  stacking dance with dialogs. Using the `main` panel gives the same result with
  the frame's composition, so the overlay is only used as the fallback.

## Files

| File | Role |
| --- | --- |
| `dsh/config.js` | `DEFAULTS.interfaceMode = 'classic'`, `interfaceModeOf(config)` |
| `dsh/index.js` | `GET /whale-maid-mascot/interface` → `{ mode, personaName }` |
| `dsh/client.js` | `registerInterfaceSurface`, `setInterfaceMode`, `InterfacePanel`, scoped CSS, menu entry, `layout` in `exports.inject` |
| `test/interface-mode.test.mjs` | config default/override and the route's JSON/405 |
| `README.md`, `CHANGELOG.md` | user-facing documentation |

## How to test

The GUI has to be restarted because the client bundles load at boot (`pantry →
Quit`, then reopen). Nothing else is needed; the plugin is installed from this
repo through the profile junction.

1. **Classic is the default.** Without touching anything, the harness opens as
   today: sidebar + conversation + corner mascot. The context menu (right-click
   the mascot) shows `Pantalla completa`.
2. **Enter fullscreen from the UI.** Right-click the mascot → `Pantalla completa`.
   Expected: the sidebar collapses (or its rail), the mascot and the chat panel
   fill the frame, the chat opens, a header reads the persona name with a
   `Modo clásico` button. The harness keeps running: send a message from
   Telegram and it appears in the same chat; tools still work.
3. **Return.** Click `Modo clásico` (or the menu item). Expected: the
   Conversation returns, the sidebar returns to the state it had, the mascot goes
   back to her corner, and the chat keeps its history.
4. **Start in fullscreen.** Set the host config and reopen the harness:
   ```json
   { "interfaceMode": "fullscreen" }
   ```
   in `~/.dsh/whale-maid.json` (next to `personaName`, `workspace`). Expected: the
   harness boots into the mascot panel; `Modo clásico` still works.
5. **API/route check without a browser:**
   ```powershell
   Invoke-RestMethod https://127.0.0.1:53561/whale-maid-mascot/interface
   # -> mode: classic|fullscreen, personaName
   ```
   (the port is the one printed in the DSH Web GUI URL; the request needs the
   same browser session cookie if the harness is token-protected).
6. **Fallback check.** In a build without `slots`/`layout`, the plugin logs
   `interface panel skipped` once and the mode falls back to the body overlay.

## Risks and limits

- **DOM move, not a re-render.** The panel relocates the plugin's own nodes; their
  pointer handlers travel with them, so drag/clamp code still runs. While
  fullscreen, the plugin's CSS wins with `!important`, so inline positions set by
  drag/clamp are visually inert, and the saved inline styles are restored on
  exit. This is the main thing to eyeball if the harness changes.
- **Windows title bar.** The frame reserves the caption strip above the columns;
  the surface starts under it, so the native window controls keep working. The
  surface header is marked `-webkit-app-region: drag` for window dragging.
- **Sidebar heuristic.** Detecting the current state reads the frame's documented
  `data-sidebar-collapsed` attribute (a read-only DOM hint; the change itself goes
  through `ctx.layout.toggleSidebar()`). If a future build renders no
  `data-shell-overlay` layer, the plugin falls back to leaving the sidebar alone
  rather than guessing.
- **Panel selection is in-memory.** Reload returns to the last selection only
  because the plugin re-applies `interfaceMode` from the host config on load; a
  user who toggles at runtime and reloads gets the configured mode again (the
  toggle is intentionally not persisted).
- **Light session unaffected.** The in-page chat still runs in its light
  `-chat` session, now serialized by the per-session mutex from 2.7.0.
- **Not visually verified in this change.** No GUI restart was allowed while
  authoring; the wiring is covered by the host route test and the layout
  contract above, and the manual steps are the acceptance test.
