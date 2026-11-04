# Changelog

> **Provenance:** this repository is a derivative of
> [yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
> by yefeng7531 (MIT, contributor: Amakurai). See [NOTICE](NOTICE). This changelog
> describes the changes made **in this repository** on top of the upstream 1.0.0
> base; it is not the upstream changelog.

## 2.3.0 — 2026-11-03

### Added

- **Optional machine-control tools** (`tools/`, published with the package but
  never loaded by DSH): `hands.ps1` gives the character eyes and hands on
  Windows — window enumeration, screen and per-window capture, background
  capture through `PrintWindow` (no focus theft), mouse and unicode keyboard
  input, a game-foreground brake so input never minimizes a fullscreen game, and
  `-Guard` to abort unless the expected window is active. `cc.ps1` wraps the
  Claude Code CLI headlessly (`ask`, `list`, `logs`, `stop`, `resume`).
  Documented in `tools/README.md`.

## 2.2.0 — 2026-11-03

### Added

- **Whale-chan on Telegram**: a second bundle layer (`dsh/telegram.js`,
  exported as `dsh-whale-maid-mascot/telegram`) that long-polls the Telegram Bot
  API and answers from the shared DSH agent session. Text and photos, live
  streamed replies (one edited message), `/new`, `/status`, `/memory`, `/models`,
  `/model`, `/stop`, and one-time pairing with a local code.
- **One shared session** for both surfaces (`dsh/session.js`): same history,
  same tools, same persona, same memory. The in-page chat now runs real agent
  turns with tools, and reloads the shared transcript when the panel opens.
- **Shared configuration and state** (`dsh/config.js`): `~/.dsh/whale-maid.json`,
  `~/.dsh/whale-maid.state.json`, `~/.dsh/whale-maid.token`. Previous
  `telegram-hermes.*` files are still read for compatibility.
- **Global tools**: `telegram_send` (proactive messages) and `whale_remember`
  (writes into the mascot's long-term memory).

### Changed

- The chat panel timeout went from 60 s to 5 min, for agent turns that use tools.
- Telegram images now reach the model as native attachments; the mascot's chat
  images bypass the old vision gate when the shared session is available.

### Fixed

- Chat images can be enlarged: click opens a full-screen lightbox (`Esc` or a
  click closes it).

## 2.1.0 — 2026-11-03

### Added

- **Long-term memory** (`dsh/memory.js`): she remembers a preferred name, stable
  preferences and durable facts about your projects, and uses them in later
  sessions (chat, ambient lines and check-ins).
  - Explicit cues such as «me llamo…», «recuerda que…» or «prefiero…» are stored
    immediately; every few turns a bounded consolidation pass distils stable
    facts from the recent conversation.
  - Memory is local (`~/.dsh/whale-maid-mascot/memory.json`, override with
    `WHM_MEMORY_DIR`), keyed by a random per-browser id, capped in size, and
    written atomically. Sensitive categories are excluded from extraction.
  - Right-click → **🧠 Memoria** shows what she remembers or clears it;
    `GET/POST /whale-maid-mascot/memory` expose the same operations.
- Host tests for memory storage/validation/prompting (now 23) and a browser test
  for the memory menu (now 25).

## 2.0.2 — 2026-11-03

### Fixed

- The body no longer keeps the drag tilt when the pointer is released outside the
  window (or pointer capture is lost): a window-level pointerup/cancel/blur
  fallback finishes the drag and clears the rotation, and window resizes also
  cancel an in-flight drag.

## 2.0.1 — 2026-11-03

### Fixed

- **Responsive positioning**: the pet now keeps the same relative spot when the
  window changes size, is clamped back on screen on shrink, and the open chat /
  works panels follow the resize too. Saved positions remember the viewport they
  were authored at, so restoring on a different monitor size lands sensibly.
- The sprite scales down on short viewports (≤700 px and ≤560 px tall) and up on
  tall screens (≥1000 px) instead of staying at a fixed pixel size.

## 2.0.0 — 2026-11-03

Companion release: Whale-chan is now a **neutral, friendly companion** instead of a
flirty waifu, and she can share images with you in both directions.

### Changed (breaking)

- **Tone rewrite**: default persona and all bubble copy are neutral and friendly.
  Removed the romantic/tsundere lines, "amo", chest/legs/skirt reactions and body
  jokes. The internal affection counter is now presented as **confianza**
  (trust/confidence).
- Tapping anywhere gets one friendly reaction instead of four body-zone comments;
  10 rapid clicks still get a mild comedic complaint.
- Ambient lines are now companion **check-ins** (`idle` / `check-in` events) driven
  by a configurable proactivity level instead of scripted skits.

### Added

- **Image chat in both directions**: attach images with 📎, clipboard paste or
  drag-and-drop (max 3, 6 MB each); the host admits them through DSH's attachment
  service, sends real `ImageBlock`s to a vision-capable model and echoes them back
  through `GET /whale-maid-mascot/image`. Text-only models get a clear
  `MODEL_NO_VISION` notice instead of a silently blind mascot.
- **Generated SVG cards** (`dsh/doodle.js`, deterministic, zero dependencies):
  progress, celebrate, sticker and doodle kinds, rendered by `POST /whale-maid-mascot/draw`
  and served from `GET /whale-maid-mascot/draw.svg`. The model can request one with
  a `[draw:kind]` tag, the chat header has a 🖼️ button, the right-click menu has
  *Tarjeta de progreso*, and auto-celebration can be toggled.
- **Proactive companion settings** in the right-click menu: proactivity
  (off / low / normal / high) and automatic drawings.
- Host tests grew to 20 (image admission, vision guard, drawing routes, companion
  prompt), browser tests to 22 (image attach/send, card rendering, menu toggles)
  and a new 8-test doodle suite; CI runs the host and doodle suites.
- Regenerated README screenshots with the neutral tone and a generated card.

### Removed

- Flirty/tsundere copy and the anatomical tap zones it depended on.
- Scripted "random skit" lines in favour of context-aware check-ins.

## 1.1.0 — 2026-11-03

First public release of this extended version. It is based on
[yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
v1.0.0 (MIT) and keeps its base interaction model (draggable in-page pet, tap
zones, affection, speech bubbles, outfit switching).

Published on npm as **[`dsh-whale-maid-mascot@1.1.0`](https://www.npmjs.com/package/dsh-whale-maid-mascot)**
(install it from DSH's plugin dialog with the package name).

### Added

- **Chat panel (💬)**: talks to Whale-chan using the DSH-configured model through
  the host's `llm` service; 1–3 sentence replies, last 10 turns of memory,
  draggable panel, `Enter`/`Shift+Enter` input, resets with 🧹. Keys never leave
  the host; falls back to fixed in-character lines when the model is unavailable.
- **Ambient AI lines**: idle, work-start, task-complete, tap-zone and
  artifact/workshop events can be narrated by the model, rate-limited to one AI
  line every 18 s.
- **Workspace panel "Mis trabajos" (👀)**: project/file/deliverable summary for
  the current session workspace, with safe previews for images, PDF and text,
  refresh button and draggable panel.
- **Workspace awareness**: the pet comments on new or updated deliverables
  (max once a minute) and can talk about the user's work in chat.
- **Mood poses**: `school`, `hoodie` and `xiaohei` outfits cut from the author's
  character sheets, in front/side/back views, selected by mood
  (`happy`, `shy`, `angry`, `sad`, `love`, `sleepy`, …). Poses are published
  automatically from `assets/poses/`.
- **Four-outfit cycle** (A maid / D school / E hoodie / F dark) with a hover
  style button and remembered selection.
- **Richer right-click menu**: prompt presets, system notifications,
  explain-term panel (separate hidden session, cleanup when the source session
  is deleted, manual clear), archived-session browser, drag-and-drop session
  archiving/deleting with double confirmation, and random idle skits.
- **Host route unit tests** (14, `node test/host-routes.test.mjs`, no browser or
  DSH required) and a larger Playwright suite (19 browser tests).
- Bilingual English/Spanish README, asset licensing notice
  (`ASSETS-LICENSE.md`), CI workflow for the host tests, and curated screenshots.

### Changed

- Bubble copy, affection levels and reactions reworked and localised in Spanish.
- Workspace routes restricted to the user's home directory, with `..` and
  symlink-escape protection, preview size limits and an 8 s scan cache.
- Poses/persona are data-driven so new outfits and moods can be added without
  touching the client logic.

### Removed

- Q-version (chibi) sprites B/C removed from the outfit rotation.
- One-off asset-preparation scripts with machine-specific paths were dropped
  from the public tree; the declared modifications remain documented in
  `assets/SOURCE.md` and `ASSETS-LICENSE.md`.
