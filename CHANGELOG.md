# Changelog

> **Provenance:** this repository is a derivative of
> [yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
> by yefeng7531 (MIT, contributor: Amakurai). See [NOTICE](NOTICE). This changelog
> describes the changes made **in this repository** on top of the upstream 1.0.0
> base; it is not the upstream changelog.

## 1.1.0 — 2026-11-03

First public release of this extended version. It is based on
[yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
v1.0.0 (MIT) and keeps its base interaction model (draggable in-page pet, tap
zones, affection, speech bubbles, outfit switching).

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
