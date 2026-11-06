# Changelog

> **Provenance:** this repository is a derivative of
> [yefeng7531/dsh-whale-maid-mascot](https://github.com/yefeng7531/dsh-whale-maid-mascot)
> by yefeng7531 (MIT, contributor: Amakurai). See [NOTICE](NOTICE). This changelog
> describes the changes made **in this repository** on top of the upstream 1.0.0
> base; it is not the upstream changelog.

## 2.10.1 — 2026-11-06

### Changed (la mascota en página se retira)

- **El paquete queda sólo con la ventana de escritorio y el puente de Telegram.**
  Se elimina `dsh.client` del manifiesto: DSH ya no registra ningún entry de
  cliente para este paquete. Motivo: el web boot de DSH audita los entries de
  cliente y **aborta toda la app** por el primero que no quede `active`
  (`web boot: N entries did not activate`), y la edición de 2.10.0 volvió a poner
  `exports.inject` con servicios duros (`workspaces`, `sessions`, `slots`,
  `uiWorkspace`), lo que dejaba el fiber en `failed` y DSH no abría.
- `dsh/client.js` sigue en el repositorio (con `inject` blindado y `apply`
  envuelto para no lanzar nunca) pero DSH no lo carga; lo mismo sus tests de
  navegador. Si algún día se reactiva, ver «Legacy: the in-page mascot» del README.
- Salen del repositorio `docs/interface-mode.md` y las capturas del panel in-page
  (`docs/screenshots/`), que documentaban esa mitad.
- `interfaceMode` (modo `fullscreen` del panel in-page) queda como clave legacy:
  el host la sigue leyendo pero ya no tiene efecto.

### Fixed (arranque de DSH)

- **`dsh/boot-guard.js` (nuevo)**: al aplicar el host, si `dsh/client.js` tuviera
  un `inject` con servicios, lo reescribe a `[]` (dejando
  `client.js.bak-boot-guard`) y lo anota en `~/.dsh/whale-maid.log` como
  `[boot-guard] inject neutralizado`. Es la red bajo la cuerda del `inject`
  blindado del propio bundle.
- **`assets/desktop-window.ps1` vuelve a estar en UTF-8 con BOM.** Sin BOM,
  Windows PowerShell 5.1 lo lee como ANSI, los emoji rompen el parser y la
  ventana moría al instante con `window closed (exit 1)` y sin mensaje.
- **`dsh/desktop.js` restaura el BOM antes de lanzar la ventana** y ahora captura
  `stderr`: si el script no arranca, el error real queda en `whale-maid.log` y no
  sólo el código de salida.
- **`npm run test:boot` + `tools/client-boot-smoke.mjs`**: verifican que el bundle
  de cliente registra su factory, activa de forma sincrónica y declara
  `inject = []`. Falla fuerte si se reintroduce la regresión.
- **`tools/fix-ps1-bom.ps1`**: restaura el BOM y valida la sintaxis de todos los
  `.ps1` del paquete.

### Added (estado de ánimo automático)

- **La imagen sigue la actividad real de la sesión compartida** (`dsh/mood.js`):
  turno activo con herramientas → `cocinando`; con herramienta de lectura →
  `analizando-con-lentes`; turno activo sin herramientas → `comiendo-tokens` (o
  `tomando-notas` si el pedido del usuario es largo y el turno acaba de empezar);
  turno corto terminado → `base`; tarea grande terminada →
  `descansando-en-la-playa`; pregunta de Cala sin respuesta → `dudando-pensativa`;
  silencio > `moodIdleMinutes` (6 por defecto) → `esperando-aburrida`; charla
  casual larga → `flotando-sonando`; `seria-formal` solo con temas delicados
  (legal/médico/dinero) y `celebrando-de-novia` solo con hitos explícitos.
  Ese es también el orden de prioridad; `base` es el fallback ante cualquier duda.
- **Anti-parpadeo**: `MoodTracker` mantiene cada estado al menos `moodMinHoldMs`
  (9 s) antes de cambiar; el motivo sí se actualiza sin tocar `since`.
- **HTTP local**: `GET /whale-maid-mascot/mood` → `{ mood, image, since, reason }`
  y `GET /whale-maid-mascot/chan/<archivo>.png` sirve el pack localmente (sin red
  externa). La ventana WPF hace poll cada 2,5 s y respeta una elección manual del
  menú durante 90 s; el antiguo chat in-page hacía lo mismo con el sprite (esa
  mitad se retiró en 2.10.1, ver arriba).
  Si el host falla, ambos conservan la imagen actual.
- Tests: `test/mood.test.mjs` (12: tabla de casos, prioridad, umbrales e
  histéresis).

### Fixed / Changed (ventana de escritorio)

- **Ctrl+V vuelve a pegar imágenes** en el chat WPF: se intercepta en
  `PreviewKeyDown` (Ctrl+V) y en el evento `DataObject.Pasting` (para pegar desde
  el menú contextual), se aceptan `Clipboard.ContainsImage()` (se guarda a PNG
  temporal y entra como miniatura) y `ContainsFileDropList()` (todas las rutas de
  imagen copiadas desde el explorador). Cada intento deja traza en
  `%TEMP%\cala-window.log`: `clipboard paste: formats=…`, `chat-key:
  paste-detected handled=image|files|text`, y los errores se loguean (antes el
  `catch` los tragaba).
- **Menú contextual compacto**: ancho fijo contenido (200 px, mínimo 176, máximo
  224), padding reducido, tipografía de ítems 11 px y chips 10 px, filas
  izquierda, `ToolTip` con el texto completo y `ScrollViewer` (máx. 420 px) para
  que no se estire con la etiqueta más larga ni pierda ítems.
- **Altura del input redimensionable**: asa superior arrastrable (cursor
  `SizeNS`) entre 64 y 260 px; al soltar guarda `chatInputHeight` en
  `~/.dsh/whale-maid.json` (config host) y se restaura al reabrir la ventana. No
  altera el multilínea, el envío ni el paste.
- **Visor a resolución completa**: la miniatura del burbuja se sigue decodificando
  chica (`DecodePixelWidth` 220/260) para no gastar memoria en el hilo, pero al
  abrir el visor `Load-FullImage` carga una `BitmapImage` nueva **sin**
  `DecodePixelWidth`/`DecodePixelHeight` (`CacheOption = OnLoad`) desde la ruta
  local del outbox o desde el base64 que ya está en memoria, y el `Image` la
  escala `Uniform` con `BitmapScalingMode = HighQuality`. Zoom (rueda), cierre
  (`Esc`, clic fuera, `×`) y el resto de la ventana quedan igual.
- **Visor de imágenes en la ventana WPF**: clic en cualquier miniatura del chat
  (fotos espejadas de Telegram y fotos que manda Alex) abre un visor modal
  maximizado con fondo oscuro semitransparente, imagen escalada `Uniform` para
  caber en pantalla sin deformarse, cursor de mano sobre la miniatura, cierre con
  `Esc`, clic fuera de la imagen o la `×`, y rueda del mouse para zoom simple
  (0.4×–4×). Reutiliza la misma `ImageSource` que ya tiene la burbuja: no
  descarga nada extra. Las fotos enviadas desde la ventana ahora también dejan su
  burbuja local clickeable (antes solo el texto con el conteo).

### Added (espejo de imágenes salientes)

- **Las fotos que Cala manda por Telegram ahora también se ven en casa.** El
  transcript de DSH solo guarda texto, así que `telegram_photo` subía la foto al
  móvil y no dejaba rastro local. Nuevo módulo `dsh/outbox.js`: al enviar, copia la
  imagen a `~/.dsh/whale-maid-outbox/` y registra ruta + metadatos (nombre,
  `mediaType`, caption, `messageId`, fecha) en `~/.dsh/whale-maid.outbox.json` —
  **nunca base64**. `GET /whale-maid-mascot/history` fusiona esos registros como
  mensajes `user` con `image: { id, url, name, mediaType }` (ordenados por fecha,
  sin duplicar el mismo `messageId`, últimos 30) y `GET
  /whale-maid-mascot/outbox-image?id=…` sirve los bytes. Se pintan en el chat
  in-page (`<img>` con lightbox existente) y en la ventana WPF (burbuja con
  miniatura descargada por HTTP local). Es solo espejo local: no se reenvía nada a
  Telegram. Límite: 8 MB por archivo, 40 registros (se borran los más viejos).
  Tests: `test/outbox.test.mjs` (6).

### Fixed (silencio en Telegram y teclado del chat)

- **`SKIP` ya no llega al chat**: cuando el texto final del turno, recortado, es
  exactamente `SKIP` (sin distinguir mayúsculas), el puente de Telegram no envía
  nada: ni mensaje, ni indicador de escritura, ni placeholder de respuesta vacía.
  El filtro vive en `isSilentReply()` y también cubre el streaming (se retienen
  los prefijos `S`/`SK`/`SKI`/`SKIP` hasta saber si el turno es silencioso).
  `SKIP algo` sigue siendo un mensaje real.
- **`Shift+Enter` inserta salto de línea** en el textarea de `.wm-chat`; `Enter`
  sin modificadores sigue enviando. `Ctrl`/`Alt`/`Meta+Enter` también insertan
  el salto en la posición del cursor y el textarea se autoajusta de altura.

### Fixed (ventana de escritorio / puente con Telegram)

- **Espejo a Telegram robusto**: los envíos de la ventana ahora pasan por una cola con un
  único envío en vuelo, se trocean a ≤ 3800 caracteres (Telegram rechaza > 4096) y cada
  resultado se registra (`telegram send ok id=…` / `FAIL http=…`). La respuesta de Cala se
  manda como `reply_to` del mensaje espejado del usuario.
- **Reintentos del chat de la ventana**: si `/chat` se corta por red o por modelo saturado
  se reintenta solo (máx. 2, con espera creciente); un timeout no se reintenta para no
  duplicar turnos en la sesión compartida. El motivo del fallo se muestra en el hilo y en
  `%TEMP%\cala-window.log`.
- **Un solo temporizador de sincronización** cada 3 s (había dos idénticos).
- **No se pierde una respuesta pendiente** al enviar otro mensaje: avisa y espera.
- **El historial reintenta** cuando la primera carga falla (antes quedaba marcado como
  cargado para siempre).
- **Ánimo → sprite** según `personalidades.txt`: pensando/comiendo tokens, dudas, seria,
  flotando, playa, atender.

### Added

- **Pack `Chan`** en `assets/chan/`: 24 sprites PNG con fondo transparente y guía de
  personalidades. La ventana usa un sprite por estado (`base`, `notas`, `lentes`, `seria`,
  `cafe`, `cocina`, `pensando`, `dudas`, `espera`, `flotando`, `playa`, `novia`) y los 4
  trajes con sus 3 vistas (`atender`/`paso`/`espaldas` × `alegre`/`lazo`/`utiles`/`chaleco`);
  se eligen desde el menú contextual (ESTADO / TRAJE / VISTA) y se persisten en
  `desktopChanState`, `desktopChanView` y `desktopChanOutfit`. Cambiar de sprite ya no
  redimensiona la ventana.
- **Imágenes en el chat de la ventana de escritorio**: botón 📎 junto al campo
  (`OpenFileDialog` png/jpg/webp/gif) y arrastrar-y-soltar un archivo sobre la
  ventana (`AllowDrop` + `DragEnter`/`DragOver`/`Drop`). Las elegidas se muestran
  como miniaturas sobre el input con `×` para quitarlas. Al enviar se adjuntan al
  POST de `/whale-maid-mascot/chat` como `images: [{ mimeType, mediaType,
  dataBase64, name }]`, el mismo formato que ya consume `admitChatImages`
  (`body.images`, `mimeType`, `dataBase64`). Límites: 3 imágenes, 6 MB cada una,
  con mensaje legible si el archivo no es imagen o es demasiado grande.

### Fixed

- **Boot crash in the 2.8.0 client (`web boot: 1 entry did not activate —
  dsh-whale-maid-mascot: loading`).** The interface mode used
  `ctx.slots.inject('main', …)` (and earlier `ctx.inject(['layout'])`) to wait
  for harness declarations. On builds that never declare that slot the client
  entry stayed in `loading` and aborted the whole app start. The client now
  **never waits**: the global panel is registered directly with
  `ctx.slots.register({ name: 'main', key })` inside a try/catch, and if the
  slot is absent the fullscreen mode uses the plugin-scoped overlay fallback.
  `layout` is read opportunistically with `ctx.get` only. Covered by
  `test/interface-boot.test.mjs`, which loads the real `dsh/client.js` through
  the renderer's `window.__ModuleLoader__` protocol and asserts `apply()` returns
  `undefined` with no slot/service waiter.
- **Enter in the desktop (WPF) chat window did not send.** The TextBox had
  `AcceptsReturn = $true` and the handler was attached with `Add_KeyDown`: a
  TextBox with `AcceptsReturn` marks Enter handled in its own class handler
  before instance bubbling handlers run, so the plugin handler never fired and
  the control inserted a line break for both Enter and Shift+Enter. The handler
  is now `Add_PreviewKeyDown` (tunneling), checks the real modifier state with
  `Keyboard.IsKeyDown(Left/RightShift|Left/RightCtrl|Left/RightAlt|LWin|RWin)`,
  handles `Key.System` (Alt+Enter) through `SystemKey`, marks the event handled
  and logs every keypress through `Log-Note` (`%TEMP%\cala-window.log`:
  `chat-key: fired key=… systemKey=… mods=… shift=… branch=send|newline`).
  Enter alone sends; Shift/Ctrl/Alt/Win+Enter inserts a line break at the caret.
  Handler exceptions are logged instead of swallowed.

## 2.8.0 — 2026-11-05

### Added

- **`interfaceMode` (`'classic'` by default, or `'fullscreen'`)** — the mascot
  can be the face of the harness instead of a corner pet. In fullscreen mode the
  web client registers a **global panel** in the harness' public `main` slot
  (`ctx.slots.inject('main', …)` + `ctx.slots.register({ name: 'main', key })`,
  switched with `ctx.layout.selectPanel(id | null)`) and collapses the sidebar
  through `ctx.layout.toggleSidebar()`. The panel reuses the plugin's own
  `.wm-root` mascot node and `.wm-chat` node — no chat or session logic is
  reimplemented — and plugin-scoped CSS makes them fill the frame.
- **Start preference served by the host:** `GET /whale-maid-mascot/interface`
  answers `{ mode, personaName }`; the client reads it on load and, when
  `interfaceMode` is `fullscreen`, opens the panel at boot. The configured mode
  is host-side, so it survives reloads and applies to every browser.
- **Always reversible:** a `Modo clásico` button in the surface header and a
  `Pantalla completa` / `Volver al modo clásico` item in the mascot's context
  menu switch modes at runtime (`selectPanel(null)` plus the sidebar restore).
- **Graceful fallback:** when the harness build does not expose `slots`/`layout`
  (or React is not available to the loader), the same surface is appended to
  `<body>` as a plugin-scoped fixed overlay instead of failing.
- `docs/interface-mode.md` documents the researched client-plugin contract, the
  slots used, the alternatives considered (`shell.overlay`, URL route — the
  harness has no public route/panel deep-link and panel selection is in-memory),
  the manual test steps and the risks.
- New tests: `test/interface-mode.test.mjs` pins the `classic` default, the
  normalization and the `/interface` route (JSON shape, persona name, 405).

## 2.7.0 — 2026-11-05

### Fixed

- **Crossed turns between the mascot's surfaces.** The Telegram bridge and the
  periodic review could both call the session controller while the owner was
  writing in the shared conversation, so two turns landed in the same session
  and messages came out interleaved. Now:
  - `askSession()` takes a **per-session mutex** (`withSessionLock`), so every
    turn the plugin starts — review, Telegram, in-page chat — is serialized on
    its session id. Different sessions still run concurrently.
  - the **idle check happens inside the mutex**, re-reading the agent right
    before `prompt()`; queued inbox work (`agent.inbox.nextTurn`/`nextStep`)
    also blocks the prompt until it drains. Before, the status check and the
    prompt were separated by an await, so another turn could slip in.
  - opportunistic turns use `ifBusy: 'skip'`: when the session is busy they are
    skipped, never queued behind a live turn.
  - the review no longer fires while the owner has been active in the shared
    session during the last **10 minutes** (`reviewActivityGuardMs`, configurable
    with a 600000 ms default) or while the shared session has an active/queued
    turn.
  - the 60 s review kickoff can no longer be scheduled twice nor fire on top of
    a recently started review; `reviewBusy` is set synchronously, before any
    await, so two overlapping ticks cannot both pass the guard.
- **Review turns running tools they should not.** The review used to be a full
  agent turn in `<sessionId>-review` and could pick up shell/file tools (and the
  main-conversation digest), which is what crossed the owner's conversation.
  Since 2.7.0 the review is **one bounded, tool-less model call**: no agent
  session, no `prompt()`, no shell, no file tools, only the precomputed digest
  and the recently touched files. Hard budget: one call, `reviewTimeoutMs`
  (60 s default) and `reviewMaxSteps` (2) in the prompt; over budget = silent
  SKIP.
- **Cooldown after a silent review.** `lastProactiveAt` was only updated when
  the review actually sent a message, so a `SKIP` let the next tick re-fire.
  Now every review turn (sent, `SKIP`, empty, error or timeout) records
  `lastProbeAt`; a non-sent outcome starts `reviewSkipCooldownMs` (one hour by
  default, the same as the send cooldown).

### Changed

- **Review cadence: once an hour.** `reviewEveryMs` default is now `3600000`
  (and one hour is the floor, so a smaller configured value is clamped), and
  `reviewCooldownMs` default is `3600000`, applied to sent messages and to
  silent skips alike.
- The review prompt no longer offers tools ("podés usar tus herramientas…") and
  states explicitly that the turn has no shell/file access.
- `waitTurn()` is cancellable, so a prompt that throws no longer leaves a
  15-minute timer behind.

### Added

- **Per-tick audit log.** Every review tick appends one line to
  `~/.dsh/whale-maid.log` with its ISO time, decision (`run`/`skip`), reason
  (`user-active`, `shared-session-busy`, `cooldown-sent`, `cooldown-skip`,
  `unchanged`, `no-target`, …), a `turn outcome` line (`sent`/`skip`/`error`,
  elapsed ms, steps) and the shared-session status/pending counts.
- Config keys: `reviewActivityGuardMs`, `reviewSkipCooldownMs`,
  `reviewDedupeMs`, `reviewTimeoutMs`, `reviewMaxSteps`, `reviewMaxTokens`.
- Tests: `test/session-mutex.test.mjs` (10 tests) pins the serialization,
  idle revalidation, skip-if-busy and queue-depth behaviour;
  `test/review-gating.test.mjs` (12 tests) pins the gating, budgets and prompt;
  `test/telegram-review.test.mjs` (6 tests) covers the bridge wiring and the
  audit log. New `test:unit` npm script runs the node-based suite.

## 2.6.0 — 2026-11-04

### Added

- **The character's own memory** (`selfFacts`, `journal`): deliberate decisions
  and evolution notes about the character herself now live in their own
  sections, separate from the user's facts and preferences. New memory kinds
  accepted everywhere (`whale_remember`, the memory routes and consolidation):
  - `self`: a first-person decision with its reason (what changed, what was
    rejected and why). Deduplicated like facts.
  - `journal`: a dated self-review entry; kept as a bounded rolling list
    (last 12) and shown as entries, not deduplicated.
- Memory prompt and persona blocks separate the two histories: the user
  section ("Memoria persistente del usuario") and the character's own section
  ("Cosas propias de ti") never mix any more.
- `/memory` on Telegram (and the in-page memory panel) also show the self and
  journal sections.
- Memory consolidation can now extract `"propio: …"` lines when the assistant
  herself states a decision about her own persona.

### Changed

- `whale_remember` gained the `self` and `journal` kinds (the enum keeps
  `name`, `fact`, `preference`; unknown kinds still fall back to `fact`).

### Added

- **Light chat session** (`lightChat`, on by default): the in-page chat runs in
  its own session (`<shared session>-chat`) instead of the shared one, so a
  mascot line never queues behind a heavy agent turn. It keeps the same persona
  and the same long-term memory, and each turn appends a short digest of the
  main conversation, so it still knows what is being discussed. Set
  `lightChat: false` to go back to one single session.
- **Proactive review** (`reviewEnabled`, `reviewEveryMs` default 3 min): every
  few minutes the mascot runs a review turn in `<shared session>-review`, sees
  the last messages of the main conversation plus the files touched recently,
  and decides whether writing to the owner is worth it. A `SKIP` reply stays
  silent; `reviewCooldownMs` (default 15 min) stops messages from piling up.
  When nothing changed, it stays quiet for up to 30 minutes at a time.
- **`ownerName`** (default `el dueño`): how the assistant refers to you in the
  conversation digest and the review prompt. It carries no personal data out of
  the box; set it in `~/.dsh/whale-maid.json` to use your name.

### Changed

- The in-page transcript now loads the light chat session, so the panel shows
  its own thread instead of the main conversation.

## 2.4.1 — 2026-11-04

### Changed

- **Neutral packaged default**: `dsh/persona.md` (and its embedded copy in
  `dsh/config.js`) is now a neutral, functional assistant with no character or
  tone. The character is defined per install, in `~/.dsh/persona.md` or with
  `persona` in config; installs that already have one see no change.
  The default is written in Spanish, to match the chat rules.
- **In-page chat uses the same persona**: `dsh/index.js` no longer carries its
  own hardcoded character; the page chat and the ambient lines take the
  persona from `persona.md` (new `personaBody()` in `dsh/config.js`), and the
  chat rules keep only the functional ones (length, mood and draw tags).

## 2.4.0 — 2026-11-04

### Changed

- **Persona extracted to `dsh/persona.md`**: the default character text no
  longer lives inline in `dsh/config.js`; it ships as a file with the name as
  `{{name}}`. `personaText()` resolves, in order: `persona` in config (full
  replacement, as before), a private `~/.dsh/persona.md`, the packaged
  `dsh/persona.md`, and an embedded copy if no file can be read.
- **Backward compatible**: with the same `personaName` and memory, the prompt
  is byte-identical to 2.3.0 (pinned by `test/persona.test.mjs`). Existing
  `persona`/`personaName` settings keep working unchanged.

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
