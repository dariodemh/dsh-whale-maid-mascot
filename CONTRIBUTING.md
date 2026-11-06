# Contributing

Thanks for wanting to improve Whale-chan! This is a small, dependency-free DSH
plugin (no build step), so contributions are easy to review.

## Development setup

```bash
npm install                 # or pnpm install
npx playwright install chromium   # or set WHM_BROWSER_CHANNEL=msedge
node test/host-routes.test.mjs    # fast host route tests
npm test                    # browser tests (starts a local QA server)
```

The browser tests use a local QA page (`test/test.html`) and mock the AI,
workspace and session endpoints; they never touch a real DSH profile, real
sessions or a real model account.

## Guidelines

- **No build step, no new runtime dependencies.** The client is a hand-written
  bundle loaded by DSH's `window.__ModuleLoader__`; keep it that way.
- **Keep DSH compatibility assumptions explicit.** If you rely on a DSH client
  service or internal API, mention it in the PR and add a graceful fallback when
  possible.
- **Tests.** Add or update a host route test for host behaviour and a Playwright
  assertion for visible client behaviour. Doodle changes go with
  `test/doodle.test.mjs`. CI must stay green.
- **Tone.** Whale-chan is a neutral, friendly companion by default. Do not add
  flirting, romantic nicknames, "master/amo" framing, body-related jokes or
  suggestive lines; keep the copy warm but platonic. Tests assert that flirty
  patterns stay out of the companion prompts.
- **Artwork license.** Do not add images that are not covered by a license
  compatible with CC BY-NC-SA 4.0 (non-commercial, share-alike, attribution), and
  update `assets/SOURCE.md` and `ASSETS-LICENSE.md` for any new or modified asset.
  Never add art from other plugins without permission.
- **Privacy.** Do not add telemetry, analytics, extra network calls or routes that
  can read outside the user's home directory. The only outbound traffic must be
  the model calls made through DSH's LLM service.
- **Secrets.** Never commit API keys, tokens, personal paths, session dumps or
  screenshots that contain private workspace content. `shots/` is git-ignored on
  purpose.
- **Code style.** Match the surrounding style (2 spaces, no semicolons in the
  existing source where the file already omits them, small functions, comments
  for non-obvious DSH internals).

## Pull requests

- One logical change per PR, with a clear description of the behaviour change and
  how you tested it.
- For visual changes, attach a screenshot (without private data).
- Code contributions are accepted under the MIT license of this repository (see
  [LICENSE](LICENSE)); artwork contributions must keep the terms in
  [ASSETS-LICENSE.md](ASSETS-LICENSE.md).

## Attribution

This repository is a derivative of
[yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
(MIT). Keep the upstream copyright notice in `LICENSE` when modifying it.

## Boot invariants (please keep these; DSH aborts the whole app otherwise)

DSH audits every web client entry while it boots and throws
`web boot: N entries did not activate` for the first one that is not `active`.
That does not just disable the plugin: the whole desktop app fails to open.

**The in-page half is disabled** (author's decision, 2026-11-06): `package.json`
no longer declares `dsh.client`, so DSH registers no client entry for this
package at all. The host half (the `cordis.patch.yml` rows: desktop window +
Telegram) is unaffected, and the window still uses `/whale-maid-mascot/mood`.

If the client half is ever re-enabled (`dsh.client` back in the manifest), these
two rules are mandatory in `dsh/client.js`:

1. `exports.inject` must be `[]`. A hard list (`workspaces`, `sessions`, `slots`,
   `uiWorkspace`) leaves the fiber `pending`/`failed`, which is exactly the crash.
   Services are resolved defensively through `adoptServices(ctx)` / `serviceOf()`.
   The file also defines `inject` with a getter that ignores later assignments.
2. `exports.apply` must never throw. It is a thin wrapper around `applyInner`
   that catches everything and logs `[whale-maid-mascot] apply falló…`.

Before committing an edit to the client half, run:

```bash
npm run test:boot        # node tools/client-boot-smoke.mjs  -> must print PASS
```

The host half also guards this at runtime (`dsh/boot-guard.js`: it rewrites a
non-empty `inject` list back to `[]` and logs it to `~/.dsh/whale-maid.log`).

For `assets/desktop-window.ps1`: it must stay **UTF-8 with BOM**. Windows
PowerShell 5.1 reads a BOM-less file as ANSI, the emoji break the parser and the
window dies with `exit 1` without any visible error. Run
`tools/fix-ps1-bom.ps1` after editing it. `dsh/desktop.js` restores the BOM
before spawning, but do not rely on that alone.

Old copies live in `_backups/` (git-ignored) precisely so that nobody restores
one of them over the current code: that is how the 2.10.0 regression happened.
