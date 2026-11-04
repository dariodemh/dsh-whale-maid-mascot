# Optional tools: Whale-chan on your machine

Two standalone PowerShell scripts, **not loaded by DSH**. They are what makes the
character able to actually drive a Windows desktop: look at windows, click, type,
and hand work to Claude Code. Nothing here is required to use the mascot or the
Telegram bridge.

Requirements: Windows, Windows PowerShell 5.1 (or `pwsh`), no extra modules.

```powershell
# per call (compiles the P/Invoke helper each time, ~0.5 s)
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\hands.ps1 <cmd> ...

# or once per session for fast repeated use
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\tools\hands.ps1 help
```

## hands.ps1 — eyes and hands

| Command | What it does |
| --- | --- |
| `windows` | visible top-level windows (hwnd, process, class, rect) |
| `fg` | window in the foreground |
| `focus <title>` / `maximize <title>` | bring a window to front / maximize |
| `wrect <title>` | geometry of that window |
| `shot` | capture the whole virtual desktop |
| `wshot <title>` | capture that window (visible part only) |
| `bshot <title>` | **capture in the background without stealing focus** (PrintWindow) |
| `move x y` / `pos` | move / read the cursor |
| `click x y [-Right] [-Double] [-Times n]` | click |
| `drag x1 y1 x2 y2` / `scroll x y n` | drag / wheel |
| `type <text>` | type unicode text (accents fine) |
| `key ctrl+v` / `key alt+tab` | key combination |
| `clip <text>` / `paste` | clipboard |

Safety rules built in:

- **Reading never interferes.** `bshot` uses `PrintWindow`, so a window can be
  read while the user is gaming in the foreground.
- **Writing always takes focus**, and focus minimizes a fullscreen game. So
  `click`/`type`/`key`/`drag`/`scroll` refuse to run when a known game process is
  in the foreground (`-Force` overrides).
- **`-Guard <title>`** aborts before typing unless the expected window is the
  active one. Always pass it.

Verified against Windows 11: screen and window capture, background capture of a
WebView2 app, cursor mapping (DPI 96), 65-character unicode typing, and the game
brake. UI Automation is *not* useful for Electron/WebView2 apps (WhatsApp
Desktop, Claude Desktop): their trees expose only the window buttons, so reading
and driving them means capture + vision.

## cc.ps1 — Claude Code without a GUI

Wraps the `claude` CLI (`claude -p` print mode).

```powershell
.\tools\cc.ps1 ask "question"        # synchronous answer
.\tools\cc.ps1 list                  # background sessions
.\tools\cc.ps1 logs <id>
.\tools\cc.ps1 stop <id>
.\tools\cc.ps1 resume <id> "task"
```

`claude --bg` (background sessions) asks an interactive "do you trust this
folder?" question that cannot be answered without a TTY: accept it once by hand
in a real terminal, or stay with `ask`, which does not ask.
