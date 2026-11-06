# Whale-chan 🐋 — a desktop companion for DeepSeek Harness, with a Telegram twin

Whale-chan (DeepSeek 娘) lives in her own borderless, transparent, always-on-top
window on your desktop: her sprite plus a chat panel. Give her a Telegram bot and
she also answers you from your phone. Both surfaces are **the same character, the
same DSH agent session and the same memory**: a message you send from the phone is
part of the conversation you have in her window, and she can use real DSH tools
(files, shell, search, skills) anywhere.

This is a **research-friendly, MIT-licensed open-source plugin**. It is a
derivative of [yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
— see [NOTICE](NOTICE) and [LICENSE](LICENSE). Bring your own model provider and
your own Telegram bot: nothing is shared with this repository.

## What you get

**Her window**
- A frameless, per-pixel transparent, always-on-top sprite: drag her anywhere,
  pick a size and an outfit, and the position survives restarts.
- **Chat with her in that window**: images in both directions (thumbnails open a
  full-screen viewer with zoom), file picker, drag & drop, **Ctrl+V to paste an
  image**, and a resizable input box (`Enter` sends, `Shift+Enter` is a newline).
- **Tray icon**: show/hide her, open the chat, resize, switch outfit, quit. Closing
  the chat hides her to the tray instead of losing the window.
- **Automatic mood**: her image follows what the shared session is actually doing
  (working, thinking, waiting for you, resting…), with a manual override from the
  menu that holds for a while.
- Everything you type there is mirrored to Telegram, and the replies come back to
  the same thread.

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
- Images she sends or receives are mirrored locally
  (`~/.dsh/whale-maid-outbox/`), so they show up in her window too.
- Whale-chan can save a durable memory from either surface
  (`whale_remember`) and it shows up in the other one.

> **Since 2.10.1 the plugin ships only these two halves.** The old in-page mascot
> that lived in the web UI corner was removed — it could abort the DSH web boot.
> See [Legacy: the in-page mascot](#legacy-the-in-page-mascot).

## Requirements

- DeepSeek Harness Desktop 0.2.1-rc.5 or a compatible build. The plugin is a DSH
  **host** bundle: no web client is registered, so it cannot affect the browser boot.
- **Windows** for the companion window (it is a WPF window driven by Windows
  PowerShell 5.1). The Telegram bridge itself is plain Node and runs wherever DSH
  runs.
- A model provider configured in DSH (any provider the profile already uses).
- Optional, for Telegram: a bot token from [@BotFather](https://t.me/BotFather).
  No public IP, tunnel or webhook is needed: the bridge long-polls Telegram.

## Install

### From npm (recommended)

In DeepSeek Harness: **Settings → Plugins**, install:

```text
dsh-whale-maid-mascot
```

Restart DSH. The window ships **off**; turn it on once:

```json
// ~/.dsh/whale-maid.json
{ "desktopMode": true }
```

Restart DSH and she opens on her own. From then on the tray icon (**Cala**) keeps
her one click away. Without a restart you can also open her with:

```text
GET http://127.0.0.1:<dsh-port>/whale-maid-mascot/desktop?action=open
```

(`action=open`, `close`, `hide` or `toggle`; the port is the one DSH prints at
startup.)

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
| `ownerName` | `el dueño` | How she refers to you in the prompt (a neutral phrase; set your name to personalize it) |
| `persona` | — | Full replacement system prompt (e.g. another language or character) |
| `permissionPreset` | `danger-full-access` | DSH permission preset for the session (`workspace-write` is stricter) |
| `agentPreset` | profile default | Agent preset for the session |
| `sessionId` | `whale-maid` | Shared session id; change it to start a separate conversation |
| `lightChat` | `true` | Run the window chat in a light sibling session instead of the shared one |
| `lightSessionId` | `<sessionId>-chat` | Explicit id for that light session |
| `desktopMode` | `false` | Open her window when DSH starts (the tray icon persists the choice) |
| `desktopWidth` | `260` | Window width in px (120–720, keeps the sprite ratio) |
| `desktopAlwaysOnTop` | `true` | Keep her above other windows |
| `desktopSprite` | `a` | Outfit: `a`, `b` or `c` (and the `poses/` extras from the menu) |
| `desktopX`, `desktopY` | — | Last dragged position (saved automatically) |
| `chatInputHeight` | — | Last chat input height, dragged by the handle above the text box |
| `moodIdleMinutes` | `6` | Silence before she switches to the *waiting* image |
| `moodMinHoldMs` | `9000` | Minimum time a mood image stays before changing (anti-flicker) |
| `reviewEnabled` | `true` | Periodic self-review that may write to you on Telegram on its own |
| `reviewEveryMs` | `3600000` | How often the review looks around; **one hour is the floor**, not just the default |
| `reviewCooldownMs` | `3600000` | Quiet time after she writes on her own **or after a silent SKIP** |
| `reviewActivityGuardMs` | `600000` | No review while you wrote in the shared session less than 10 minutes ago |
| `reviewSkipCooldownMs` | `3600000` | Quiet time after a review that wrote nothing (SKIP, empty, error, timeout) |
| `reviewDedupeMs` | `1800000` | Ignore a review whose digest and files did not change within this window |
| `reviewTimeoutMs` | `60000` | Hard budget for the review call; over budget = silent SKIP |
| `reviewMaxSteps` | `2` | Hard step budget stated to the model (the review has no tools at all) |
| `reviewSessionId` | `<sessionId>-review` | Id used to route/log the review call (it is not an agent session) |
| `reviewRecentFilesMinutes` | `30` | Window of "recently touched files" she inspects |
| `allowedUserIds` | `[]` | Extra Telegram user ids allowed without pairing |
| `tokenEnv` | `TELEGRAM_BOT_TOKEN` | Env var holding the bot token |
| `tokenFile` | `~/.dsh/whale-maid.token` | File holding the bot token |
| `streamReplies` | `true` | Edit a Telegram message live while she writes |
| `model` | profile default | `{ provider, model, reasoningEffort }` fixed for the session |
| `turnTimeoutMs` | `900000` | Max wait for one agent turn |
| `maxPhotoBytes` | `10485760` | Largest Telegram photo she downloads |

### Customize the character

The package ships a neutral assistant (`dsh/persona.md`): no personality, no
tone, just how to use tools and reply in the user's language. To give her a
character:

- **Privately, as a file**: write `~/.dsh/persona.md` (same format, plain text;
  `{{name}}` is optional and is replaced by `personaName`). It survives updates.
- **From the config**: `persona` in `~/.dsh/whale-maid.json` or in the profile
  row, as the full text.
- **Just the name**: `"personaName": "…"` in `~/.dsh/whale-maid.json`.

Precedence: `persona` in config > `~/.dsh/persona.md` > packaged
`dsh/persona.md` > embedded copy of it.

Her window chat and the shared session (Telegram/DSH) read the same persona.

Memory is not part of the text: it lives in
`~/.dsh/whale-maid-mascot/memory.json` and is appended to the end of the prompt
in every case.

### Light session and proactive review

By default the window chat runs in `<sessionId>-chat`, not in the shared
session. Same persona, same `memory.json`, and every turn gets a short digest of
the main conversation appended — so it keeps the thread without paying for (or
queueing behind) a heavy agent turn. Set `lightChat: false` to have one single
session again.

The Telegram bridge also runs a review loop, at most once an hour: the mascot
looks at the last messages of the main conversation and the files touched in the
last `reviewRecentFilesMinutes`, and decides whether writing is worth it. Since
2.7.0 the review is **one bounded, tool-less model call**: it never runs an agent
turn, never gets shell or file tools, and it skips when the shared session has an
active (or queued) turn or when you wrote in the last 10 minutes
(`reviewActivityGuardMs`). If not, it answers `SKIP` and stays silent — and,
unlike before, `SKIP` also starts the cooldown (`reviewSkipCooldownMs`, one hour
by default), so an empty review is not repeated minutes later. Every tick is
appended to `~/.dsh/whale-maid.log` with its time, decision and reason, so the
behaviour can be audited afterwards.

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
│  her WPF window      │◀──HTTP──▶ dsh/index.js (mascot)    │──┐
│  sprite + chat       │        │  /whale-maid-mascot/*     │  │
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
- `dsh/index.js` keeps the mascot features; its chat route uses the light
  session (`lightChat`) and falls back to the shared session or a plain LLM call
  when DSH has no session controller.
- `dsh/desktop.js` spawns and owns the window: `assets/desktop-window.ps1` is a
  standalone WPF script (STA) that renders the sprite, the chat, the tray icon and
  the image viewer, and talks to the host over the local routes.
- `dsh/mood.js` derives one image from the real session activity (pure function,
  unit tested) and `GET /whale-maid-mascot/mood` serves it; the window polls it
  every 2.5 s.
- `dsh/telegram.js` is the Telegram side: long polling, pairing, commands, live
  edits, native image attachments, the periodic self-review, and the
  `telegram_send` / `telegram_photo` / `whale_remember` global tools.
- `dsh/outbox.js` mirrors outbound images locally so the window can show them.

## Development

```sh
node --check dsh/index.js dsh/telegram.js dsh/session.js dsh/config.js
npm run test:host     # host routes with a mocked context
npm run test:unit     # node --test suites (persona, mood, outbox, review, …)
npm run test:boot     # client-entry boot invariant (must print PASS)
```

The package is plain ESM with no build step. `assets/desktop-window.ps1` **must
stay UTF-8 with a BOM**: Windows PowerShell 5.1 reads a BOM-less file as ANSI and
the emoji break the parser, so the window dies on start. `tools/fix-ps1-bom.ps1`
restores it and parse-checks every `.ps1`; `dsh/desktop.js` also fixes the BOM
before spawning, as a safety net.

## Legacy: the in-page mascot

Until 2.9.1 the package also registered a **web client** entry that drew the
mascot in the corner of the DSH web UI. It was removed in **2.10.1**: DSH audits
its client entries while booting and aborts the *whole* app for the first one
that is not `active` (`web boot: N entries did not activate`), which turned any
mistake in that half into "DeepSeek Harness does not start".

The code is still in `dsh/client.js` (plus its browser tests) but the manifest no
longer declares `dsh.client`, so DSH never loads it. To bring it back you would
re-add:

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "inject": [], "platform": "web", "immediately": true }
}
```

…and keep the two invariants that `dsh/client.js` already implements: `inject`
must be empty, and `apply` must never throw. `npm run test:boot` checks the
first, and `dsh/boot-guard.js` rewrites a stray `inject` list at host startup.
`docs/interface-mode.md` (the old global-panel mode) is kept only in git history.

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
