# Whale-chan 🐋 — a DeepSeek Harness companion, in the page and on Telegram

Whale-chan (DeepSeek 娘) lives in the corner of the DeepSeek Harness web UI and,
if you give her a Telegram bot, she also answers you from your phone. Both
surfaces are **the same character, the same agent session and the same memory**:
a message you send from the phone is part of the conversation you have in the
browser, and she can use real DSH tools (files, shell, search, skills) anywhere.

This is a **research-friendly, MIT-licensed open-source plugin**. It is a
derivative of [yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
— see [NOTICE](NOTICE) and [LICENSE](LICENSE). Bring your own model provider and
your own Telegram bot: nothing is shared with this repository.

## What you get

**In the page**
- The mascot: drag her, tap her, four outfits, mood poses, speech bubbles.
- **Chat with her**, with images in both directions, generated cards and doodles.
- **Mis trabajos**: a workspace panel with recent files and previews.
- **Long-term memory**: her preferred name, stable preferences and facts about
  your projects, stored locally in `~/.dsh/whale-maid-mascot/memory.json`.
- Proactive check-ins, archived chats, "explain this term".

**On Telegram**
- Talk to the same character from your phone: text and photos.
- She answers from a **real DSH agent session**, so she can read and write files,
  run commands and use skills — she is not a chatbot bolted onto the UI.
- Replies **stream** into one message (it is edited while she writes).
- Commands: `/new`, `/status`, `/memory`, `/models`, `/model <provider>/<model>`,
  `/stop`, `/help`.
- **Pairing**: the bot ignores everyone by default; you authorize yourself with a
  one-time code.
- Proactive messages: she can message you first once you have written to her
  (Telegram rule), e.g. when a long task finishes.

**Shared brain**
- One DSH session (`whale-maid` by default) backs both surfaces: same history,
  same tools, same prompt section, same memory.
- The in-page chat reloads that transcript when you open the panel, so messages
  sent from Telegram show up there too.
- Whale-chan can save a durable memory from either surface
  (`whale_remember`) and it shows up in the other one.

## Requirements

- DeepSeek Harness Desktop 0.2.1-rc.5 or a compatible build (the plugin is a DSH
  bundle: a host half plus an optional web client).
- A model provider configured in DSH (any provider the profile already uses).
- Optional, for Telegram: a bot token from [@BotFather](https://t.me/BotFather).
  No public IP, tunnel or webhook is needed: the bridge long-polls Telegram.

## Install

### From npm (recommended)

In DeepSeek Harness: **Settings → Plugins**, install:

```text
dsh-whale-maid-mascot
```

Restart DSH. The mascot appears in the bottom-right corner of the web UI and the
Telegram row loads inert (no token yet).

### From a local checkout (development)

1. Copy the package to your DSH plugins folder:

   ```powershell
   robocopy . "$env:USERPROFILE\.dsh\plugins\dsh-whale-maid-mascot" /E /XD node_modules .git
   ```

2. Add it to your profile `package.json` (`~/.dsh/profiles/<profile>/package.json`):

   ```json
   {
     "dependencies": {
       "dsh-whale-maid-mascot": "file:../../plugins/dsh-whale-maid-mascot"
     },
     "dsh": { "profile": { "bundles": ["...", "dsh-whale-maid-mascot"] } }
   }
   ```

3. Restart DSH.

## Configure Telegram

1. Create the bot: talk to **@BotFather**, `/newbot`, pick a name and a username,
   and copy the token it prints.
2. Give the token to the plugin, any of these ways:
   - write it in `~/.dsh/whale-maid.token` (one line, nothing else), or
   - export `TELEGRAM_BOT_TOKEN` before starting DSH, or
   - set `token` in the `whale-maid-telegram` row config.
3. Restart DSH. The plugin writes `~/.dsh/whale-maid.pairing.txt` with a code.
4. In Telegram, open your bot and send:

   ```text
   /pair <code>
   ```

   From then on your account is authorized. Delete the pairing file if you like.

The bridge stores its state (allow-list, pairing code, Telegram offset, shared
session) in `~/.dsh/whale-maid.state.json`.

## Configuration

Optional file `~/.dsh/whale-maid.json` (or the same keys in the
`whale-maid-telegram` row of your profile `cordis.patch.yml`):

| Key | Default | Meaning |
| --- | --- | --- |
| `cwd` | `~/Documents/deepseek-harness/default-workspace` | Directory the shared agent session owns |
| `personaName` | `Whale-chan` | Name she uses for herself in the prompt and messages |
| `persona` | — | Full replacement system prompt (e.g. another language or character) |
| `permissionPreset` | `danger-full-access` | DSH permission preset for the session (`workspace-write` is stricter) |
| `agentPreset` | profile default | Agent preset for the session |
| `sessionId` | `whale-maid` | Shared session id; change it to start a separate conversation |
| `allowedUserIds` | `[]` | Extra Telegram user ids allowed without pairing |
| `tokenEnv` | `TELEGRAM_BOT_TOKEN` | Env var holding the bot token |
| `tokenFile` | `~/.dsh/whale-maid.token` | File holding the bot token |
| `streamReplies` | `true` | Edit a Telegram message live while she writes |
| `model` | profile default | `{ provider, model, reasoningEffort }` fixed for the session |
| `turnTimeoutMs` | `900000` | Max wait for one agent turn |
| `maxPhotoBytes` | `10485760` | Largest Telegram photo she downloads |

## Security

- **The default permission preset is `danger-full-access`**: inside the session
  she can run commands and write files as your OS user. That is what makes her
  useful from a phone; it is also a real permission. Set
  `permissionPreset: workspace-write` for a tighter sandbox (some actions may
  then wait for an approval that a Telegram chat cannot answer).
- The bot ignores every account that is not authorized. Only `/pair` with the
  code (and `/start` for the "you are not authorized" reply) is answered.
- The token is a credential: it lives in a local file or an env var, never in
  logs or in the repository.
- For real isolation, run DSH under a dedicated OS user or in a VM, and point
  `cwd` at the only project the agent should touch.

## How it works

```
┌──────────────────────┐        ┌───────────────────────────┐
│  in-page client.js   │──HTTP──▶ dsh/index.js (mascot)     │──┐
│  chat panel          │        │  /whale-maid-mascot/*     │  │
└──────────────────────┘        └───────────────────────────┘  │   one DSH agent session
                                                               ├──▶  (tools, memory,
┌──────────────────────┐        ┌───────────────────────────┐  │    persona, history)
│  Telegram user       │◀──long─▶ dsh/telegram.js (bridge)  │──┘
│                      │  poll  │  polling, commands, tools │
└──────────────────────┘        └───────────────────────────┘
```

- `dsh/session.js` opens (or resumes) the shared session, applies the permission
  preset, binds the Whale-chan persona section once, sends prompts, waits for
  `turn/end`, and reads the final `assistant/message`.
- `dsh/index.js` keeps the mascot features; its chat route prefers the shared
  session and falls back to a plain LLM call if DSH has no session controller.
- `dsh/telegram.js` is the Telegram side: long polling, pairing, commands, live
  edits, native image attachments, and the `telegram_send` / `whale_remember`
  global tools.
- `dsh/client.js` is the browser half: mascot, chat panel, image lightbox
  (click to enlarge), and it reloads the shared transcript when the chat opens.

## Development

```sh
node --check dsh/index.js dsh/telegram.js dsh/session.js dsh/config.js
```

The package is plain ESM with no build step. Tests for the mascot live in
`test/` (Playwright); the host routes can be exercised with the mocked context in
`test/host-routes.test.mjs`.

## Optional: let her drive your machine

`tools/` ships two standalone Windows PowerShell scripts that are **not** loaded
by DSH. They are for people who want the character to actually operate the
desktop instead of only talking:

- `tools/hands.ps1` — list/focus windows, capture the screen or a single window,
  capture **in the background without stealing focus**, move/click/drag/scroll,
  type unicode text and send key combinations. Writing always takes focus, so
  the script refuses to touch input while a known game is in the foreground, and
  `-Guard <title>` aborts unless the expected window is active.
- `tools/cc.ps1` — headless Claude Code: `ask`, `list`, `logs`, `stop`, `resume`.

See [tools/README.md](tools/README.md). Nothing in `dsh/` depends on them.

## License and provenance

MIT. This repository is a heavily extended derivative of
[yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
(MIT, contributor Amakurai); the original copyright notice is kept in
[LICENSE](LICENSE) and [NOTICE](NOTICE). Character artwork licensing is described
in [ASSETS-LICENSE.md](ASSETS-LICENSE.md).
