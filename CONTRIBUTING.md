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
