// Browser half of the dsh whale-maid mascot plugin.
//
// Renders Whale-chan (blue whale maid) in the corner of the DeepSeek Harness
// web page, using the original JPGs the user provided:
//   /whale-maid-mascot/a.png  -> classic maid outfit (style A)
//   /whale-maid-mascot/poses/<outfit>_<view>.png -> licensed outfit poses (D/E/F)
// Non-chibi outfit sprites are cut from the author's own character sheets.
//
// Interactions:
//   - style button (top-left) cycles A maid / D uniform / E hoodie / F dark
//   - 💬 button (top-right) toggles the chat panel; the panel is draggable
//   - 👀 button lists the session workspace ("Mis trabajos") with previews
//   - she comments on new deliverables (polling + task-complete) and on the work
//   - affection system: clicks add points, levels change bubble lines
//   - drag anywhere to move the pet
//   - tap head / chest / legs / skirt for zone-specific comments (AI flavoured)
//   - rapid clicks (10 within 2.6s) make her angry
//   - top-right ✕ collapses to a small restore button
//
// Hand-written in the lazy-CJS bundle protocol used by dsh client plugins
// (window.__ModuleLoader__.load with a factory returning cordis exports),
// so no build step and no imports from dsh client packages are needed.
if (!window.__ModuleLoader__ || typeof window.__ModuleLoader__.load !== 'function') {
  console.warn('[whale-maid-mascot] __ModuleLoader__ missing; client plugin skipped')
} else {
  window.__ModuleLoader__.load({
    id: 'dsh-whale-maid-mascot',
    factory: function (require) {
      var module = { exports: {} }
      var exports = module.exports
      var React = null
      try { React = require('react') } catch (e) {}

      var ASSET_A = '/whale-maid-mascot/a.png'
      var ASSET_B = '/whale-maid-mascot/b.png'
      var ASSET_C = '/whale-maid-mascot/c.png'
      // Non-chibi outfits cut from the author's own character sheets (CC BY-NC-SA 4.0).
      var ASSET_SCHOOL = '/whale-maid-mascot/poses/school_front.png'
      var ASSET_HOODIE = '/whale-maid-mascot/poses/hoodie_front.png'
      var ASSET_XIAOHEI = '/whale-maid-mascot/poses/xiaohei_front.png'
      var STYLE_ASSETS = { a: ASSET_A, b: ASSET_B, c: ASSET_C, d: ASSET_SCHOOL, e: ASSET_HOODIE, f: ASSET_XIAOHEI }
      var STYLE_ORDER = ['a', 'd', 'e', 'f']
      var OUTFIT_BY_STYLE = { d: 'school', e: 'hoodie', f: 'xiaohei' }
      var VIEW_BY_MOOD = {
        neutral: 'front', happy: 'front', love: 'front', surprised: 'front',
        shy: 'side', thinking: 'side', sleepy: 'side',
        angry: 'back', sad: 'back',
      }
      var POSES_MANIFEST_URL = '/whale-maid-mascot/poses.json'
      var CHAT_URL = '/whale-maid-mascot/chat'
      var DRAW_URL = '/whale-maid-mascot/draw'
      var MEMORY_URL = '/whale-maid-mascot/memory'
      var WORKSPACE_URL = '/whale-maid-mascot/workspace'
      var WORKSPACE_FILE_URL = '/whale-maid-mascot/workspace/file'
      var IMAGE_MAX_BYTES = 6 * 1024 * 1024
      var IMAGE_MAX_COUNT = 3
      // Spontaneous-companion cadence: minimum idle time before she starts a
      // conversation on her own. `off` disables proactive bubbles entirely.
      var PROACTIVE_GAPS = { off: 0, low: 9 * 60000, normal: 5 * 60000, high: 2 * 60000 }
      var LS_CHAT = 'dsh-whale-maid-mascot:chat'
      var LS_CHAT_POS = 'dsh-whale-maid-mascot:chat-pos'
      var LS_WORKS_POS = 'dsh-whale-maid-mascot:works-pos'
      var LS_WORKS_ROOT = 'dsh-whale-maid-mascot:works-root'
      var LS_LLM_SESSION = 'dsh-whale-maid-mascot:llm-session'
      var LS_POS = 'dsh-whale-maid-mascot:pos'
      var LS_HIDDEN = 'dsh-whale-maid-mascot:hidden'
      var LS_STYLE = 'dsh-whale-maid-mascot:style'
      var LS_LOVE = 'dsh-whale-maid-mascot:love'
      var LS_EXPLAIN_SESSIONS = 'dsh-whale-maid-mascot:explain-sessions'
      var LS_NOTIF = 'dsh-whale-maid-mascot:notif'
      var LS_PROMPTS = 'dsh-whale-maid-mascot:prompts'
      var LS_PROACTIVE = 'dsh-whale-maid-mascot:proactive'
      var LS_AUTO_DRAW = 'dsh-whale-maid-mascot:auto-draw'
      var LS_USER_ID = 'dsh-whale-maid-mascot:user-id'

      var GREETING_LINES = [
        '¡Hola! ¿En qué andas?',
        'Aquí sigo, por si necesitas algo.',
        '¿Cómo va la cosa?',
        '¡Hola! ¿Un descanso o seguimos?',
        '¿Te echo una mano con algo?',
      ]
      // Tap replies get warmer as confidence grows (level 0..4). No flirting:
      // this is friendly companionship, not a romance.
      var TAP_LINES = [
        ['¿Qué tal? ¿Necesitas algo?', 'Aquí estoy, sin prisa.', '¿Seguimos con lo tuyo?'],
        ['Hola otra vez. ¿Cómo va?', 'Me alegra verte por aquí.', '¿Quieres contarme algo?'],
        ['¿Un respiro? Yo vigilo la pantalla.', 'Va bien la cosa, ¿eh?', 'Si te bloqueas, lo miramos juntos.'],
        ['Me gusta acompañarte mientras trabajas.', '¿Paramos un momento a charlar?', 'Cuando quieras te escucho.'],
        ['Aquí me tienes, como siempre.', '¿Te has tomado un descanso? Yo también paro un poco.', 'Buen trabajo hoy.'],
      ]
      var ANGRY_LINES = [
        '¡Vale, vale! Que me mareas 😵',
        '¡Eh, con cuidado! Que estoy aquí.',
        'Un clic, no diez. Respira.',
      ]
      var STYLE_LINES = {
        a: ['Vuelvo al look de siempre.', 'El vestido de sirvienta otra vez, ¿te gusta?'],
        d: ['Modo uniforme.', 'Cambio al uniforme escolar.'],
        e: ['Sudadera, modo relax.', 'Con la sudadera estoy más cómoda.'],
        f: ['Ropa oscura, por si apetece.', 'Modo ballena nocturna.'],
      }
      var LOVE_LEVELS = [0, 10, 30, 60, 100]
      var LOVE_LEVEL_NAMES = ['Nueva', 'Conocida', 'Compañera', 'Amiga', 'Cercana']
      var SKIT_LINES = [
        '¿Todo bien por ahí?',
        '(Mirando cómo avanzas...)',
        '♪ ~ la la ~ ♪',
        '¿Te apetece un descanso?',
        'Sigo por aquí, sin molestar.',
        'Qué tranquilo está esto hoy.',
      ]
      var SKIT_HIGH_LINES = [
        'Llevas un buen rato concentrado. ¿Todo en orden?',
        'Cuando termines esa parte, cuéntame cómo va.',
        'Si necesitas despejarte, aquí estoy.',
      ]
      var COMMON_PROMPTS = [
        { label: '📝 Resumir la conversación', text: 'Resume los puntos clave de nuestra conversación actual.' },
        { label: '🔍 Revisar código', text: 'Revisa el código del contexto actual y señala posibles problemas y mejoras.' },
        { label: '📖 Explicar término', text: 'Explica de forma sencilla el término o concepto que he seleccionado.' },
        { label: '✏️ Mejorar texto', text: 'Mejora la expresión del siguiente texto para que sea más claro y profesional:' },
        { label: '🧪 Escribir tests', text: 'Escribe tests unitarios para el código actual.' },
      ]

      function getCustomPrompts() {
        try {
          var raw = storeGet(LS_PROMPTS)
          var list = raw ? JSON.parse(raw) : null
          if (Array.isArray(list)) {
            return list.filter(function (p) {
              return p && typeof p.label === 'string' && typeof p.text === 'string'
            })
          }
        } catch (e) {}
        return COMMON_PROMPTS.map(function (p) { return { label: p.label, text: p.text } })
      }

      function saveCustomPrompts(list) {
        try {
          storeSet(LS_PROMPTS, JSON.stringify(list))
        } catch (e) {}
      }

      var root = null
      var bodyWrap = null
      var img = null
      var bubble = null
      var bubbleText = null
      var hideBtn = null
      var styleBtn = null
      var emojiEl = null
      var blushL = null
      var blushR = null
      var restoreBtn = null
      var styleEl = null
      var swapTimer = null
      var bubbleTimer = null
      var emojiTimer = null
      var blushTimer = null
      var reactionTimer = null
      var reboundTimer = null
      var dropTimer = null
      var love = 0
      var loveLevel = 0
      var style = 'a'
      var clickTimes = []
      var drag = { active: false, moved: false, offX: 0, offY: 0, pointerId: 0 }
      var dragTilt = 0
      var lastDragX = 0
      var lastDragY = 0
      var menuEl = null
      var archiveBtn = null
      var newSessionBtn = null
      var archivedListBtn = null
      var explainBtn = null
      var openExplainPanelBtn = null
      var commonPromptBtn = null
      var notifBtn = null
      var aiBtn = null
      var chatBtn = null
      var progressBtn = null
      var memoryBtn = null
      var chatToggleBtn = null
      var notifEnabled = false
      var chatPanelEl = null
      var chatBodyEl = null
      var chatInputEl = null
      var chatSendBtn = null
      var chatClearBtn = null
      var chatCloseBtn = null
      var chatHistory = []
      var chatPending = false
      var chatAbortCtrl = null
      var chatTypingEl = null
      var chatDrawBtn = null
      var chatAttachBtn = null
      var chatFileInput = null
      var chatAttachListEl = null
      var chatAttachments = []
      var proactiveBtn = null
      var autoDrawBtn = null
      var lastInteractionAt = Date.now()
      var lastProactiveAt = 0
      var proactiveTimer = null
      var drawSeq = 0
      var lastViewport = { w: 0, h: 0 }
      var memoryCache = null
      var chatDrag = { active: false, offX: 0, offY: 0, moved: false }
      var bubbleLockUntil = 0
      var zoneSeq = 0
      var llmSessionId = ''
      var worksPanelEl = null
      var worksBodyEl = null
      var worksSummaryEl = null
      var worksPreviewEl = null
      var worksListEl = null
      var worksToggleBtn = null
      var worksBtn = null
      var worksCloseBtn = null
      var worksRefreshBtn = null
      var worksDrag = { active: false, offX: 0, offY: 0, moved: false }
      var workspaceSummary = null
      var workspaceRoot = ''
      var workspaceFiles = null
      var workspaceTimer = null
      var workspacePolling = false
      var lastArtifactAt = 0
      var poseManifest = null
      var moodTimer = null
      var currentMood = 'neutral'
      var chatOpenedOnce = false
      var feedSessionId = null
      var feedArmedAction = null
      var feedArmTimer = null
      var sessionWatchUnsubscribe = null
      var sessionWatchTimer = null
      var lastRunningSessionId = null
      var lastRunningState = null
      var archiveArmTimer = null
      var archiveArmed = false
      var archivedOverlay = null
      var archivedPanel = null
      var archivedListEl = null
      var archivedDetailEl = null
      var archiveDetailSeq = 0
      var idleTimer = null
      var explainMode = false
      var explainBtnEl = null
      var explainPanelEl = null
      var explainPanelBody = null
      var explainPanelTimer = null
      var explainListUnsubscribe = null
      var explainCleanupTimer = null
      var pendingExplainText = ''
      var pendingExplainContext = ''
      var __ctx = null
      var __workspacesSvc = null
      var __wsListSvc = null
      var __sessionsSvc = null

      function ready(fn) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', fn, { once: true })
        } else {
          fn()
        }
      }

      function injectStyles() {
        styleEl = document.createElement('style')
        styleEl.setAttribute('data-whale-maid', '1')
        styleEl.textContent =
          '.wm-root{position:fixed;z-index:2147483000;width:150px;height:244px;' +
          'cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;' +
          'animation:wm-float 3.4s ease-in-out infinite;}' +
          '.wm-root.dragging{cursor:grabbing;animation-play-state:paused;}' +
          '.wm-root.dragging .wm-body{animation-play-state:paused;}' +
          '.wm-root.drop-target{outline:2px dashed #7fb8dc;outline-offset:4px;border-radius:16px;}' +
          '.wm-root.style-c{height:170px;}' +
          '.wm-body{position:absolute;left:50%;bottom:0;transform:translateX(-50%);' +
          'transform-origin:50% 88%;animation:wm-sway 4.4s ease-in-out infinite;}' +
          '.wm-img{display:block;height:230px;width:auto;max-width:140px;object-fit:contain;' +
          'pointer-events:none;' +
          'filter:drop-shadow(0 10px 18px rgba(15,23,42,.28));}' +
          '.wm-bubble{position:absolute;left:50%;bottom:100%;transform:translateX(-50%) translateY(-6px);' +
          'max-width:230px;padding:9px 13px;border-radius:14px;background:#fff;color:#22304a;' +
          'font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;white-space:normal;' +
          'border:2px solid #b9d6ee;box-shadow:0 8px 20px rgba(15,23,42,.18);' +
          'opacity:0;visibility:hidden;transition:opacity .25s ease,transform .25s ease;z-index:3;}' +
          '.wm-bubble.show{opacity:1;visibility:visible;transform:translateX(-50%) translateY(-14px);}' +
          '.wm-btn{position:absolute;width:22px;height:22px;border-radius:50%;' +
          'border:1px solid #cbd5e1;background:#fff;color:#64748b;font:bold 11px/18px Arial;' +
          'cursor:pointer;opacity:0;transition:opacity .15s ease;padding:0;text-align:center;z-index:4;}' +
          '.wm-root:hover .wm-btn{opacity:1;}' +
          '.wm-hide{top:-8px;right:-8px;}' +
          '.wm-style{top:-8px;left:-8px;}' +
          '.wm-chat-btn{top:16px;right:-8px;background:#eff6ff;border-color:#93c5fd;color:#2563eb;font-size:12px;}' +
          '.wm-works-btn{top:40px;right:-8px;background:#f5f3ff;border-color:#c4b5fd;color:#7c3aed;font-size:12px;}' +
          '.wm-emoji{position:absolute;top:1%;left:56%;display:none;font-size:24px;line-height:1;' +
          'z-index:5;pointer-events:none;text-shadow:0 2px 6px rgba(15,23,42,.35);}' +
          '.wm-emoji.show{display:block;animation:wm-emoji-pop .5s ease;}' +
          '.wm-blush{position:absolute;top:12.5%;width:16px;height:11px;border-radius:50%;display:none;' +
          'filter:none;z-index:4;pointer-events:none;}' +
          '.wm-blush.l{left:31%;}.wm-blush.r{left:63%;}' +
          '.wm-blush.show{display:block;}' +
          '.wm-body.style-b .wm-blush{top:30%;}' +
          '.wm-body.style-b .wm-blush.l{left:36%;}' +
          '.wm-body.style-b .wm-blush.r{left:50%;}' +
          '.wm-body.style-b .wm-emoji{top:3%;left:52%;}' +
          '.wm-body.style-c .wm-img{height:auto;width:140px;max-width:140px;}' +
          '.wm-body.style-c .wm-blush{top:30%;}' +
          '.wm-body.style-c .wm-blush.l{left:36%;}' +
          '.wm-body.style-c .wm-blush.r{left:50%;}' +
          '.wm-body.style-c .wm-emoji{top:3%;left:52%;}' +
          '.wm-restore{position:fixed;right:14px;bottom:14px;z-index:2147483000;width:46px;height:46px;' +
          'border-radius:50%;background:rgba(31,43,69,.92);border:2px solid #7fb8dc;color:#fff;' +
          'font-size:24px;line-height:40px;text-align:center;cursor:pointer;' +
          'box-shadow:0 6px 16px rgba(15,23,42,.35);display:none;}' +
          '@keyframes wm-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}' +
          '@keyframes wm-sway{0%,100%{transform:translateX(-50%) rotate(-1.8deg)}' +
          '50%{transform:translateX(-50%) rotate(1.8deg)}}' +
          '@keyframes wm-emoji-pop{0%{transform:scale(0) rotate(-12deg)}60%{transform:scale(1.35) rotate(6deg)}' +
          '100%{transform:scale(1) rotate(0)}}' +
          '@keyframes wm-squish{0%,100%{transform:translateY(0) scale(1)}' +
          '35%{transform:translateY(2px) scale(.96,1.04)}70%{transform:translateY(-6px) scale(1.04,.96)}}' +
          '@keyframes wm-shake{0%,100%{transform:translateX(0)}15%{transform:translateX(-7px)}' +
          '30%{transform:translateX(6px)}45%{transform:translateX(-5px)}60%{transform:translateX(4px)}' +
          '75%{transform:translateX(-3px)}90%{transform:translateX(2px)}}' +
          '@keyframes wm-wobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-6deg)}' +
          '50%{transform:rotate(5deg)}75%{transform:rotate(-3deg)}}' +
          '@keyframes wm-rebound{0%{transform:translateX(-50%) rotate(var(--rebound-from,0deg))}' +
          '55%{transform:translateX(-50%) rotate(var(--rebound-mid,0deg))}' +
          '100%{transform:translateX(-50%) rotate(0deg)}}' +
          '@keyframes wm-drop{0%{transform:translateY(0)}45%{transform:translateY(-12px)}' +
          '70%{transform:translateY(4px)}100%{transform:translateY(0)}}' +
          '.wm-menu{position:fixed;z-index:2147483050;min-width:190px;background:#fff;color:#1e293b;' +
          'border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.25);' +
          'padding:5px;display:none;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;}' +
          '.wm-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;' +
          'border:none;border-radius:8px;background:transparent;color:inherit;font:inherit;' +
          'text-align:left;cursor:pointer;}' +
          '.wm-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));}' +
          '.wm-menu-item.danger{color:#e5484d;}' +
          '.wm-menu-sep{height:1px;margin:4px 8px;background:#e2e8f0;}' +
          '.wm-archive-overlay{position:fixed;inset:0;z-index:2147483100;display:none;' +
          'align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:20px;}' +
          '.wm-archive-panel{width:min(640px,calc(100vw - 40px));max-height:min(80vh,600px);' +
          'background:#fff;color:#1e293b;border-radius:16px;box-shadow:0 24px 60px rgba(15,23,42,.35);' +
          'display:flex;flex-direction:column;overflow:hidden;font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;}' +
          '.wm-archive-header{display:flex;align-items:center;gap:8px;padding:12px 16px;' +
          'border-bottom:1px solid #e2e8f0;font-weight:600;}' +
          '.wm-archive-close{margin-left:auto;border:none;background:transparent;font-size:18px;' +
          'cursor:pointer;color:#64748b;padding:4px 8px;border-radius:8px;}' +
          '.wm-archive-body{overflow:auto;padding:12px 16px;flex:1;}' +
          '.wm-archive-list{display:flex;flex-direction:column;gap:6px;}' +
          '.wm-archive-item{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;' +
          'border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;cursor:pointer;' +
          'text-align:left;font:inherit;}' +
          '.wm-archive-item:hover{border-color:#b9d6ee;background:#f0f7ff;}' +
          '.wm-archive-item .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
          '.wm-archive-item .d{color:#94a3b8;font-size:12px;flex:none;}' +
          '.wm-archive-back{margin-bottom:10px;padding:5px 10px;border:1px solid #cbd5e1;' +
          'border-radius:8px;background:#fff;cursor:pointer;font:inherit;}' +
          '.wm-archive-msg{margin:0 0 12px;padding:10px 12px;border-radius:12px;' +
          'white-space:pre-wrap;word-break:break-word;}' +
          '.wm-archive-msg.user{background:#eef4ff;margin-left:24px;}' +
          '.wm-archive-msg.assistant{background:#f1f5f9;margin-right:24px;}' +
          '.wm-archive-msg.tool{background:#fef9c3;color:#713f12;font-size:13px;}' +
          '.wm-archive-empty{color:#94a3b8;text-align:center;padding:40px 0;}' +
          '.wm-explain-float{position:fixed;z-index:2147483080;padding:6px 12px;border-radius:999px;' +
          'background:#2563eb;color:#fff;border:none;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;' +
          'cursor:pointer;box-shadow:0 6px 18px rgba(37,99,235,.35);display:none;}' +
          '.wm-explain-panel{position:fixed;top:16px;right:16px;bottom:16px;width:380px;max-width:calc(100vw - 32px);' +
          'z-index:2147483090;background:#fff;color:#1e293b;border:1px solid #cbd5e1;border-radius:16px;' +
          'box-shadow:0 24px 60px rgba(15,23,42,.35);display:none;flex-direction:column;overflow:hidden;' +
          'font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;}' +
          '.wm-explain-panel-header{display:flex;align-items:center;gap:8px;padding:12px 16px;' +
          'border-bottom:1px solid #e2e8f0;font-weight:600;}' +
          '.wm-explain-panel-close{margin-left:auto;border:none;background:transparent;font-size:18px;' +
          'cursor:pointer;color:#64748b;padding:4px 8px;border-radius:8px;}' +
          '.wm-explain-panel-cleanup{margin-left:6px;border:none;background:transparent;font-size:15px;' +
          'cursor:pointer;color:#64748b;padding:4px 8px;border-radius:8px;}' +
          '.wm-explain-panel-body{flex:1;overflow:auto;padding:12px 16px;}' +
          '.wm-explain-entry{margin:0 0 12px;padding:10px 12px;border-radius:12px;white-space:pre-wrap;word-break:break-word;}' +
          '.wm-explain-entry.user{background:#eef4ff;margin-left:24px;}' +
          '.wm-explain-entry.assistant{background:#f1f5f9;margin-right:24px;}' +
          '.wm-explain-entry.waiting{color:#94a3b8;font-style:italic;}' +
          '.wm-explain-empty{color:#94a3b8;text-align:center;padding:40px 0;}' +
          '.wm-chat{position:fixed;left:0;top:0;z-index:2147483060;width:330px;max-width:calc(100vw - 24px);' +
          'max-height:min(62vh,520px);background:#fff;color:#1e293b;border:1px solid #cbd5e1;border-radius:16px;' +
          'box-shadow:0 24px 60px rgba(15,23,42,.35);display:none;flex-direction:column;overflow:hidden;' +
          'font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;}' +
          '.wm-chat.open{display:flex;}' +
          '.wm-chat-head{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 12px;' +
          'border-bottom:1px solid #e2e8f0;font-weight:600;flex:none;cursor:move;' +
          'user-select:none;-webkit-user-select:none;touch-action:none;}' +
          '.wm-chat.dragging .wm-chat-head{cursor:grabbing;}' +
          '.wm-chat.dragging{box-shadow:0 30px 70px rgba(15,23,42,.45);}' +
          '.wm-chat-head .who{width:26px;height:26px;border-radius:50%;background:#dbeafe;' +
          'display:flex;align-items:center;justify-content:center;font-size:15px;flex:none;}' +
          '.wm-chat-head .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
          '.wm-chat-head .t small{display:block;font-weight:400;color:#94a3b8;font-size:11px;line-height:1.2;}' +
          '.wm-chat-close,.wm-chat-clear,.wm-chat-draw{border:none;background:transparent;color:#64748b;font-size:15px;' +
          'cursor:pointer;padding:4px 6px;border-radius:8px;flex:none;}' +
          '.wm-chat-close:hover,.wm-chat-clear:hover,.wm-chat-draw:hover{background:#f1f5f9;}' +
          '.wm-chat-body{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;' +
          'min-height:110px;background:#f8fafc;}' +
          '.wm-chat-msg{max-width:86%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;' +
          'word-break:break-word;font-size:13px;line-height:1.45;}' +
          '.wm-chat-msg.user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:4px;}' +
          '.wm-chat-msg.mascot{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;' +
          'border-bottom-left-radius:4px;}' +
          '.wm-chat-msg.sys{align-self:center;background:transparent;color:#94a3b8;font-size:11px;padding:2px 6px;}' +
          '.wm-chat-msg.typing{color:#64748b;font-style:italic;background:#fff;border:1px dashed #cbd5e1;}' +
          '.wm-chat-msg.resend{cursor:pointer;border-color:#fca5a5;}' +
          '.wm-chat-foot{display:flex;gap:6px;padding:8px;border-top:1px solid #e2e8f0;background:#fff;align-items:flex-end;flex:none;}' +
          '.wm-chat-input{flex:1;resize:none;max-height:88px;min-height:34px;padding:7px 10px;' +
          'border:1px solid #cbd5e1;border-radius:10px;font:inherit;outline:none;}' +
          '.wm-chat-input:focus{border-color:#93c5fd;}' +
          '.wm-chat-send{border:none;border-radius:10px;background:#2563eb;color:#fff;padding:8px 12px;' +
          'font:inherit;cursor:pointer;flex:none;}' +
          '.wm-chat-send:disabled{opacity:.5;cursor:default;}' +
          '.wm-chat-hint{padding:0 12px 7px;color:#b6c2d2;font-size:10.5px;text-align:right;}' +
          '.wm-chat-attach{display:flex;align-items:center;gap:6px;padding:6px 8px 0;}' +
          '.wm-chat-attach-btn{border:none;background:#eff6ff;color:#2563eb;border-radius:9px;' +
          'width:30px;height:30px;font-size:14px;cursor:pointer;flex:none;padding:0;}' +
          '.wm-chat-thumbs{display:flex;gap:6px;flex-wrap:wrap;}' +
          '.wm-chat-chip{position:relative;width:42px;height:42px;border-radius:9px;overflow:visible;' +
          'border:1px solid #cbd5e1;background:#fff;flex:none;}' +
          '.wm-chat-chip img{width:100%;height:100%;object-fit:cover;display:block;border-radius:8px;}' +
          '.wm-chat-chip-x{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;' +
          'border:none;background:#1e293b;color:#fff;font-size:10px;line-height:18px;cursor:pointer;padding:0;}' +
          '.wm-chat-img{display:block;max-width:100%;max-height:200px;border-radius:8px;margin-top:6px;cursor:zoom-in;}' +
          '.wm-lightbox{position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.86);display:flex;' +
          'align-items:center;justify-content:center;cursor:zoom-out;padding:16px;}' +
          '.wm-lightbox img{max-width:94vw;max-height:92vh;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.5);display:block;}' +
          '.wm-lightbox-close{position:absolute;top:14px;right:18px;background:none;border:none;color:#fff;font-size:26px;' +
          'line-height:1;cursor:pointer;padding:4px 8px;}' +
          '.wm-chat.wm-drop{outline:2px dashed #93c5fd;outline-offset:4px;}' +
          '.wm-works{position:fixed;left:0;top:0;z-index:2147483062;width:380px;max-width:calc(100vw - 24px);' +
          'max-height:min(68vh,560px);background:#fff;color:#1e293b;border:1px solid #cbd5e1;border-radius:16px;' +
          'box-shadow:0 24px 60px rgba(15,23,42,.35);display:none;flex-direction:column;overflow:hidden;' +
          'font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;}' +
          '.wm-works.open{display:flex;}' +
          '.wm-works-head{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 12px;' +
          'border-bottom:1px solid #e2e8f0;font-weight:600;flex:none;cursor:move;' +
          'user-select:none;-webkit-user-select:none;touch-action:none;}' +
          '.wm-works-head .who{width:26px;height:26px;border-radius:50%;background:#ede9fe;' +
          'display:flex;align-items:center;justify-content:center;font-size:15px;flex:none;}' +
          '.wm-works-head .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
          '.wm-works-head .t small{display:block;font-weight:400;color:#94a3b8;font-size:11px;line-height:1.2;' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
          '.wm-works-close,.wm-works-refresh{border:none;background:transparent;color:#64748b;font-size:15px;' +
          'cursor:pointer;padding:4px 6px;border-radius:8px;flex:none;}' +
          '.wm-works-close:hover,.wm-works-refresh:hover{background:#f1f5f9;}' +
          '.wm-works.dragging .wm-works-head{cursor:grabbing;}' +
          '.wm-works.dragging{box-shadow:0 30px 70px rgba(15,23,42,.45);}' +
          '.wm-works-body{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:#f8fafc;}' +
          '.wm-works-sum{font-size:11.5px;color:#64748b;padding:0 2px;}' +
          '.wm-works-sec{font-size:10.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;' +
          'letter-spacing:.06em;padding:2px 2px 0;}' +
          '.wm-works-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #e2e8f0;' +
          'border-radius:10px;background:#fff;cursor:pointer;text-align:left;font:inherit;width:100%;}' +
          '.wm-works-row:hover{border-color:#b9d6ee;background:#f0f7ff;}' +
          '.wm-works-row.active{border-color:#93c5fd;background:#eff6ff;}' +
          '.wm-works-row .ico{width:28px;height:28px;border-radius:7px;background:#eef4ff;display:flex;' +
          'align-items:center;justify-content:center;font-size:14px;flex:none;overflow:hidden;}' +
          '.wm-works-row .ico img{width:100%;height:100%;object-fit:cover;display:block;}' +
          '.wm-works-row .t{flex:1;min-width:0;}' +
          '.wm-works-row .n{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;}' +
          '.wm-works-row .m{display:block;color:#94a3b8;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
          '.wm-works-preview{border:1px solid #e2e8f0;border-radius:10px;background:#fff;padding:8px;display:none;}' +
          '.wm-works-preview.show{display:block;}' +
          '.wm-works-preview img{max-width:100%;max-height:230px;display:block;margin:0 auto;border-radius:6px;}' +
          '.wm-works-preview pre{margin:0;max-height:230px;overflow:auto;font:11.5px/1.5 Consolas,"Courier New",monospace;' +
          'white-space:pre-wrap;word-break:break-word;}' +
          '.wm-works-preview iframe{width:100%;height:250px;border:none;border-radius:6px;background:#fff;}' +
          '.wm-works-preview .meta{color:#64748b;font-size:12px;padding:4px 2px;}' +
          '.wm-works-empty{color:#94a3b8;text-align:center;padding:24px 0;font-size:12px;}' +
          '@media (max-height:700px){.wm-img{height:186px;}.wm-root{width:124px;height:198px;}}' +
          '@media (max-height:560px){.wm-img{height:150px;}.wm-root{width:100px;height:162px;}}' +
          '@media (min-height:1000px){.wm-img{height:256px;}.wm-root{width:166px;height:270px;}}'
        document.head.appendChild(styleEl)
      }

      function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)]
      }

      function readLove() {
        try {
          var raw = parseInt(storeGet(LS_LOVE), 10)
          return isNaN(raw) ? 0 : raw
        } catch (e) {
          return 0
        }
      }

      function getLoveLevel(value) {
        for (var i = LOVE_LEVELS.length - 1; i >= 0; i--) {
          if (value >= LOVE_LEVELS[i]) return i
        }
        return 0
      }

      function tapLine() {
        var idx = Math.min(loveLevel, TAP_LINES.length - 1)
        return pick(TAP_LINES[idx])
      }

      function addLove(amount) {
        var before = loveLevel
        love += amount
        if (love < 0) love = 0
        loveLevel = getLoveLevel(love)
        try {
          storeSet(LS_LOVE, String(love))
        } catch (e) {}
        return loveLevel > before
      }

      function levelUp() {
        say('Confianza a Lv.' + (loveLevel + 1) + ' «' + LOVE_LEVEL_NAMES[loveLevel] + '»')
        setMood('happy', { emoji: '✨', ms: 7000, emojiMs: 2400 })
        reactClass('wm-squish', 700)
      }

      function playRebound(fromTilt) {
        if (!bodyWrap) return
        bodyWrap.style.animation = 'none'
        void bodyWrap.offsetWidth
        bodyWrap.style.setProperty('--rebound-from', (fromTilt || 0) + 'deg')
        bodyWrap.style.setProperty('--rebound-mid', (-(fromTilt || 0) * 0.25) + 'deg')
        bodyWrap.classList.add('wm-rebound')
        bodyWrap.style.animation = 'wm-rebound .55s cubic-bezier(.22,1.4,.36,1)'
        clearTimeout(reboundTimer)
        reboundTimer = setTimeout(function () {
          bodyWrap.classList.remove('wm-rebound')
          bodyWrap.style.animation = ''
          bodyWrap.style.removeProperty('--rebound-from')
          bodyWrap.style.removeProperty('--rebound-mid')
        }, 600)
      }

      function playDrop() {
        if (!root) return
        root.style.animation = 'none'
        void root.offsetWidth
        root.classList.add('wm-drop')
        root.style.animation = 'wm-drop .45s ease'
        clearTimeout(dropTimer)
        dropTimer = setTimeout(function () {
          root.classList.remove('wm-drop')
          root.style.animation = ''
        }, 500)
      }

      function readPos() {
        try {
          var raw = storeGet(LS_POS)
          if (raw) return JSON.parse(raw)
        } catch (e) {}
        return null
      }

      function savePos() {
        try {
          storeSet(
            LS_POS,
            JSON.stringify({
              left: parseInt(root.style.left, 10),
              top: parseInt(root.style.top, 10),
              vw: window.innerWidth,
              vh: window.innerHeight,
            }),
          )
        } catch (e) {}
      }

      function isHidden() {
        try {
          return storeGet(LS_HIDDEN) === '1'
        } catch (e) {
          return false
        }
      }

      function readStyle() {
        try {
          var s = storeGet(LS_STYLE)
          // Legacy chibi styles b/c are no longer offered; fall back to the classic look.
          if (s && STYLE_ORDER.indexOf(s) !== -1) return s
          return 'a'
        } catch (e) {
          return 'a'
        }
      }

      function clampPos() {
        var left = parseInt(root.style.left, 10)
        var top = parseInt(root.style.top, 10)
        var w = root.offsetWidth || 150
        var h = root.offsetHeight || 244
        left = Math.max(-w + 42, Math.min(window.innerWidth - 42, left))
        top = Math.max(0, Math.min(window.innerHeight - 42, top))
        root.style.left = left + 'px'
        root.style.top = top + 'px'
      }

      function buildDom() {
        root = document.createElement('div')
        root.className = 'wm-root'
        root.setAttribute('aria-label', 'Whale-chan')

        img = document.createElement('img')
        img.className = 'wm-img'
        img.alt = 'Whale-chan'
        img.draggable = false
        img.addEventListener('error', function () {
          var base = STYLE_ASSETS[style] || ASSET_A
          if (img.src && img.src.indexOf(base) !== -1) return
          img.src = base
        })

        bodyWrap = document.createElement('div')
        bodyWrap.className = 'wm-body style-a'

        bubble = document.createElement('div')
        bubble.className = 'wm-bubble'
        bubbleText = document.createElement('span')
        bubble.appendChild(bubbleText)

        emojiEl = document.createElement('div')
        emojiEl.className = 'wm-emoji'

        blushL = document.createElement('div')
        blushL.className = 'wm-blush l'
        blushL.style.background = 'radial-gradient(circle, rgba(255,120,150,.92), rgba(255,120,150,0))'
        blushR = document.createElement('div')
        blushR.className = 'wm-blush r'
        blushR.style.background = 'radial-gradient(circle, rgba(255,120,150,.92), rgba(255,120,150,0))'

        styleBtn = document.createElement('button')
        styleBtn.className = 'wm-btn wm-style'
        styleBtn.type = 'button'
        styleBtn.title = 'Cambiar estilo (sirvienta / uniforme / sudadera / oscura)'

        hideBtn = document.createElement('button')
        hideBtn.className = 'wm-btn wm-hide'
        hideBtn.type = 'button'
        hideBtn.textContent = '✕'
        hideBtn.title = 'Ocultar'

        chatToggleBtn = document.createElement('button')
        chatToggleBtn.className = 'wm-btn wm-chat-btn'
        chatToggleBtn.type = 'button'
        chatToggleBtn.textContent = '💬'
        chatToggleBtn.title = 'Hablar con Whale-chan'

        worksToggleBtn = document.createElement('button')
        worksToggleBtn.className = 'wm-btn wm-works-btn'
        worksToggleBtn.type = 'button'
        worksToggleBtn.textContent = '👀'
        worksToggleBtn.title = 'Mis trabajos (lo que estoy creando en el harness)'

        bodyWrap.appendChild(img)
        bodyWrap.appendChild(emojiEl)
        bodyWrap.appendChild(blushL)
        bodyWrap.appendChild(blushR)

        root.appendChild(bubble)
        root.appendChild(bodyWrap)
        root.appendChild(styleBtn)
        root.appendChild(hideBtn)
        root.appendChild(worksToggleBtn)
        root.appendChild(chatToggleBtn)
        document.body.appendChild(root)

        restoreBtn = document.createElement('button')
        restoreBtn.className = 'wm-restore'
        restoreBtn.type = 'button'
        restoreBtn.textContent = '🐋'
        restoreBtn.title = 'Mostrar a Whale-chan'
        document.body.appendChild(restoreBtn)

        buildContextMenu()
        buildArchiveOverlay()
        buildExplainFloat()
        buildExplainPanel()
        buildChatPanel()
        buildWorksPanel()
      }

      // --- right-click menu + archived viewer ----------------------------------

      function buildContextMenu() {
        menuEl = document.createElement('div')
        menuEl.className = 'wm-menu'
        menuEl.setAttribute('role', 'menu')

        archiveBtn = document.createElement('button')
        archiveBtn.type = 'button'
        archiveBtn.className = 'wm-menu-item'
        archiveBtn.setAttribute('role', 'menuitem')
        archiveBtn.textContent = '📦 Archivar conversación'
        archiveBtn.addEventListener('click', onArchiveMenuClick)

        newSessionBtn = document.createElement('button')
        newSessionBtn.type = 'button'
        newSessionBtn.className = 'wm-menu-item'
        newSessionBtn.setAttribute('role', 'menuitem')
        newSessionBtn.textContent = '✨ Nueva sesión'
        newSessionBtn.addEventListener('click', onNewSessionMenuClick)

        archivedListBtn = document.createElement('button')
        archivedListBtn.type = 'button'
        archivedListBtn.className = 'wm-menu-item'
        archivedListBtn.setAttribute('role', 'menuitem')
        archivedListBtn.textContent = '🗂 Sesiones archivadas'
        archivedListBtn.addEventListener('click', onViewArchivedMenuClick)

        explainBtn = document.createElement('button')
        explainBtn.type = 'button'
        explainBtn.className = 'wm-menu-item'
        explainBtn.setAttribute('role', 'menuitem')
        explainBtn.textContent = '📖 Explicar término'
        explainBtn.addEventListener('click', onExplainMenuClick)

        openExplainPanelBtn = document.createElement('button')
        openExplainPanelBtn.type = 'button'
        openExplainPanelBtn.className = 'wm-menu-item'
        openExplainPanelBtn.setAttribute('role', 'menuitem')
        openExplainPanelBtn.textContent = '🪟 Abrir panel de explicaciones'
        openExplainPanelBtn.addEventListener('click', onOpenExplainPanelClick)

        commonPromptBtn = document.createElement('button')
        commonPromptBtn.type = 'button'
        commonPromptBtn.className = 'wm-menu-item'
        commonPromptBtn.setAttribute('role', 'menuitem')
        commonPromptBtn.textContent = '⚡ Prompts frecuentes'
        commonPromptBtn.addEventListener('click', onCommonPromptMenuClick)

        notifBtn = document.createElement('button')
        notifBtn.type = 'button'
        notifBtn.className = 'wm-menu-item'
        notifBtn.setAttribute('role', 'menuitem')
        notifBtn.addEventListener('click', onNotifMenuClick)

        chatBtn = document.createElement('button')
        chatBtn.type = 'button'
        chatBtn.className = 'wm-menu-item'
        chatBtn.setAttribute('role', 'menuitem')
        chatBtn.textContent = '💬 Hablar con Whale-chan'
        chatBtn.addEventListener('click', onChatMenuClick)

        worksBtn = document.createElement('button')
        worksBtn.type = 'button'
        worksBtn.className = 'wm-menu-item'
        worksBtn.setAttribute('role', 'menuitem')
        worksBtn.textContent = '👀 Mis trabajos'
        worksBtn.addEventListener('click', onWorksMenuClick)

        aiBtn = document.createElement('button')
        aiBtn.type = 'button'
        aiBtn.className = 'wm-menu-item'
        aiBtn.setAttribute('role', 'menuitem')
        aiBtn.addEventListener('click', onAiMenuClick)

        proactiveBtn = document.createElement('button')
        proactiveBtn.type = 'button'
        proactiveBtn.className = 'wm-menu-item'
        proactiveBtn.setAttribute('role', 'menuitem')
        proactiveBtn.addEventListener('click', function () {
          hideContextMenu()
          cycleProactive()
        })

        autoDrawBtn = document.createElement('button')
        autoDrawBtn.type = 'button'
        autoDrawBtn.className = 'wm-menu-item'
        autoDrawBtn.setAttribute('role', 'menuitem')
        autoDrawBtn.addEventListener('click', function () {
          hideContextMenu()
          onAutoDrawMenuClick()
        })

        progressBtn = document.createElement('button')
        progressBtn.type = 'button'
        progressBtn.className = 'wm-menu-item'
        progressBtn.setAttribute('role', 'menuitem')
        progressBtn.textContent = '📊 Tarjeta de progreso'
        progressBtn.addEventListener('click', function () {
          hideContextMenu()
          requestProgressCard()
        })

        memoryBtn = document.createElement('button')
        memoryBtn.type = 'button'
        memoryBtn.className = 'wm-menu-item'
        memoryBtn.setAttribute('role', 'menuitem')
        memoryBtn.textContent = '🧠 Memoria'
        memoryBtn.addEventListener('click', function () {
          onMemoryMenuClick()
        })

        document.body.appendChild(menuEl)
        renderMainMenu()
      }

      function renderMainMenu() {
        if (!menuEl) return
        menuEl.innerHTML = ''
        var sep = document.createElement('div')
        sep.className = 'wm-menu-sep'
        var sep2 = document.createElement('div')
        sep2.className = 'wm-menu-sep'
        var sep3 = document.createElement('div')
        sep3.className = 'wm-menu-sep'
        var sep4 = document.createElement('div')
        sep4.className = 'wm-menu-sep'
        var sep5 = document.createElement('div')
        sep5.className = 'wm-menu-sep'
        var sep6 = document.createElement('div')
        sep6.className = 'wm-menu-sep'
        notifBtn.textContent = notifEnabled ? '🔕 Desactivar notificaciones' : '🔔 Activar notificaciones'
        aiBtn.textContent = aiEnabled() ? '🧠 Voz IA: activada' : '🧠 Voz IA: desactivada'
        proactiveBtn.textContent = '🗣️ Proactividad: ' + proactiveLevel()
        autoDrawBtn.textContent = '🖼️ Dibujos automáticos: ' + (readAutoDraw() ? 'sí' : 'no')
        menuEl.appendChild(archiveBtn)
        menuEl.appendChild(newSessionBtn)
        menuEl.appendChild(chatBtn)
        menuEl.appendChild(worksBtn)
        menuEl.appendChild(sep)
        menuEl.appendChild(archivedListBtn)
        menuEl.appendChild(sep2)
        menuEl.appendChild(explainBtn)
        menuEl.appendChild(sep3)
        menuEl.appendChild(openExplainPanelBtn)
        menuEl.appendChild(sep4)
        menuEl.appendChild(commonPromptBtn)
        menuEl.appendChild(sep5)
        menuEl.appendChild(notifBtn)
        menuEl.appendChild(aiBtn)
        menuEl.appendChild(sep6)
        menuEl.appendChild(proactiveBtn)
        menuEl.appendChild(autoDrawBtn)
        menuEl.appendChild(progressBtn)
        menuEl.appendChild(memoryBtn)
      }

      function renderMemoryMenu() {
        if (!menuEl) return
        menuEl.innerHTML = ''
        var back = document.createElement('button')
        back.type = 'button'
        back.className = 'wm-menu-item'
        back.textContent = '← Volver'
        back.addEventListener('click', renderMainMenu)
        var view = document.createElement('button')
        view.type = 'button'
        view.className = 'wm-menu-item'
        view.textContent = '🧠 Ver lo que recuerda'
        view.addEventListener('click', function () {
          hideContextMenu()
          showMemory()
        })
        var clear = document.createElement('button')
        clear.type = 'button'
        clear.className = 'wm-menu-item danger'
        clear.textContent = '🗑 Borrar mi memoria'
        clear.addEventListener('click', function () {
          hideContextMenu()
          clearUserMemory()
        })
        menuEl.appendChild(back)
        menuEl.appendChild(view)
        menuEl.appendChild(clear)
      }

      function onMemoryMenuClick() {
        renderMemoryMenu()
      }

      function onAiMenuClick() {
        var next = !aiEnabled()
        storeSet(AI_KEY, next ? '1' : '0')
        hideContextMenu()
        say(next ? 'Voz IA activada 🧠' : 'Voz IA desactivada')
      }

      function renderPromptMenu() {
        if (!menuEl) return
        menuEl.innerHTML = ''
        var back = document.createElement('button')
        back.type = 'button'
        back.className = 'wm-menu-item'
        back.textContent = '← Volver'
        back.addEventListener('click', function () {
          renderMainMenu()
        })
        menuEl.appendChild(back)
        getCustomPrompts().forEach(function (p) {
          var btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'wm-menu-item'
          btn.setAttribute('role', 'menuitem')
          btn.textContent = p.label
          btn.addEventListener('click', function () {
            insertPromptToComposer(p.text)
            hideContextMenu()
          })
          menuEl.appendChild(btn)
        })
      }

      function onCommonPromptMenuClick() {
        renderPromptMenu()
      }

      function insertPromptToComposer(text) {
        var ta = document.querySelector('textarea[data-phase]') || document.querySelector('textarea')
        if (!ta) {
          say('No encuentro la caja de texto')
          return
        }
        var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
        var next = (ta.value ? ta.value.replace(/\s+$/, '') + '\n' : '') + text
        try {
          setter.call(ta, next)
        } catch (e) {
          ta.value = next
        }
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.focus()
        try {
          ta.setSelectionRange(ta.value.length, ta.value.length)
        } catch (e) {}
        say('Pegado en la caja de texto; puedes editarlo y enviarlo')
      }

      // --- drag & drop feed: delete or archive session --------------------------

      function onDragOver(e) {
        e.preventDefault()
        if (root) root.classList.add('drop-target')
      }

      function onDragEnter(e) {
        e.preventDefault()
        if (root) root.classList.add('drop-target')
      }

      function onDragLeave(e) {
        if (root) root.classList.remove('drop-target')
      }

      function onDrop(e) {
        e.preventDefault()
        if (root) root.classList.remove('drop-target')
        var sessionId = ''
        try {
          sessionId = e.dataTransfer.getData('text/plain') || ''
        } catch (err) {}
        if (!sessionId) {
          say('No hay ninguna sesión que alimentar')
          return
        }
        openFeedMenu(sessionId, e.clientX, e.clientY)
      }

      function openFeedMenu(sessionId, x, y) {
        feedSessionId = sessionId
        resetFeedArm()
        if (!menuEl) return
        renderFeedMenu()
        var menuW = 210
        var menuH = 150
        var left = Math.min(x, window.innerWidth - menuW - 8)
        var top = Math.min(y, window.innerHeight - menuH - 8)
        menuEl.style.left = Math.max(8, left) + 'px'
        menuEl.style.top = Math.max(8, top) + 'px'
        menuEl.style.display = 'block'
      }

      function resetFeedArm() {
        feedArmedAction = null
        clearTimeout(feedArmTimer)
      }

      function cancelFeedMenu() {
        resetFeedArm()
        feedSessionId = null
        hideContextMenu()
      }

      function renderFeedMenu() {
        if (!menuEl) return
        menuEl.innerHTML = ''
        var title = document.createElement('div')
        title.style.cssText = 'padding:6px 10px;font-weight:600;font-size:13px;color:#334155;'
        title.textContent = 'Alimentar con sesión'
        menuEl.appendChild(title)

        var archiveBtn = document.createElement('button')
        archiveBtn.type = 'button'
        archiveBtn.className = 'wm-menu-item'
        archiveBtn.textContent = feedArmedAction === 'archive' ? '⚠ Pulsa otra vez para archivar' : '📦 Archivar sesión'
        archiveBtn.addEventListener('click', onFeedArchiveClick)
        menuEl.appendChild(archiveBtn)

        var deleteBtn = document.createElement('button')
        deleteBtn.type = 'button'
        deleteBtn.className = 'wm-menu-item'
        deleteBtn.textContent = feedArmedAction === 'delete' ? '⚠ Pulsa otra vez para borrar' : '🗑 Borrar sesión'
        deleteBtn.addEventListener('click', onFeedDeleteClick)
        menuEl.appendChild(deleteBtn)

        var cancelBtn = document.createElement('button')
        cancelBtn.type = 'button'
        cancelBtn.className = 'wm-menu-item'
        cancelBtn.textContent = 'Cancelar'
        cancelBtn.addEventListener('click', cancelFeedMenu)
        menuEl.appendChild(cancelBtn)
      }

      function onFeedArchiveClick() {
        if (feedArmedAction !== 'archive') {
          feedArmedAction = 'archive'
          clearTimeout(feedArmTimer)
          feedArmTimer = setTimeout(resetFeedArm, 3000)
          renderFeedMenu()
          return
        }
        var sessionId = feedSessionId
        resetFeedArm()
        hideContextMenu()
        executeFeedArchive(sessionId)
      }

      function onFeedDeleteClick() {
        if (feedArmedAction !== 'delete') {
          feedArmedAction = 'delete'
          clearTimeout(feedArmTimer)
          feedArmTimer = setTimeout(resetFeedArm, 3000)
          renderFeedMenu()
          return
        }
        var sessionId = feedSessionId
        resetFeedArm()
        hideContextMenu()
        executeFeedDelete(sessionId)
      }

      function executeFeedArchive(sessionId) {
        if (!sessionId) return
        ensureServices()
        if (!__workspacesSvc || typeof __workspacesSvc.archiveSession !== 'function') {
          say('El servicio de archivo no está disponible')
          return
        }
        __workspacesSvc.archiveSession(sessionId).then(function () {
          say('Sesión archivada')
        }, function (err) {
          say('Error al archivar: ' + (err && err.message ? err.message : String(err)))
        })
      }

      function executeFeedDelete(sessionId) {
        if (!sessionId) return
        ensureServices()
        var svc = __sessionsSvc
        var deletedCurrent = false
        try {
          deletedCurrent = svc && svc.list ? svc.list.getSnapshot().current === sessionId : false
        } catch (e) {}
        deleteSessionById(sessionId).then(function () {
          say('Sesión borrada')
          if (svc && typeof svc.refreshList === 'function') {
            var done = svc.refreshList()
            if (deletedCurrent) {
              Promise.resolve(done).then(function () {
                try {
                  var snap = svc.list.getSnapshot()
                  var next = (snap.ids || []).find(function (id) { return id !== sessionId })
                  if (next && typeof svc.open === 'function') svc.open(next)
                } catch (e) {}
              })
            }
          }
        }, function (err) {
          say('Error al borrar: ' + (err && err.message ? err.message : String(err)))
        })
      }

      // --- system notification + task completion reminder -----------------------

      function onNotifMenuClick() {
        if (typeof window.Notification === 'undefined') {
          say('Este navegador no admite notificaciones')
          return
        }
        if (notifEnabled) {
          notifEnabled = false
          storeSet(LS_NOTIF, '0')
          renderMainMenu()
          say('Notificaciones desactivadas')
          return
        }
        if (window.Notification.permission === 'default') {
          window.Notification.requestPermission().then(function (permission) {
            if (permission === 'granted') {
              notifEnabled = true
              storeSet(LS_NOTIF, '1')
              renderMainMenu()
              say('Notificaciones activadas')
            } else {
              say('Permiso de notificaciones denegado')
            }
          })
        } else if (window.Notification.permission === 'granted') {
          notifEnabled = true
          storeSet(LS_NOTIF, '1')
          renderMainMenu()
          say('Notificaciones activadas')
        } else {
          say('Permiso de notificaciones denegado; actívalo en los ajustes del navegador')
        }
      }

      function showSystemNotification(title, body) {
        if (typeof window.Notification === 'undefined' || window.Notification.permission !== 'granted') return
        try {
          var n = new window.Notification(title, { body: body, tag: 'dsh-mascot' })
          if (n && typeof n.onclick === 'function') {
            n.onclick = function () {
              window.focus()
              n.close()
            }
          }
        } catch (e) {}
      }

      function readNotifEnabled() {
        return storeGet(LS_NOTIF) === '1'
      }

      function notifyTaskComplete() {
        if (document.hidden || notifEnabled) {
          showSystemNotification('Whale-chan', 'Tarea completada.')
        }
        if (!document.hidden) {
          aiSay('task-complete', 'Tarea completada.')
          setMood('happy', { emoji: '🎉', emojiMs: 2200, ms: 7000 })
          reactClass('wm-squish', 700)
          // Files usually land right after a turn ends: refresh the work panel
          // and let the artifact detector comment on anything new.
          setTimeout(function () { pollWorkspace({ force: true }) }, 2500)
          if (readAutoDraw()) {
            setTimeout(function () {
              requestDoodle('celebrate', buildDoodleData('celebrate', {
                title: '¡Tarea completada!',
                lines: [currentSessionTitle() ? 'En «' + currentSessionTitle() + '»' : 'Buen trabajo.'],
              }), { caption: pick(DRAW_CAPTIONS.celebrate) })
            }, 3200)
          }
        }
      }

      function checkRunningState() {
        ensureServices()
        if (!__sessionsSvc || !__sessionsSvc.list) return
        var snap
        try {
          snap = __sessionsSvc.list.getSnapshot()
        } catch (e) {
          return
        }
        if (!snap || snap.phase !== 'ready') return
        var current = snap.current || null
        var summary = current ? (snap.byId && snap.byId[current]) : null
        var running = summary ? summary.running === true : false
        if (current !== lastRunningSessionId) {
          lastRunningSessionId = current
          lastRunningState = running
          return
        }
        if (lastRunningState === false && running === true) {
          setMood('thinking', { emoji: '💪', emojiMs: 2000, ms: 8000 })
          reactClass('wm-wobble', 700)
          aiSay('working', 'A trabajar, pues.')
        }
        if (lastRunningState === true && running === false) {
          notifyTaskComplete()
        }
        lastRunningState = running
      }

      function setupSessionWatch() {
        ensureServices()
        if (sessionWatchUnsubscribe) return
        if (__sessionsSvc && __sessionsSvc.list && typeof __sessionsSvc.list.subscribe === 'function') {
          sessionWatchUnsubscribe = __sessionsSvc.list.subscribe(function () {
            checkRunningState()
          })
        }
        clearInterval(sessionWatchTimer)
        sessionWatchTimer = setInterval(checkRunningState, 5000)
      }

      function buildArchiveOverlay() {
        archivedOverlay = document.createElement('div')
        archivedOverlay.className = 'wm-archive-overlay'
        archivedOverlay.addEventListener('click', function (e) {
          if (e.target === archivedOverlay) closeArchivedViewer()
        })

        archivedPanel = document.createElement('div')
        archivedPanel.className = 'wm-archive-panel'

        var header = document.createElement('div')
        header.className = 'wm-archive-header'
        header.textContent = 'Sesiones archivadas'
        var closeBtn = document.createElement('button')
        closeBtn.className = 'wm-archive-close'
        closeBtn.type = 'button'
        closeBtn.textContent = '✕'
        closeBtn.addEventListener('click', closeArchivedViewer)
        header.appendChild(closeBtn)

        archivedListEl = document.createElement('div')
        archivedListEl.className = 'wm-archive-body'
        archivedDetailEl = document.createElement('div')
        archivedDetailEl.className = 'wm-archive-body'
        archivedDetailEl.style.display = 'none'

        archivedPanel.appendChild(header)
        archivedPanel.appendChild(archivedListEl)
        archivedPanel.appendChild(archivedDetailEl)
        archivedOverlay.appendChild(archivedPanel)
        document.body.appendChild(archivedOverlay)
      }

      function buildExplainFloat() {
        explainBtnEl = document.createElement('button')
        explainBtnEl.type = 'button'
        explainBtnEl.className = 'wm-explain-float'
        explainBtnEl.textContent = '🔍 Explicar esta palabra'
        explainBtnEl.addEventListener('click', onExplainFloatClick)
        document.body.appendChild(explainBtnEl)
      }

      function buildExplainPanel() {
        explainPanelEl = document.createElement('div')
        explainPanelEl.className = 'wm-explain-panel'

        var header = document.createElement('div')
        header.className = 'wm-explain-panel-header'
        header.textContent = '📖 Explicación del término'
        var closeBtn = document.createElement('button')
        closeBtn.type = 'button'
        closeBtn.className = 'wm-explain-panel-close'
        closeBtn.textContent = '✕'
        closeBtn.addEventListener('click', closeExplainPanel)
        header.appendChild(closeBtn)

        var cleanupBtn = document.createElement('button')
        cleanupBtn.type = 'button'
        cleanupBtn.className = 'wm-explain-panel-cleanup'
        cleanupBtn.textContent = '🗑'
        cleanupBtn.title = 'Limpiar historial de explicaciones'
        cleanupBtn.addEventListener('click', onCleanupExplainClick)
        header.appendChild(cleanupBtn)

        explainPanelBody = document.createElement('div')
        explainPanelBody.className = 'wm-explain-panel-body'

        explainPanelEl.appendChild(header)
        explainPanelEl.appendChild(explainPanelBody)
        document.body.appendChild(explainPanelEl)
      }

      function serviceOf(name) {
        try {
          if (__ctx && typeof __ctx.get === 'function') {
            var svc = __ctx.get(name)
            if (svc) return svc
          }
        } catch (e) {}
        try {
          if (__ctx && __ctx[name]) return __ctx[name]
        } catch (e) {}
        return null
      }

      function ensureServices() {
        var ui = serviceOf('uiWorkspace')
        var ws = serviceOf('workspaces')
        // uiWorkspace owns startSession/archiveSession; the pure workspaces
        // controller only lists/archives. Never settle for a service that
        // cannot start a session when uiWorkspace is around.
        if (ui && typeof ui.startSession === 'function') {
          __workspacesSvc = ui
        } else if (!__workspacesSvc || typeof __workspacesSvc.startSession !== 'function') {
          __workspacesSvc = ui || ws || __workspacesSvc
        }
        if (!__wsListSvc) __wsListSvc = ws
        if (!__sessionsSvc) __sessionsSvc = serviceOf('sessions')
      }

      function adoptServices(ctx) {
        __ctx = ctx || null
        if (ctx && ctx.workspaces) __workspacesSvc = ctx.workspaces
        if (!__workspacesSvc && ctx && typeof ctx.get === 'function') {
          try { __workspacesSvc = ctx.get('uiWorkspace') || ctx.get('workspaces') } catch (e) {}
        }
        if (ctx && ctx.sessions) __sessionsSvc = ctx.sessions
        if (ctx && typeof ctx.get === 'function') {
          if (!__workspacesSvc) __workspacesSvc = ctx.get('workspaces')
          if (!__sessionsSvc) __sessionsSvc = ctx.get('sessions')
        }
        if (ctx && typeof ctx.inject === 'function') {
          if (!__workspacesSvc) {
            ctx.inject(['workspaces'], function (sub) {
              if (sub && sub.workspaces) __workspacesSvc = sub.workspaces
            })
          }
          if (!__sessionsSvc) {
            ctx.inject(['sessions'], function (sub) {
              if (sub && sub.sessions) __sessionsSvc = sub.sessions
            })
          }
        }
      }

      function currentSessionId() {
        ensureServices()
        if (!__sessionsSvc) return null
        try {
          var snap = __sessionsSvc.list && typeof __sessionsSvc.list.getSnapshot === 'function'
            ? __sessionsSvc.list.getSnapshot()
            : null
          if (!snap) return null
          // legacy DSH: the list snapshot carried the selected session
          var direct = snap.current || snap.currentSessionId || snap.currentId ||
            snap.activeId || snap.activeSessionId || snap.selectedId
          if (direct) return direct
          // current DSH: uiWorkspace persists the main selection
          try {
            if (__workspacesSvc && __workspacesSvc.selection &&
                typeof __workspacesSvc.selection.getSnapshot === 'function') {
              var sel = __workspacesSvc.selection.getSnapshot()
              if (sel && sel.sessionId) return sel.sessionId
            }
          } catch (e) {}
          try {
            var raw = window.localStorage.getItem('dsh.sessions.current')
            if (raw) {
              var parsed = JSON.parse(raw)
              var state = parsed && parsed.state ? parsed.state : parsed
              if (state && state.sessionId) return state.sessionId
            }
          } catch (e) {}
          // fallback: the main view retains exactly one open session
          var byId = snap.byId || {}
          var ids = Object.keys(byId)
          for (var i = 0; i < ids.length; i++) {
            var row = byId[ids[i]]
            if (row && row.retainedBy && row.retainedBy.mainView > 0) {
              return row.sessionId || row.id || ids[i]
            }
          }
        } catch (e) {}
        return null
      }

      function sessionTitle(id) {
        ensureServices()
        if (!__sessionsSvc || !__sessionsSvc.list) return 'Sesión sin título'
        try {
          var snap = __sessionsSvc.list.getSnapshot()
          var s = snap.byId && snap.byId[id]
          return (s && (s.displayTitle || s.title)) || 'Sesión sin título'
        } catch (e) {
          return 'Sesión sin título'
        }
      }

      function getArchivedSessions() {
        ensureServices()
        ensureServices()
        var wsList = __wsListSvc && __wsListSvc.list ? __wsListSvc.list : null
        if (!wsList && __workspacesSvc && __workspacesSvc.list) wsList = __workspacesSvc.list
        if (!__sessionsSvc || !__sessionsSvc.list || !wsList) return []
        try {
          var snap = __sessionsSvc.list.getSnapshot()
          var ws = wsList.getSnapshot()
          var archived = ws.archivedSessionIds || []
          var byId = snap.byId || {}
          return archived.filter(function (id) {
            return !isExplainSession(id)
          }).map(function (id) {
            var s = byId[id]
            if (s) {
              return {
                id: s.id || id,
                sessionId: s.id || s.sessionId || id,
                displayTitle: s.displayTitle,
                title: s.title,
                updatedAt: s.updatedAt,
              }
            }
            return { sessionId: id, id: id, title: 'Sesión sin título', updatedAt: 0 }
          })
        } catch (e) {
          return []
        }
      }

      function archiveCurrent() {
        ensureServices()
        var id = currentSessionId()
        if (!id) {
          hideContextMenu()
          say('No hay sesiones que archivar')
          return
        }
        if (!__workspacesSvc || typeof __workspacesSvc.archiveSession !== 'function') {
          hideContextMenu()
          say('El servicio de archivo no está disponible')
          return
        }
        var title = sessionTitle(id)
        hideContextMenu()
        try {
          var pending = __workspacesSvc.archiveSession(id)
          if (pending && typeof pending.then === 'function') {
            pending.then(function () {
              say('Archivada: ' + title)
            }, function (err) {
              say('Error al archivar: ' + (err && err.message ? err.message : String(err)))
            })
          } else {
            say('Archivada: ' + title)
          }
        } catch (err) {
          say('Error al archivar: ' + (err && err.message ? err.message : String(err)))
        }
      }

      function startNewSession() {
        hideContextMenu()
        ensureServices()
        if (!__workspacesSvc || typeof __workspacesSvc.startSession !== 'function') {
          say('El servicio de nueva sesión no está disponible')
          return
        }
        try {
          __workspacesSvc.startSession()
        } catch (err) {
          say('Error al crear sesión: ' + (err && err.message ? err.message : String(err)))
        }
      }

      function resetArchiveArm() {
        archiveArmed = false
        clearTimeout(archiveArmTimer)
        if (archiveBtn) {
          archiveBtn.textContent = '📦 Archivar conversación'
          archiveBtn.classList.remove('danger')
        }
      }

      function onArchiveMenuClick() {
        if (!archiveArmed) {
          archiveArmed = true
          archiveBtn.textContent = '⚠ Pulsa otra vez para archivar'
          archiveBtn.classList.add('danger')
          clearTimeout(archiveArmTimer)
          archiveArmTimer = setTimeout(resetArchiveArm, 3000)
          return
        }
        resetArchiveArm()
        archiveCurrent()
      }

      function onNewSessionMenuClick() {
        startNewSession()
      }

      function onViewArchivedMenuClick() {
        openArchivedViewer()
      }

      function showContextMenu(e) {
        e.preventDefault()
        e.stopPropagation()
        cancelExplainMode()
        resetArchiveArm()
        resetFeedArm()
        feedSessionId = null
        resetIdleTimer()
        if (!menuEl) return
        renderMainMenu()
        var menuW = 210
        var menuH = 150
        var left = Math.min(e.clientX, window.innerWidth - menuW - 8)
        var top = Math.min(e.clientY, window.innerHeight - menuH - 8)
        menuEl.style.left = Math.max(8, left) + 'px'
        menuEl.style.top = Math.max(8, top) + 'px'
        menuEl.style.display = 'block'
      }

      function hideContextMenu() {
        if (menuEl) menuEl.style.display = 'none'
        resetArchiveArm()
        resetFeedArm()
        feedSessionId = null
      }

      function onContextMenu(e) {
        showContextMenu(e)
      }

      function onDocumentContextMenu(e) {
        if (root && root.contains(e.target)) return
        if (menuEl && menuEl.contains(e.target)) return
        hideContextMenu()
      }

      function onDocumentClick(e) {
        if (menuEl && menuEl.style.display === 'block' && !menuEl.contains(e.target)) {
          hideContextMenu()
        }
      }

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          hideContextMenu()
          closeArchivedViewer()
          cancelExplainMode()
          closeChat()
          closeWorks()
        }
      }

      function onWindowResize() {
        hideContextMenu()
        hideExplainFloat()
        finishDrag(null, { cancel: true })
        repositionForViewport(lastViewport.w, lastViewport.h)
        if (root) {
          clampPos()
          savePos()
        }
        lastViewport = { w: window.innerWidth, h: window.innerHeight }
        if (chatPanelEl && chatPanelEl.classList.contains('open')) clampChatPanel()
        if (worksPanelEl && worksPanelEl.classList.contains('open')) clampWorksPanel()
      }

      // Keep the pet (and the open panels) anchored to the same relative spot
      // when the window changes size, then clamp everything back on screen.
      function repositionForViewport(prevW, prevH) {
        var nextW = window.innerWidth
        var nextH = window.innerHeight
        if (!prevW || !prevH || !nextW || !nextH) return
        var sx = nextW / prevW
        var sy = nextH / prevH
        if (root) {
          var left = parseInt(root.style.left, 10)
          var top = parseInt(root.style.top, 10)
          if (!isNaN(left) && !isNaN(top) && (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01)) {
            root.style.left = Math.round(left * sx) + 'px'
            root.style.top = Math.round(top * sy) + 'px'
            clampPos()
            savePos()
          }
        }
        ;[[chatPanelEl, saveChatPos, clampChatPanel], [worksPanelEl, saveWorksPos, clampWorksPanel]].forEach(function (entry) {
          var panel = entry[0]
          if (!panel || !panel.classList.contains('open')) return
          var panelLeft = parseInt(panel.style.left, 10)
          var panelTop = parseInt(panel.style.top, 10)
          if (isNaN(panelLeft) || isNaN(panelTop)) return
          panel.style.left = Math.round(panelLeft * sx) + 'px'
          panel.style.top = Math.round(panelTop * sy) + 'px'
          entry[1]()
          entry[2]()
        })
      }

      function onScrollCapture() {
        hideContextMenu()
        hideExplainFloat()
      }

      function openArchivedViewer() {
        hideContextMenu()
        if (!archivedOverlay) return
        archivedOverlay.style.display = 'flex'
        renderArchivedList()
      }

      function closeArchivedViewer() {
        if (archivedOverlay) archivedOverlay.style.display = 'none'
      }

      function renderArchivedList() {
        if (!archivedListEl || !archivedDetailEl) return
        archiveDetailSeq++
        archivedDetailEl.style.display = 'none'
        archivedListEl.style.display = ''
        archivedListEl.innerHTML = ''
        var items = getArchivedSessions()
        if (items.length === 0) {
          var empty = document.createElement('div')
          empty.className = 'wm-archive-empty'
          empty.textContent = 'No hay sesiones archivadas'
          archivedListEl.appendChild(empty)
          return
        }
        items.forEach(function (s) {
          var row = document.createElement('button')
          row.type = 'button'
          row.className = 'wm-archive-item'
          var titleSpan = document.createElement('span')
          titleSpan.className = 't'
          titleSpan.textContent = s.displayTitle || s.title || 'Sesión sin título'
          var timeSpan = document.createElement('span')
          timeSpan.className = 'd'
          timeSpan.textContent = formatTime(s.updatedAt)
          row.appendChild(titleSpan)
          row.appendChild(timeSpan)
          row.addEventListener('click', function () {
            renderArchivedDetail(s.sessionId || s.id)
          })
          archivedListEl.appendChild(row)
        })
      }

      function renderArchivedDetail(sessionId) {
        if (!archivedListEl || !archivedDetailEl) return
        var seq = ++archiveDetailSeq
        archivedListEl.style.display = 'none'
        archivedDetailEl.style.display = ''
        archivedDetailEl.innerHTML = ''

        var back = document.createElement('button')
        back.type = 'button'
        back.className = 'wm-archive-back'
        back.textContent = '← Volver a la lista'
        back.addEventListener('click', renderArchivedList)
        archivedDetailEl.appendChild(back)

        var title = document.createElement('div')
        title.style.fontWeight = '600'
        title.style.marginBottom = '8px'
        title.textContent = sessionTitle(sessionId)
        archivedDetailEl.appendChild(title)

        var loading = document.createElement('div')
        loading.className = 'wm-archive-empty'
        loading.textContent = 'Cargando…'
        archivedDetailEl.appendChild(loading)

        fetchSessionHistory(sessionId).then(function (value) {
          if (seq !== archiveDetailSeq) return
          loading.remove()
          renderMessages((value && value.events) || [])
        }, function (err) {
          if (seq !== archiveDetailSeq) return
          loading.textContent = 'Error al cargar: ' + (err && err.message ? err.message : String(err))
        })
      }

      function renderMessages(events) {
        if (!archivedDetailEl) return
        var count = 0
        events.forEach(function (entry) {
          var ev = entry && entry.event ? entry.event : entry
          if (!ev || !ev.type) return
          var text = ''
          var cls = ''
          if (ev.type === 'user/message') {
            text = extractText(ev.data && ev.data.content)
            cls = 'user'
          } else if (ev.type === 'assistant/message') {
            text = extractText(ev.data && ev.data.message && ev.data.message.content)
            cls = 'assistant'
          } else if (ev.type === 'tool/call') {
            text = ev.data ? '🔧 ' + ev.data.name + (ev.data.arguments ? ' ' + ev.data.arguments : '') : ''
            cls = 'tool'
          } else {
            return
          }
          if (!text) return
          var msg = document.createElement('div')
          msg.className = 'wm-archive-msg ' + cls
          msg.textContent = text
          archivedDetailEl.appendChild(msg)
          count++
        })
        if (count === 0) {
          var empty = document.createElement('div')
          empty.className = 'wm-archive-empty'
          empty.textContent = 'Esta sesión aún no tiene mensajes'
          archivedDetailEl.appendChild(empty)
        }
      }

      function extractText(blocks) {
        if (!Array.isArray(blocks)) return ''
        var out = []
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i]
          if (!b) continue
          if (b.type === 'text') out.push(b.text)
          else if (b.type === 'reasoning') out.push('💭 ' + b.text)
          else if (b.type === 'tool-call') out.push('🔧 ' + b.name + (b.arguments ? ' ' + b.arguments : ''))
          else if (b.type === 'tool-result') out.push('📎 ' + extractText(b.content))
        }
        return out.join('\n')
      }

      function formatTime(ts) {
        if (!ts) return ''
        try {
          var d = new Date(ts)
          if (isNaN(d.getTime())) return ''
          function pad(n) { return n < 10 ? '0' + n : '' + n }
          return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
            ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
        } catch (e) {
          return ''
        }
      }

      function newRpcId() {
        return (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'rpc-' + Date.now() + '-' + Math.random().toString(16).slice(2)
      }

      function storeGet(key) {
        try {
          return window.localStorage.getItem(key)
        } catch (e) {
          return null
        }
      }

      function storeSet(key, value) {
        try {
          window.localStorage.setItem(key, value)
        } catch (e) {}
      }

      function storeRemove(key) {
        try {
          window.localStorage.removeItem(key)
        } catch (e) {}
      }

      var AI_KEY = 'dsh-whale-maid-mascot:ai'
      var AI_MIN_INTERVAL = 18000
      var aiLastAt = 0
      var aiPending = false

      function aiEnabled() {
        return storeGet(AI_KEY) !== '0'
      }

      var CONTEXT_EVENTS = {
        idle: true, working: true, 'task-complete': true, artifact: true, workshop: true,
      }

      function aiSay(event, fallback, opts) {
        opts = opts || {}
        if (!aiEnabled() || aiPending) { say(fallback); return }
        if (Date.now() < bubbleLockUntil) return
        var now = Date.now()
        if (now - aiLastAt < AI_MIN_INTERVAL) { say(fallback); return }
        aiLastAt = now
        aiPending = true
        var payload = { event: event, love: loveLevel, sessionId: getLlmSessionId(), userId: getUserId() }
        if (opts.context) payload.context = opts.context
        else if (CONTEXT_EVENTS[event]) payload.context = buildWorkContext()
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null
        var timer = ctrl ? setTimeout(function () { try { ctrl.abort() } catch (e) {} }, 9000) : null
        var init = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }
        if (ctrl) init.signal = ctrl.signal
        fetch('/whale-maid-mascot/line', init)
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (data) {
            if (timer) clearTimeout(timer)
            aiPending = false
            if (data && data.line) {
              say(data.line, 4500)
              if (data.mood) setMood(data.mood, { ms: 8000 })
            } else say(fallback, 3200)
          })
          .catch(function () {
            if (timer) clearTimeout(timer)
            aiPending = false
            console.warn('[whale-maid-mascot] ambient line request failed; using a fixed line')
            say(fallback, 3200)
          })
      }

      // Reactions to body taps: show the zone-specific line immediately (so the
      // tap always feels responsive) and, budget permitting, let the model
      // replace it with a contextual one a moment later.
      function zoneSay(event, fallback) {
        var seq = ++zoneSeq
        say(fallback, 3200)
        if (!aiEnabled() || aiPending) return
        if (Date.now() - aiLastAt < AI_MIN_INTERVAL) return
        aiLastAt = Date.now()
        aiPending = true
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null
        var timer = ctrl ? setTimeout(function () { try { ctrl.abort() } catch (e) {} }, 9000) : null
        var init = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: event, love: loveLevel, sessionId: getLlmSessionId(), userId: getUserId() }),
        }
        if (ctrl) init.signal = ctrl.signal
        fetch('/whale-maid-mascot/line', init)
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (data) {
            if (timer) clearTimeout(timer)
            aiPending = false
            if (seq !== zoneSeq) return
            if (data && data.line) {
              say(data.line, 4500)
              if (data.mood) setMood(data.mood, { ms: 7000 })
            }
          })
          .catch(function () {
            if (timer) clearTimeout(timer)
            aiPending = false
            console.warn('[whale-maid-mascot] zone line request failed; keeping the fixed line')
          })
      }

      // --- chat with Whale-chan ------------------------------------------------

      function readChatHistory() {
        try {
          var raw = storeGet(LS_CHAT)
          var parsed = raw ? JSON.parse(raw) : []
          if (!Array.isArray(parsed)) return []
          return parsed.filter(function (m) {
            return m && (m.role === 'user' || m.role === 'mascot') &&
              ((typeof m.text === 'string' && m.text) || m.imageUrl ||
                (Array.isArray(m.images) && m.images.length))
          }).map(function (m) {
            return {
              role: m.role,
              text: typeof m.text === 'string' ? m.text : '',
              images: Array.isArray(m.images) ? m.images.filter(function (u) { return typeof u === 'string' }) : undefined,
              imageUrl: typeof m.imageUrl === 'string' ? m.imageUrl : undefined,
            }
          }).slice(-40)
        } catch (e) {
          return []
        }
      }

      function saveChatHistory() {
        try {
          // Never persist data: URLs; generated/user images are referenced by
          // their host URL so localStorage stays small.
          var slim = chatHistory.slice(-40).map(function (m) {
            var copy = { role: m.role, text: typeof m.text === 'string' ? m.text : '' }
            if (m.imageUrl) copy.imageUrl = m.imageUrl
            if (Array.isArray(m.images)) {
              var urls = m.images.filter(function (u) { return typeof u === 'string' && u.indexOf('data:') !== 0 })
              if (urls.length) copy.images = urls
            }
            return copy
          })
          storeSet(LS_CHAT, JSON.stringify(slim))
        } catch (e) {}
      }

      // OpenCode Go requires a routing session id for every model request; keep
      // one stable per browser so the mascot's requests group together.
      function getLlmSessionId() {
        if (llmSessionId) return llmSessionId
        try {
          var saved = storeGet(LS_LLM_SESSION)
          if (saved) {
            llmSessionId = saved
            return llmSessionId
          }
        } catch (e) {}
        var random = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
        llmSessionId = 'whale-chan-' + random
        try {
          storeSet(LS_LLM_SESSION, llmSessionId)
        } catch (e) {}
        return llmSessionId
      }

      // Stable per-browser identity used to key the mascot's long-term memory.
      var userId = ''
      function getUserId() {
        if (userId) return userId
        try {
          var saved = storeGet(LS_USER_ID)
          if (saved && /^[A-Za-z0-9_-]{8,80}$/.test(saved)) {
            userId = saved
            return userId
          }
        } catch (e) {}
        var random = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
        userId = ('u-' + random).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
        try {
          storeSet(LS_USER_ID, userId)
        } catch (e) {}
        return userId
      }

      function fetchMemory() {
        return fetch(MEMORY_URL + '?userId=' + encodeURIComponent(getUserId()), {
          headers: { accept: 'application/json' },
        }).then(function (res) {
          return res.ok ? res.json() : null
        }).catch(function () { return null })
      }

      function postMemory(payload) {
        var body = Object.assign({ userId: getUserId() }, payload || {})
        return fetch(MEMORY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (res) {
          return res.ok ? res.json() : null
        }).catch(function () { return null })
      }

      function showMemory() {
        openChat()
        fetchMemory().then(function (data) {
          memoryCache = data && data.memory ? data.memory : null
          var memory = memoryCache || { name: '', facts: [], preferences: [] }
          var lines = []
          if (memory.name) lines.push('Nombre o trato: ' + memory.name)
          ;(memory.facts || []).forEach(function (fact) { lines.push('· ' + fact) })
          ;(memory.preferences || []).forEach(function (pref) { lines.push('· Preferencia: ' + pref) })
          if (!lines.length) {
            appendChatMessage('sys', 'Todavía no recuerdo nada de ti. Dime cosas como «me llamo …» o «recuerda que …» y las guardaré.')
            say('Todavía no sé nada de ti... cuéntame algo.', 4500)
          } else {
            appendChatMessage('sys', '🧠 Lo que recuerdo de ti:\n' + lines.join('\n'))
            say('Esto es lo que tengo apuntado de ti.', 4500)
          }
          if (chatBodyEl) chatBodyEl.scrollTop = chatBodyEl.scrollHeight
        })
      }

      function clearUserMemory() {
        if (typeof window.confirm === 'function' && !window.confirm('¿Borrar la memoria que Whale-chan tiene de ti?')) return
        postMemory({ action: 'clear' }).then(function (data) {
          memoryCache = null
          if (data && data.memory) memoryCache = data.memory
          say('Memoria borrada. Empezamos de cero.', 4500)
          if (chatBodyEl) {
            appendChatMessage('sys', 'Memoria borrada.')
            chatBodyEl.scrollTop = chatBodyEl.scrollHeight
          }
        })
      }

      function buildChatPanel() {
        chatPanelEl = document.createElement('div')
        chatPanelEl.className = 'wm-chat'
        chatPanelEl.setAttribute('role', 'dialog')
        chatPanelEl.setAttribute('aria-label', 'Chat con Whale-chan')

        var head = document.createElement('div')
        head.className = 'wm-chat-head'
        var who = document.createElement('div')
        who.className = 'who'
        who.textContent = '🐋'
        var title = document.createElement('div')
        title.className = 't'
        title.textContent = 'Whale-chan'
        var sub = document.createElement('small')
        sub.textContent = 'compañera · en línea'
        title.appendChild(sub)

        chatClearBtn = document.createElement('button')
        chatClearBtn.type = 'button'
        chatClearBtn.className = 'wm-chat-clear'
        chatClearBtn.textContent = '🧹'
        chatClearBtn.title = 'Limpiar conversación'
        chatClearBtn.addEventListener('click', clearChat)

        chatDrawBtn = document.createElement('button')
        chatDrawBtn.type = 'button'
        chatDrawBtn.className = 'wm-chat-draw'
        chatDrawBtn.textContent = '🖼️'
        chatDrawBtn.title = 'Crear tarjeta de progreso'
        chatDrawBtn.addEventListener('click', function () { requestProgressCard() })

        chatCloseBtn = document.createElement('button')
        chatCloseBtn.type = 'button'
        chatCloseBtn.className = 'wm-chat-close'
        chatCloseBtn.textContent = '✕'
        chatCloseBtn.title = 'Cerrar chat'
        chatCloseBtn.addEventListener('click', closeChat)

        chatBodyEl = document.createElement('div')
        chatBodyEl.className = 'wm-chat-body'

        var attachRow = document.createElement('div')
        attachRow.className = 'wm-chat-attach'
        chatAttachListEl = document.createElement('div')
        chatAttachListEl.className = 'wm-chat-thumbs'
        chatFileInput = document.createElement('input')
        chatFileInput.type = 'file'
        chatFileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'
        chatFileInput.multiple = true
        chatFileInput.style.display = 'none'
        chatFileInput.addEventListener('change', onChatFilesPicked)
        chatAttachBtn = document.createElement('button')
        chatAttachBtn.type = 'button'
        chatAttachBtn.className = 'wm-chat-attach-btn'
        chatAttachBtn.textContent = '📎'
        chatAttachBtn.title = 'Adjuntar imagen (o pégala con Ctrl+V)'
        chatAttachBtn.addEventListener('click', function () { try { chatFileInput.click() } catch (e) {} })
        attachRow.appendChild(chatAttachBtn)
        attachRow.appendChild(chatAttachListEl)

        var foot = document.createElement('div')
        foot.className = 'wm-chat-foot'
        chatInputEl = document.createElement('textarea')
        chatInputEl.className = 'wm-chat-input'
        chatInputEl.rows = 1
        chatInputEl.placeholder = 'Escríbele algo…'
        chatInputEl.addEventListener('keydown', onChatInputKeyDown)
        chatInputEl.addEventListener('input', autoGrowChatInput)
        chatSendBtn = document.createElement('button')
        chatSendBtn.type = 'button'
        chatSendBtn.className = 'wm-chat-send'
        chatSendBtn.textContent = '➤'
        chatSendBtn.title = 'Enviar (Enter)'
        chatSendBtn.addEventListener('click', function () { sendChatMessage() })

        var hint = document.createElement('div')
        hint.className = 'wm-chat-hint'
        hint.textContent = 'Enter envía · Shift+Enter salto de línea'

        head.appendChild(who)
        head.appendChild(title)
        head.appendChild(chatDrawBtn)
        head.appendChild(chatClearBtn)
        head.appendChild(chatCloseBtn)
        foot.appendChild(chatInputEl)
        foot.appendChild(chatSendBtn)
        chatPanelEl.appendChild(head)
        chatPanelEl.appendChild(chatBodyEl)
        chatPanelEl.appendChild(attachRow)
        chatPanelEl.appendChild(foot)
        chatPanelEl.appendChild(hint)
        chatPanelEl.appendChild(chatFileInput)
        chatPanelEl.addEventListener('pointerdown', function (e) { e.stopPropagation() })
        chatPanelEl.addEventListener('contextmenu', function (e) { e.stopPropagation() })
        chatPanelEl.addEventListener('paste', onChatPaste)
        chatPanelEl.addEventListener('dragover', onChatDragOver)
        chatPanelEl.addEventListener('drop', onChatDrop)
        head.addEventListener('pointerdown', onChatHeadDown)
        head.addEventListener('pointermove', onChatHeadMove)
        head.addEventListener('pointerup', onChatHeadUp)
        head.addEventListener('pointercancel', onChatHeadUp)
        document.body.appendChild(chatPanelEl)
      }

      function autoGrowChatInput() {
        if (!chatInputEl) return
        chatInputEl.style.height = 'auto'
        chatInputEl.style.height = Math.min(88, chatInputEl.scrollHeight || 34) + 'px'
      }

      function onChatInputKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          sendChatMessage()
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          closeChat()
        }
      }

      function chatEl(role, text, images) {
        var el = document.createElement('div')
        el.className = 'wm-chat-msg ' + role
        if (text) {
          var span = document.createElement('span')
          span.textContent = text
          el.appendChild(span)
        }
        ;(images || []).forEach(function (url) {
          if (!url) return
          var im = document.createElement('img')
          im.className = 'wm-chat-img'
          im.src = url
          im.alt = 'imagen'
          im.title = 'Clic para ampliar'
          im.loading = 'lazy'
          im.addEventListener('click', function () { openChatImage(url) })
          el.appendChild(im)
        })
        return el
      }

      function openChatImage(url) {
        if (!url) return
        var box = document.createElement('div')
        box.className = 'wm-lightbox'
        var pic = document.createElement('img')
        pic.src = url
        pic.alt = 'imagen ampliada'
        var close = document.createElement('button')
        close.className = 'wm-lightbox-close'
        close.type = 'button'
        close.textContent = '\u00d7'
        var closeBox = function () {
          box.remove()
          document.removeEventListener('keydown', onKey, true)
        }
        var onKey = function (e) {
          if (e.key === 'Escape') closeBox()
        }
        close.addEventListener('click', function (e) {
          e.stopPropagation()
          closeBox()
        })
        box.appendChild(pic)
        box.appendChild(close)
        box.addEventListener('click', closeBox)
        document.addEventListener('keydown', onKey, true)
        document.body.appendChild(box)
      }

      // This is the same shared session the mascot uses on Telegram: reload the
      // visible transcript from it so both surfaces show one conversation.
      function loadSharedHistory() {
        fetch('/whale-maid-mascot/history')
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (data) {
            if (!data || !Array.isArray(data.messages) || data.messages.length === 0) return
            if (chatPending) return
            chatHistory = data.messages.map(function (m) {
              return { role: m.role === 'user' ? 'user' : 'bot', text: String(m.text || '') }
            })
            saveChatHistory()
            renderChatMessages()
          })
          .catch(function () {})
      }

      function renderChatMessages() {
        if (!chatBodyEl) return
        chatBodyEl.innerHTML = ''
        chatTypingEl = null
        if (chatHistory.length === 0) {
          chatBodyEl.appendChild(chatEl('sys', 'Escríbele algo o cuéntale en qué estás trabajando.'))
          return
        }
        chatHistory.forEach(function (m) {
          chatBodyEl.appendChild(chatEl(m.role, m.text, m.images || (m.imageUrl ? [m.imageUrl] : [])))
        })
        chatBodyEl.scrollTop = chatBodyEl.scrollHeight
      }

      function placeChatPanel() {
        if (!chatPanelEl || !root) return
        var saved = readChatPos()
        if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
          chatPanelEl.style.left = saved.left + 'px'
          chatPanelEl.style.top = saved.top + 'px'
          clampChatPanel()
          return
        }
        var rect = root.getBoundingClientRect()
        var width = 330
        var height = Math.min(Math.round(window.innerHeight * 0.62), 520)
        var left = rect.left - width - 14
        if (left < 8) left = Math.min(window.innerWidth - width - 8, rect.right + 14)
        if (left < 8) left = 8
        var top = rect.top + rect.height - height
        top = Math.max(8, Math.min(window.innerHeight - height - 8, top))
        chatPanelEl.style.left = Math.round(left) + 'px'
        chatPanelEl.style.top = Math.round(top) + 'px'
        saveChatPos()
      }

      function readChatPos() {
        try {
          var raw = storeGet(LS_CHAT_POS)
          if (raw) {
            var parsed = JSON.parse(raw)
            if (parsed && typeof parsed.left === 'number' && typeof parsed.top === 'number') return parsed
          }
        } catch (e) {}
        return null
      }

      function saveChatPos() {
        if (!chatPanelEl) return
        var left = parseInt(chatPanelEl.style.left, 10)
        var top = parseInt(chatPanelEl.style.top, 10)
        if (isNaN(left) || isNaN(top)) return
        try {
          storeSet(LS_CHAT_POS, JSON.stringify({ left: left, top: top }))
        } catch (e) {}
      }

      function clampChatPanel() {
        if (!chatPanelEl) return
        var w = chatPanelEl.offsetWidth || 330
        var h = chatPanelEl.offsetHeight || 420
        var left = parseInt(chatPanelEl.style.left, 10)
        var top = parseInt(chatPanelEl.style.top, 10)
        if (isNaN(left)) left = 8
        if (isNaN(top)) top = 8
        left = Math.max(8, Math.min(window.innerWidth - w - 8, left))
        top = Math.max(8, Math.min(window.innerHeight - h - 8, top))
        chatPanelEl.style.left = left + 'px'
        chatPanelEl.style.top = top + 'px'
      }

      function onChatHeadDown(e) {
        if (!chatPanelEl) return
        if (e.button !== 0 && e.button !== undefined) return
        if (e.target && e.target.closest && e.target.closest('button')) return
        chatDrag.active = true
        chatDrag.moved = false
        chatDrag.offX = e.clientX - parseInt(chatPanelEl.style.left, 10)
        chatDrag.offY = e.clientY - parseInt(chatPanelEl.style.top, 10)
        chatPanelEl.classList.add('dragging')
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch (err) {}
        e.preventDefault()
        e.stopPropagation()
      }

      function onChatHeadMove(e) {
        if (!chatDrag.active || !chatPanelEl) return
        chatDrag.moved = true
        chatPanelEl.style.left = (e.clientX - chatDrag.offX) + 'px'
        chatPanelEl.style.top = (e.clientY - chatDrag.offY) + 'px'
        e.preventDefault()
      }

      function onChatHeadUp() {
        if (!chatDrag.active || !chatPanelEl) return
        chatDrag.active = false
        chatPanelEl.classList.remove('dragging')
        clampChatPanel()
        saveChatPos()
      }

      function onChatToggleButton(e) {
        e.stopPropagation()
        resetIdleTimer()
        toggleChat()
      }

      function openChat() {
        if (!chatPanelEl) return
        placeChatPanel()
        chatPanelEl.classList.add('open')
        chatOpenedOnce = true
        renderChatMessages()
        if (!chatPending) loadSharedHistory()
        if (chatHistory.length === 0) say('Aquí estoy. ¿De qué hablamos?', 4500)
        try {
          chatInputEl.focus()
        } catch (e) {}
      }

      function closeChat() {
        if (chatPanelEl) chatPanelEl.classList.remove('open')
        clearChatAbort()
        hideChatTyping()
      }

      function toggleChat() {
        if (!chatPanelEl) return
        if (chatPanelEl.classList.contains('open')) closeChat()
        else openChat()
      }

      function onChatMenuClick() {
        hideContextMenu()
        openChat()
      }

      function clearChat() {
        clearChatAbort()
        hideChatTyping()
        chatHistory = []
        saveChatHistory()
        if (chatBodyEl) chatBodyEl.innerHTML = ''
        if (chatBodyEl) chatBodyEl.appendChild(chatEl('sys', 'Conversación borrada. Empezamos de cero.'))
        say('Borrón y cuenta nueva. ¿Qué te apetece contar?')
      }

      function clearChatAbort() {
        if (chatAbortCtrl) {
          clearTimeout(chatAbortCtrl.timer)
          try {
            chatAbortCtrl.ctrl.abort()
          } catch (e) {}
          chatAbortCtrl = null
        }
      }

      function showChatTyping() {
        if (!chatBodyEl) return
        hideChatTyping()
        chatTypingEl = chatEl('mascot typing', 'Whale-chan está pensando…')
        chatBodyEl.appendChild(chatTypingEl)
        chatBodyEl.scrollTop = chatBodyEl.scrollHeight
      }

      function hideChatTyping() {
        if (chatTypingEl && chatTypingEl.parentNode) chatTypingEl.parentNode.removeChild(chatTypingEl)
        chatTypingEl = null
      }

      function appendChatMessage(role, text, images) {
        if (!chatBodyEl) return
        chatBodyEl.appendChild(chatEl(role, text, images))
        chatBodyEl.scrollTop = chatBodyEl.scrollHeight
      }

      var CHAT_FALLBACK_LINES = [
        'Me he quedado en blanco un momento. ¿Me lo repites?',
        'No consigo ordenar la frase... ¿lo intentamos otra vez?',
        'Perdona, estaba distraída. ¿Qué me decías?',
      ]

      function chatHistoryPrompt() {
        return chatHistory.slice(-10).map(function (m) {
          return { role: m.role === 'user' ? 'user' : 'assistant', text: m.text }
        })
      }

      function readImageFile(file, cb) {
        if (!file || typeof file.type !== 'string' || file.type.indexOf('image/') !== 0) return cb(null)
        if (file.size > IMAGE_MAX_BYTES) {
          say('Esa imagen pesa demasiado (máximo 6 MB).', 3500)
          return cb(null)
        }
        var reader = new FileReader()
        reader.onload = function () {
          var dataUrl = String(reader.result || '')
          var comma = dataUrl.indexOf(',')
          if (comma < 0) return cb(null)
          cb({
            dataUrl: dataUrl,
            mimeType: file.type,
            dataBase64: dataUrl.slice(comma + 1),
            name: file.name || 'imagen',
          })
        }
        reader.onerror = function () { cb(null) }
        reader.readAsDataURL(file)
      }

      function addChatFiles(files) {
        var list = Array.prototype.slice.call(files || [])
        if (!list.length) return
        var room = IMAGE_MAX_COUNT - chatAttachments.length
        if (room <= 0) {
          say('Puedes adjuntar hasta ' + IMAGE_MAX_COUNT + ' imágenes.', 3500)
          return
        }
        list.slice(0, room).forEach(function (file) {
          readImageFile(file, function (att) {
            if (!att) return
            if (chatAttachments.length >= IMAGE_MAX_COUNT) return
            chatAttachments.push(att)
            renderChatAttachments()
          })
        })
      }

      function onChatFilesPicked(e) {
        addChatFiles(e.target && e.target.files)
        try { e.target.value = '' } catch (err) {}
      }

      function onChatPaste(e) {
        var items = e.clipboardData && e.clipboardData.items
        if (!items) return
        var files = []
        for (var i = 0; i < items.length; i++) {
          if (items[i].kind === 'file') {
            var file = items[i].getAsFile()
            if (file) files.push(file)
          }
        }
        if (files.length) {
          e.preventDefault()
          addChatFiles(files)
        }
      }

      function onChatDragOver(e) {
        var types = e.dataTransfer && e.dataTransfer.types
        var hasFiles = false
        for (var i = 0; types && i < types.length; i++) {
          if (types[i] === 'Files') hasFiles = true
        }
        if (hasFiles) {
          e.preventDefault()
          if (chatPanelEl) chatPanelEl.classList.add('wm-drop')
        }
      }

      function onChatDrop(e) {
        if (chatPanelEl) chatPanelEl.classList.remove('wm-drop')
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return
        e.preventDefault()
        e.stopPropagation()
        addChatFiles(e.dataTransfer.files)
      }

      function renderChatAttachments() {
        if (!chatAttachListEl) return
        chatAttachListEl.innerHTML = ''
        chatAttachments.forEach(function (att, index) {
          var chip = document.createElement('div')
          chip.className = 'wm-chat-chip'
          var im = document.createElement('img')
          im.src = att.dataUrl
          im.alt = att.name || 'imagen'
          var x = document.createElement('button')
          x.type = 'button'
          x.className = 'wm-chat-chip-x'
          x.textContent = '✕'
          x.title = 'Quitar imagen'
          x.addEventListener('click', function () {
            chatAttachments.splice(index, 1)
            renderChatAttachments()
          })
          chip.appendChild(im)
          chip.appendChild(x)
          chatAttachListEl.appendChild(chip)
        })
      }

      var DRAW_CAPTIONS = {
        progress: ['Aquí tienes tu progreso.', 'Un vistazo a lo que llevas hecho.', 'Tarjeta de avance, recién hecha.'],
        celebrate: ['¡Buen trabajo!', 'Esto merece una tarjeta.', 'Tarea cerrada. Bien hecho.'],
        sticker: ['Un sticker para ti.', 'Te dejo esto por aquí.'],
        doodle: ['He dibujado algo.', 'Un garabato rápido.'],
      }

      function buildDoodleData(kind, extra) {
        var summary = workspaceSummary
        var items = []
        if (summary && Array.isArray(summary.artifacts)) {
          summary.artifacts.slice(0, 8).forEach(function (file) {
            items.push({ name: file.name, kind: file.kind, bytes: file.bytes })
          })
        }
        var data = {
          title: extra && extra.title ? extra.title : '',
          subtitle: currentSessionTitle() || (summary ? summary.name : ''),
          date: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }),
          items: items,
          lines: (extra && extra.lines) || [],
          mood: currentMood,
          style: style,
        }
        if (kind === 'progress') data.title = data.title || 'Progreso'
        if (kind === 'celebrate') data.title = data.title || '¡Tarea completada!'
        return data
      }

      function requestDoodle(kind, data, opts) {
        opts = opts || {}
        return fetch(DRAW_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: kind, data: data || buildDoodleData(kind) }),
        }).then(function (res) {
          return res.ok ? res.json() : null
        }).then(function (out) {
          if (!out || !out.url) return null
          var caption = opts.caption || pick(DRAW_CAPTIONS[kind] || DRAW_CAPTIONS.doodle)
          chatHistory.push({ role: 'mascot', text: caption, imageUrl: out.url })
          saveChatHistory()
          renderChatMessages()
          say(caption, 5000)
          setMood(kind === 'celebrate' ? 'happy' : 'neutral', { ms: 6000 })
          return out
        }).catch(function () { return null })
      }

      function requestProgressCard() {
        openChat()
        pollWorkspace({ force: true }).then(function () {
          return requestDoodle('progress', buildDoodleData('progress'), {
            caption: pick(DRAW_CAPTIONS.progress),
          })
        })
      }

      function sendChatMessage(textOverride) {
        if (chatPending) return
        var text = String(textOverride !== undefined ? textOverride : (chatInputEl ? chatInputEl.value : '')).trim()
        var pendingImages = chatAttachments.slice()
        if (!text && pendingImages.length === 0) return
        if (chatInputEl) {
          chatInputEl.value = ''
          autoGrowChatInput()
        }
        chatAttachments = []
        renderChatAttachments()
        var userEntry = {
          role: 'user',
          text: text,
          images: pendingImages.map(function (att) { return att.dataUrl }),
        }
        chatHistory.push(userEntry)
        saveChatHistory()
        renderChatMessages()
        chatPending = true
        if (chatSendBtn) chatSendBtn.disabled = true
        showChatTyping()
        if (chatBodyEl) chatBodyEl.scrollTop = chatBodyEl.scrollHeight

        var payload = {
          message: text || 'Te envío una imagen.',
          history: chatHistoryPrompt().slice(0, -1),
          love: loveLevel,
          confidence: loveLevel,
          style: style,
          sessionId: getLlmSessionId(),
          userId: getUserId(),
          context: buildWorkContext(),
        }
        if (pendingImages.length) {
          payload.images = pendingImages.map(function (att) {
            return { mimeType: att.mimeType, dataBase64: att.dataBase64, name: att.name }
          })
        }
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null
        var timer = ctrl ? setTimeout(function () {
          try { ctrl.abort() } catch (e) {}
        }, 300000) : null
        chatAbortCtrl = { ctrl: ctrl, timer: timer }
        var init = {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }
        if (ctrl) init.signal = ctrl.signal
        fetch(CHAT_URL, init)
          .then(function (res) {
            if (res.status === 415) {
              return res.json().catch(function () { return null }).then(function (body) {
                return { __unsupported: true, error: body && body.error }
              })
            }
            return res.ok ? res.json() : null
          })
          .then(function (data) {
            finishChatTurn()
            if (data && data.__unsupported) {
              appendChatMessage('sys', 'Tu modelo actual no puede ver imágenes. Elige un modelo con visión para que pueda comentarlas.')
              say('Con el modelo actual no puedo ver imágenes...', 4000)
              setMood('sad', { ms: 6000 })
              return
            }
            if (data && Array.isArray(data.images) && data.images.length) {
              var lastUser = null
              for (var i = chatHistory.length - 1; i >= 0; i--) {
                if (chatHistory[i].role === 'user') { lastUser = chatHistory[i]; break }
              }
              if (lastUser) {
                lastUser.images = data.images.filter(function (url) { return typeof url === 'string' })
                saveChatHistory()
                renderChatMessages()
              }
            }
            if (data && data.line) {
              var entry = { role: 'mascot', text: data.line }
              if (data.imageUrl) entry.imageUrl = data.imageUrl
              chatHistory.push(entry)
              saveChatHistory()
              appendChatMessage('mascot', data.line, data.imageUrl ? [data.imageUrl] : [])
              say(data.line, 5000)
              setMood(data.mood, { ms: 9000 })
              reactClass('wm-squish', 600)
            } else if (data && data.imageUrl) {
              chatHistory.push({ role: 'mascot', text: '', imageUrl: data.imageUrl })
              saveChatHistory()
              renderChatMessages()
            } else {
              var fallback = pick(CHAT_FALLBACK_LINES)
              chatHistory.push({ role: 'mascot', text: fallback })
              saveChatHistory()
              appendChatMessage('mascot', fallback)
              say(fallback)
              setMood('sad', { ms: 6000 })
              console.warn('[whale-maid-mascot] chat reply was empty; using a fixed line')
            }
          })
          .catch(function (err) {
            finishChatTurn()
            console.warn('[whale-maid-mascot] chat request failed', err)
            if (err && err.name === 'AbortError') {
              appendChatMessage('sys', 'Cancelado: tardé demasiado en pensar.')
              return
            }
            var fallback = pick(CHAT_FALLBACK_LINES)
            chatHistory.push({ role: 'mascot', text: fallback })
            saveChatHistory()
            appendChatMessage('mascot', fallback)
            say(fallback)
            setMood('sad', { ms: 6000 })
          })
      }

      function finishChatTurn() {
        chatPending = false
        clearChatAbort()
        hideChatTyping()
        if (chatSendBtn) chatSendBtn.disabled = false
        if (chatPanelEl && chatPanelEl.classList.contains('open') && chatInputEl) {
          try { chatInputEl.focus() } catch (e) {}
        }
      }

      // --- "Mis trabajos": workspace awareness ---------------------------------

      var WORKSHOP_LINES = [
        'Voy a echar un vistazo a tus trabajos.',
        'Déjame ver en qué has estado trabajando.',
        'Tus proyectos. Me gusta ver el avance 🐋',
      ]
      var ARTIFACT_LINES = [
        'Veo un archivo nuevo. ¿Es lo que estabas preparando?',
        'Entregable nuevo en el taller. ¿Quieres que lo mire?',
        'Vas sumando cosas, se nota el avance 🐋',
      ]
      var KIND_ICONS = {
        image: '🖼️', pdf: '📕', doc: '📝', slides: '📊', sheet: '📈',
        archive: '📦', audio: '🎵', video: '🎬', code: '💻', text: '📄', other: '📎',
      }
      var KIND_LABELS = {
        image: 'imagen', pdf: 'PDF', doc: 'documento', slides: 'presentación',
        sheet: 'hoja de cálculo', archive: 'comprimido', audio: 'audio',
        video: 'vídeo', code: 'código', text: 'texto', other: 'archivo',
      }
      var worksCommentAt = 0

      function currentSessionTitle() {
        var id = currentSessionId()
        if (!id) return ''
        try { return sessionTitle(id) || '' } catch (e) { return '' }
      }

      function defaultWorkspaceRoot() {
        ensureServices()
        try {
          var id = currentSessionId()
          var snap = __sessionsSvc && __sessionsSvc.list ? __sessionsSvc.list.getSnapshot() : null
          var row = id && snap && snap.byId ? snap.byId[id] : null
          if (row && typeof row.cwd === 'string' && row.cwd) return row.cwd
        } catch (e) {}
        try {
          var saved = storeGet(LS_WORKS_ROOT)
          if (saved) return saved
        } catch (e) {}
        return ''
      }

      function buildWorkContext() {
        var summary = workspaceSummary
        var context = {
          workspace: summary ? summary.name : '',
          session: currentSessionTitle(),
        }
        if (summary) {
          context.projects = (summary.projects || []).map(function (p) { return p.name }).slice(0, 8)
          context.recent = (summary.recent || []).slice(0, 6).map(function (f) { return { name: f.name } })
          context.artifacts = (summary.artifacts || []).slice(0, 6).map(function (f) { return { name: f.name } })
        }
        return context
      }

      function formatBytes(bytes) {
        var n = Number(bytes) || 0
        if (n < 1024) return n + ' B'
        if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB'
        if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
        return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB'
      }

      function timeAgo(ms) {
        if (!ms) return ''
        var diff = Math.max(0, Date.now() - Number(ms))
        var minutes = Math.floor(diff / 60000)
        if (minutes < 1) return 'ahora'
        if (minutes < 60) return 'hace ' + minutes + ' min'
        var hours = Math.floor(minutes / 60)
        if (hours < 24) return 'hace ' + hours + ' h'
        var days = Math.floor(hours / 24)
        return 'hace ' + days + ' d'
      }

      function fetchWorkspaceSummary() {
        var root = workspaceRoot || defaultWorkspaceRoot()
        workspaceRoot = root
        try {
          if (root) storeSet(LS_WORKS_ROOT, root)
        } catch (e) {}
        var url = WORKSPACE_URL + (root ? '?root=' + encodeURIComponent(root) : '')
        return fetch(url, { headers: { accept: 'application/json' } }).then(function (res) {
          if (!res.ok) throw new Error('workspace ' + res.status)
          return res.json()
        })
      }

      function pollWorkspace(opts) {
        opts = opts || {}
        if (workspacePolling) return Promise.resolve()
        if (document.hidden && !opts.force) return Promise.resolve()
        workspacePolling = true
        var before = workspaceFiles
        return fetchWorkspaceSummary().then(function (summary) {
          workspacePolling = false
          if (!summary) return
          workspaceSummary = summary
          var map = {}
          ;(summary.recent || []).concat(summary.artifacts || []).forEach(function (file) {
            if (file && file.path) map[file.path] = file.mtime
          })
          var now = Date.now()
          if (before) {
            var fresh = []
            Object.keys(map).forEach(function (path) {
              if (map[path] !== before[path] && map[path] > now - 180000) fresh.push(path)
            })
            if (fresh.length && now - lastArtifactAt > 60000) {
              lastArtifactAt = now
              var names = fresh.slice(0, 2).map(function (path) {
                var parts = path.split('/')
                return parts[parts.length - 1]
              })
              var context = buildWorkContext()
              context.artifacts = names.map(function (name) { return { name: name } })
              aiSay('artifact', pick(ARTIFACT_LINES), { context: context })
              showEmoji('🎁', 2400)
              reactClass('wm-wobble', 700)
            }
          }
          workspaceFiles = map
          if (worksPanelEl && worksPanelEl.classList.contains('open')) renderWorks()
        }).catch(function () {
          workspacePolling = false
        })
      }

      function startWorkspaceWatch() {
        clearInterval(workspaceTimer)
        workspaceTimer = setInterval(function () { pollWorkspace() }, 20000)
        setTimeout(function () { pollWorkspace({ force: true }) }, 1200)
      }

      function filePreviewUrl(file) {
        return WORKSPACE_FILE_URL +
          '?root=' + encodeURIComponent(workspaceRoot || '') +
          '&path=' + encodeURIComponent(file && file.path ? file.path : '')
      }

      function buildWorksPanel() {
        worksPanelEl = document.createElement('div')
        worksPanelEl.className = 'wm-works'
        worksPanelEl.setAttribute('role', 'dialog')
        worksPanelEl.setAttribute('aria-label', 'Mis trabajos')

        var head = document.createElement('div')
        head.className = 'wm-works-head'
        var who = document.createElement('div')
        who.className = 'who'
        who.textContent = '👀'
        var title = document.createElement('div')
        title.className = 't'
        title.textContent = 'Mis trabajos'
        var sub = document.createElement('small')
        sub.textContent = 'lo que creas en el harness'
        title.appendChild(sub)

        worksRefreshBtn = document.createElement('button')
        worksRefreshBtn.type = 'button'
        worksRefreshBtn.className = 'wm-works-refresh'
        worksRefreshBtn.textContent = '⟳'
        worksRefreshBtn.title = 'Actualizar'
        worksRefreshBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          pollWorkspace({ force: true })
        })

        worksCloseBtn = document.createElement('button')
        worksCloseBtn.type = 'button'
        worksCloseBtn.className = 'wm-works-close'
        worksCloseBtn.textContent = '✕'
        worksCloseBtn.title = 'Cerrar'
        worksCloseBtn.addEventListener('click', closeWorks)

        worksBodyEl = document.createElement('div')
        worksBodyEl.className = 'wm-works-body'
        worksSummaryEl = document.createElement('div')
        worksSummaryEl.className = 'wm-works-sum'
        worksSummaryEl.textContent = 'Buscando tus trabajos…'
        worksPreviewEl = document.createElement('div')
        worksPreviewEl.className = 'wm-works-preview'
        worksListEl = document.createElement('div')
        worksListEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;'

        head.appendChild(who)
        head.appendChild(title)
        head.appendChild(worksRefreshBtn)
        head.appendChild(worksCloseBtn)
        worksBodyEl.appendChild(worksSummaryEl)
        worksBodyEl.appendChild(worksPreviewEl)
        worksBodyEl.appendChild(worksListEl)
        worksPanelEl.appendChild(head)
        worksPanelEl.appendChild(worksBodyEl)
        worksPanelEl.addEventListener('pointerdown', function (e) { e.stopPropagation() })
        worksPanelEl.addEventListener('contextmenu', function (e) { e.stopPropagation() })
        head.addEventListener('pointerdown', onWorksHeadDown)
        head.addEventListener('pointermove', onWorksHeadMove)
        head.addEventListener('pointerup', onWorksHeadUp)
        head.addEventListener('pointercancel', onWorksHeadUp)
        document.body.appendChild(worksPanelEl)
        document.addEventListener('pointermove', onWorksHeadMove)
        document.addEventListener('pointerup', onWorksHeadUp)
        document.addEventListener('pointercancel', onWorksHeadUp)
      }

      function readWorksPos() {
        try {
          var raw = storeGet(LS_WORKS_POS)
          if (raw) {
            var parsed = JSON.parse(raw)
            if (parsed && typeof parsed.left === 'number' && typeof parsed.top === 'number') return parsed
          }
        } catch (e) {}
        return null
      }

      function saveWorksPos() {
        if (!worksPanelEl) return
        var left = parseInt(worksPanelEl.style.left, 10)
        var top = parseInt(worksPanelEl.style.top, 10)
        if (isNaN(left) || isNaN(top)) return
        try {
          storeSet(LS_WORKS_POS, JSON.stringify({ left: left, top: top }))
        } catch (e) {}
      }

      function clampWorksPanel() {
        if (!worksPanelEl) return
        var w = worksPanelEl.offsetWidth || 380
        var h = worksPanelEl.offsetHeight || 420
        var left = parseInt(worksPanelEl.style.left, 10)
        var top = parseInt(worksPanelEl.style.top, 10)
        if (isNaN(left)) left = 8
        if (isNaN(top)) top = 8
        left = Math.max(8, Math.min(window.innerWidth - w - 8, left))
        top = Math.max(8, Math.min(window.innerHeight - h - 8, top))
        worksPanelEl.style.left = left + 'px'
        worksPanelEl.style.top = top + 'px'
      }

      function placeWorksPanel() {
        if (!worksPanelEl) return
        var saved = readWorksPos()
        if (saved) {
          worksPanelEl.style.left = saved.left + 'px'
          worksPanelEl.style.top = saved.top + 'px'
          clampWorksPanel()
          return
        }
        var rect = root.getBoundingClientRect()
        var width = 380
        var height = Math.min(Math.round(window.innerHeight * 0.68), 560)
        var left = rect.left - width - 14
        if (left < 8) left = Math.min(window.innerWidth - width - 8, rect.right + 14)
        if (left < 8) left = 8
        var top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + rect.height - height))
        worksPanelEl.style.left = Math.round(left) + 'px'
        worksPanelEl.style.top = Math.round(top) + 'px'
        saveWorksPos()
      }

      function onWorksHeadDown(e) {
        if (!worksPanelEl) return
        if (e.button !== 0 && e.button !== undefined) return
        if (e.target && e.target.closest && e.target.closest('button')) return
        worksDrag.active = true
        worksDrag.moved = false
        worksDrag.offX = e.clientX - parseInt(worksPanelEl.style.left, 10)
        worksDrag.offY = e.clientY - parseInt(worksPanelEl.style.top, 10)
        worksPanelEl.classList.add('dragging')
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch (err) {}
        e.preventDefault()
        e.stopPropagation()
      }

      function onWorksHeadMove(e) {
        if (!worksDrag.active || !worksPanelEl) return
        worksDrag.moved = true
        worksPanelEl.style.left = (e.clientX - worksDrag.offX) + 'px'
        worksPanelEl.style.top = (e.clientY - worksDrag.offY) + 'px'
        e.preventDefault()
      }

      function onWorksHeadUp() {
        if (!worksDrag.active || !worksPanelEl) return
        worksDrag.active = false
        worksPanelEl.classList.remove('dragging')
        clampWorksPanel()
        saveWorksPos()
      }

      function workRow(file, subtitle) {
        var row = document.createElement('button')
        row.type = 'button'
        row.className = 'wm-works-row'
        row.setAttribute('data-path', file.path)
        var ico = document.createElement('span')
        ico.className = 'ico'
        if (file.kind === 'image') {
          var thumb = document.createElement('img')
          thumb.loading = 'lazy'
          thumb.alt = ''
          thumb.src = filePreviewUrl(file)
          ico.appendChild(thumb)
        } else {
          ico.textContent = KIND_ICONS[file.kind] || KIND_ICONS.other
        }
        var t = document.createElement('span')
        t.className = 't'
        var n = document.createElement('span')
        n.className = 'n'
        n.textContent = file.name
        var m = document.createElement('span')
        m.className = 'm'
        m.textContent = subtitle
        t.appendChild(n)
        t.appendChild(m)
        row.appendChild(ico)
        row.appendChild(t)
        row.addEventListener('click', function () { previewWorkFile(file, row) })
        return row
      }

      function addWorksSection(label) {
        var sec = document.createElement('div')
        sec.className = 'wm-works-sec'
        sec.textContent = label
        worksListEl.appendChild(sec)
      }

      function renderWorks() {
        if (!worksSummaryEl || !worksListEl) return
        worksListEl.innerHTML = ''
        var summary = workspaceSummary
        if (!summary) {
          worksSummaryEl.textContent = 'Buscando tus trabajos…'
          var empty = document.createElement('div')
          empty.className = 'wm-works-empty'
          empty.textContent = 'Aún no hay datos; pulsa ⟳ para volver a intentarlo.'
          worksListEl.appendChild(empty)
          return
        }
        worksSummaryEl.textContent = summary.name + ' · ' + summary.totals.files + ' archivos · ' +
          formatBytes(summary.totals.bytes)

        var seen = {}
        var artifacts = (summary.artifacts || []).slice(0, 8)
        if (artifacts.length) {
          addWorksSection('Entregables recientes')
          artifacts.forEach(function (file) {
            seen[file.path] = true
            worksListEl.appendChild(workRow(file,
              (KIND_LABELS[file.kind] || 'archivo') + ' · ' + formatBytes(file.bytes) + ' · ' + timeAgo(file.mtime)))
          })
        }
        var recent = (summary.recent || []).filter(function (file) { return !seen[file.path] }).slice(0, 10)
        if (recent.length) {
          addWorksSection('Archivos recientes')
          recent.forEach(function (file) {
            worksListEl.appendChild(workRow(file,
              (KIND_LABELS[file.kind] || 'archivo') + ' · ' + timeAgo(file.mtime)))
          })
        }
        var projects = (summary.projects || []).slice(0, 8)
        if (projects.length) {
          addWorksSection('Proyectos')
          projects.forEach(function (project) {
            var row = document.createElement('div')
            row.className = 'wm-works-row'
            row.style.cursor = 'default'
            var ico = document.createElement('span')
            ico.className = 'ico'
            ico.textContent = '📁'
            var t = document.createElement('span')
            t.className = 't'
            var n = document.createElement('span')
            n.className = 'n'
            n.textContent = project.name
            var m = document.createElement('span')
            m.className = 'm'
            m.textContent = project.files + ' archivos · ' + formatBytes(project.bytes) + ' · ' +
              timeAgo(project.lastMtime)
            t.appendChild(n)
            t.appendChild(m)
            row.appendChild(ico)
            row.appendChild(t)
            worksListEl.appendChild(row)
          })
        }
        if (!worksListEl.children.length) {
          var none = document.createElement('div')
          none.className = 'wm-works-empty'
          none.textContent = 'Tu workspace aún está vacío… ¡a crear cosas!'
          worksListEl.appendChild(none)
        }
      }

      function previewWorkFile(file, row) {
        if (!worksPreviewEl) return
        var active = worksListEl ? worksListEl.querySelectorAll('.wm-works-row.active') : []
        for (var i = 0; i < active.length; i++) active[i].classList.remove('active')
        if (row) row.classList.add('active')
        worksPreviewEl.classList.add('show')
        worksPreviewEl.innerHTML = ''
        var url = filePreviewUrl(file)
        fetch(url).then(function (res) {
          var type = (res.headers.get('content-type') || '').toLowerCase()
          if (type.indexOf('image/') === 0) {
            var img = document.createElement('img')
            img.alt = file.name
            img.src = url
            worksPreviewEl.appendChild(img)
            return
          }
          if (type.indexOf('application/pdf') === 0) {
            var frame = document.createElement('iframe')
            frame.src = url
            frame.title = file.name
            worksPreviewEl.appendChild(frame)
            return
          }
          if (type.indexOf('text/plain') === 0) {
            return res.text().then(function (text) {
              var pre = document.createElement('pre')
              pre.textContent = text.slice(0, 20000)
              worksPreviewEl.appendChild(pre)
            })
          }
          return res.json().then(function (meta) {
            var info = document.createElement('div')
            info.className = 'meta'
            info.textContent = (KIND_LABELS[meta.kind] || 'Archivo') + ' · ' +
              formatBytes(meta.bytes || 0) + ' — sin vista previa aquí; ábrelo desde tu workspace.'
            worksPreviewEl.appendChild(info)
          }).catch(function () {})
        }).catch(function () {
          var info = document.createElement('div')
          info.className = 'meta'
          info.textContent = 'No pude leer este archivo.'
          worksPreviewEl.appendChild(info)
        })
      }

      function openWorks() {
        if (!worksPanelEl) return
        placeWorksPanel()
        worksPanelEl.classList.add('open')
        renderWorks()
        pollWorkspace({ force: true })
        if (Date.now() - worksCommentAt > 90000) {
          worksCommentAt = Date.now()
          aiSay('workshop', pick(WORKSHOP_LINES))
        }
      }

      function closeWorks() {
        if (worksPanelEl) worksPanelEl.classList.remove('open')
      }

      function toggleWorks() {
        if (!worksPanelEl) return
        if (worksPanelEl.classList.contains('open')) closeWorks()
        else openWorks()
      }

      function onWorksToggleButton(e) {
        e.stopPropagation()
        resetIdleTimer()
        toggleWorks()
      }

      function onWorksMenuClick() {
        hideContextMenu()
        openWorks()
      }

      // --- mood poses (optional artwork in assets/poses/<mood>.png) -----------

      function loadPoseManifest() {
        fetch(POSES_MANIFEST_URL, { headers: { accept: 'application/json' } })
          .then(function (res) { return res.ok ? res.json() : null })
          .then(function (data) {
            if (data && data.poses && typeof data.poses === 'object') poseManifest = data
          })
          .catch(function () {})
      }

      function moodPose(mood) {
        if (!poseManifest || !poseManifest.poses) return null
        var outfit = OUTFIT_BY_STYLE[style]
        if (!outfit) return null
        var view = VIEW_BY_MOOD[mood] || 'front'
        return poseManifest.poses[outfit + '_' + view] || null
      }

      function setMood(mood, opts) {
        opts = opts || {}
        var normalized = typeof mood === 'string' ? mood.toLowerCase() : 'neutral'
        var emoji = opts.emoji !== undefined ? opts.emoji : MOOD_EMOJI[normalized]
        if (emoji) showEmoji(emoji, opts.emojiMs || 2000)
        var pose = moodPose(normalized)
        if (!pose || !img) return
        currentMood = normalized
        img.src = pose
        clearTimeout(moodTimer)
        moodTimer = setTimeout(restoreBasePose, opts.ms || 8000)
      }

      function restoreBasePose() {
        clearTimeout(moodTimer)
        moodTimer = null
        currentMood = 'neutral'
        if (img) img.src = STYLE_ASSETS[style] || ASSET_A
      }

      var MOOD_EMOJI = {
        happy: '😊',
        shy: '😳',
        love: '💖',
        angry: '💢',
        sad: '🥺',
        sleepy: '💤',
        surprised: '❗',
        thinking: '💭',
        neutral: '',
      }

      function callRpc(method, payload) {
        return fetch('/api/' + method, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: newRpcId(),
            method: method,
            payload: payload || {}
          }),
        }).then(function (res) {
          return res.json()
        }).then(function (data) {
          if (!data || !data.result) throw new Error('Respuesta no válida')
          if (!data.result.ok) {
            throw new Error((data.result.error && data.result.error.message) || method + ' falló')
          }
          return data.result.value
        })
      }

      function fetchSessionHistory(sessionId, maxMessages) {
        maxMessages = maxMessages || 100
        return callRpc('session.history', { sessionId: sessionId, maxMessages: maxMessages })
      }

      // --- random skits + explain term -----------------------------------------

      function resetIdleTimer() {
        lastInteractionAt = Date.now()
        clearTimeout(idleTimer)
        idleTimer = setTimeout(playRandomSkit, 60000)
      }

      function proactiveLevel() {
        var value = storeGet(LS_PROACTIVE)
        return PROACTIVE_GAPS[value] !== undefined ? value : 'normal'
      }

      function readAutoDraw() {
        return storeGet(LS_AUTO_DRAW) !== '0'
      }

      function cycleProactive() {
        var order = ['off', 'low', 'normal', 'high']
        var next = order[(order.indexOf(proactiveLevel()) + 1) % order.length]
        storeSet(LS_PROACTIVE, next)
        renderMainMenu()
        say(next === 'off' ? 'Vale, no te interrumpo.' : 'Proactividad: ' + next + '.')
      }

      function onAutoDrawMenuClick() {
        var next = !readAutoDraw()
        storeSet(LS_AUTO_DRAW, next ? '1' : '0')
        renderMainMenu()
        say(next ? 'Dibujos automáticos activados.' : 'Dibujos automáticos desactivados.')
      }

      function playRandomSkit() {
        if (!root || root.style.display === 'none' || document.hidden) {
          resetIdleTimer()
          return
        }
        if (explainMode ||
            (menuEl && menuEl.style.display === 'block') ||
            (archivedOverlay && archivedOverlay.style.display === 'flex') ||
            (chatPanelEl && chatPanelEl.classList.contains('open'))) {
          resetIdleTimer()
          return
        }
        var gap = PROACTIVE_GAPS[proactiveLevel()] || 0
        if (!gap) {
          resetIdleTimer()
          return
        }
        var now = Date.now()
        if (now - lastInteractionAt < gap || now - lastProactiveAt < gap) {
          idleTimer = setTimeout(playRandomSkit, 30000)
          return
        }
        lastProactiveAt = now
        var event = lastRunningState === true ? 'check-in' : 'idle'
        var lines = loveLevel >= 3 ? SKIT_HIGH_LINES.concat(SKIT_LINES) : SKIT_LINES
        aiSay(event, pick(lines))
        setMood(pick(['thinking', 'happy', 'neutral']), { ms: 7000 })
        if (Math.random() < 0.35) reactClass('wm-squish', 600)
        idleTimer = setTimeout(playRandomSkit, 60000)
      }

      function startExplainMode() {
        hideContextMenu()
        cancelExplainMode()
        if (!currentSessionId()) {
          say('No hay sesión activa; crea o abre una primero')
          return
        }
        explainMode = true
        say('Selecciona el texto que quieras explicar~')
      }

      function cancelExplainMode() {
        explainMode = false
        pendingExplainText = ''
        pendingExplainContext = ''
        hideExplainFloat()
      }

      function onExplainMenuClick() {
        startExplainMode()
      }

      function onExplainFloatClick() {
        var text = pendingExplainText || getSelectedText()
        if (!text) {
          cancelExplainMode()
          return
        }
        var paragraph = pendingExplainContext || getSelectionContext()
        hideExplainFloat()
        cancelExplainMode()
        var sessionId = currentSessionId()
        if (!sessionId) {
          say('No hay sesión activa; crea o abre una primero')
          return
        }
        fetchSessionHistory(sessionId, 20).then(function (value) {
          var recent = buildRecentContext((value && value.events) || [])
          handleExplainRequest(text, paragraph, recent)
        }, function () {
          handleExplainRequest(text, paragraph, '')
        })
      }

      function onOpenExplainPanelClick() {
        hideContextMenu()
        openExplainPanel()
      }

      function openExplainPanel() {
        if (!explainPanelEl) return
        explainPanelEl.style.display = 'flex'
        if (explainPanelBody && explainPanelBody.children.length === 0) {
          var empty = document.createElement('div')
          empty.className = 'wm-explain-empty'
          empty.textContent = 'Aún no hay explicaciones. Clic derecho en la mascota → Explicar término, selecciona el texto y envía~'
          explainPanelBody.appendChild(empty)
        }
        var currentId = currentSessionId()
        if (!currentId) return
        var cached = null
        try {
          cached = storeGet(explainSessionKey(currentId))
        } catch (e) {}
        if (!cached) return
        fetchSessionHistory(cached, 20).then(function (value) {
          var msgs = assistantMessages((value && value.events) || [])
          if (msgs.length && explainPanelBody && explainPanelBody.children.length === 1) {
            addExplainEntry('assistant', msgs[msgs.length - 1])
          }
        }).catch(function () {})
      }

      function closeExplainPanel() {
        if (explainPanelEl) explainPanelEl.style.display = 'none'
        clearExplainPolling()
        if (explainPanelBody) {
          var waitings = explainPanelBody.querySelectorAll('.wm-explain-entry.waiting')
          for (var i = 0; i < waitings.length; i++) waitings[i].remove()
        }
      }

      function clearExplainPolling() {
        clearTimeout(explainPanelTimer)
        explainPanelTimer = null
      }

      function addExplainEntry(role, text) {
        if (!explainPanelBody) return
        var empty = explainPanelBody.querySelector('.wm-explain-empty')
        if (empty) empty.remove()
        var entry = document.createElement('div')
        entry.className = 'wm-explain-entry ' + role
        entry.textContent = text
        explainPanelBody.appendChild(entry)
        explainPanelBody.scrollTop = explainPanelBody.scrollHeight
      }

      function explainSessionKey(sessionId) {
        return 'dsh-whale-maid-mascot:explain-session:' + sessionId
      }

      function getExplainSessionIds() {
        try {
          var raw = storeGet(LS_EXPLAIN_SESSIONS)
          var arr = raw ? JSON.parse(raw) : []
          return Array.isArray(arr) ? arr : []
        } catch (e) {
          return []
        }
      }

      function rememberExplainSession(id) {
        var arr = getExplainSessionIds()
        if (arr.indexOf(id) === -1) {
          arr.push(id)
          if (arr.length > 100) arr = arr.slice(-100)
          try {
            storeSet(LS_EXPLAIN_SESSIONS, JSON.stringify(arr))
          } catch (e) {}
        }
      }

      function isExplainSession(id) {
        return getExplainSessionIds().indexOf(id) !== -1
      }

      function ensureExplainSession(currentSessionId) {
        ensureServices()
        var key = explainSessionKey(currentSessionId)
        try {
          var cached = storeGet(key)
          if (cached) {
            var snap = __sessionsSvc && __sessionsSvc.list ? __sessionsSvc.list.getSnapshot() : null
            if (snap && snap.byId && snap.byId[cached]) return Promise.resolve(cached)
          }
        } catch (e) {}
        if (!__sessionsSvc || typeof __sessionsSvc.create !== 'function') {
          return Promise.reject(new Error('El servicio de sesiones no está disponible'))
        }
        var cwd = null
        var agentPreset = null
        try {
          var snap = __sessionsSvc.list.getSnapshot()
          var cur = snap.byId && snap.byId[currentSessionId]
          cwd = cur && cur.cwd ? cur.cwd : null
          agentPreset = cur && cur.agentPreset ? cur.agentPreset : null
        } catch (e) {}
        var opts = {}
        if (cwd) opts.cwd = cwd
        if (agentPreset) opts.agentPreset = agentPreset
        var created
        try {
          created = __sessionsSvc.create(opts)
        } catch (e) {
          return Promise.reject(e)
        }
        return Promise.resolve(created).then(function (newId) {
          rememberExplainSession(newId)
          try {
            storeSet(key, newId)
          } catch (e) {}
          if (__workspacesSvc && typeof __workspacesSvc.archiveSession === 'function') {
            try {
              var arch = __workspacesSvc.archiveSession(newId)
              if (arch && typeof arch.catch === 'function') arch.catch(function () {})
            } catch (e) {}
          }
          return newId
        })
      }

      function buildExplainPrompt(selectedText, paragraph, recentContext) {
        var prompt = 'Explica de forma sencilla, para alguien que empieza, el siguiente término o concepto.' +
          'Puedes apoyarte en el contexto de la conversación; usa un tono amable.\n\n' +
          'Texto seleccionado:\n«' + selectedText + '»\n\n'
        if (paragraph) prompt += 'Párrafo/contexto:\n' + paragraph + '\n\n'
        if (recentContext) prompt += 'Conversación reciente:\n' + recentContext + '\n'
        return prompt
      }

      function assistantMessages(events) {
        var out = []
        events.forEach(function (entry) {
          var ev = entry && entry.event ? entry.event : entry
          if (!ev || ev.type !== 'assistant/message') return
          var text = extractText(ev.data && ev.data.message && ev.data.message.content)
          if (text) out.push(text)
        })
        return out
      }

      function handleExplainRequest(selectedText, paragraph, recentContext) {
        var sessionId = currentSessionId()
        if (!sessionId) {
          say('No hay sesión activa; crea o abre una primero')
          return
        }
        openExplainPanel()
        if (explainPanelBody) {
          var oldWaitings = explainPanelBody.querySelectorAll('.wm-explain-entry.waiting')
          for (var i = 0; i < oldWaitings.length; i++) oldWaitings[i].remove()
        }
        addExplainEntry('user', 'Explica: ' + selectedText)
        var waiting = document.createElement('div')
        waiting.className = 'wm-explain-entry waiting'
        waiting.textContent = 'La IA está explicando…'
        explainPanelBody.appendChild(waiting)
        explainPanelBody.scrollTop = explainPanelBody.scrollHeight

        ensureExplainSession(sessionId).then(function (explainSessionId) {
          return fetchSessionHistory(explainSessionId, 20).then(function (value) {
            return {
              explainSessionId: explainSessionId,
              beforeCount: assistantMessages((value && value.events) || []).length
            }
          })
        }).then(function (info) {
          var prompt = buildExplainPrompt(selectedText, paragraph, recentContext)
          return sendPrompt(info.explainSessionId, prompt).then(function () {
            return info
          })
        }).then(function (info) {
          pollExplainResult(info.explainSessionId, waiting, info.beforeCount)
        }, function (err) {
          if (waiting.parentNode) waiting.remove()
          addExplainEntry('assistant', 'Error al enviar: ' + (err && err.message ? err.message : String(err)))
          say('La petición de explicación falló')
        })
      }

      function pollExplainResult(explainSessionId, waitingEl, beforeCount) {
        clearExplainPolling()
        var tries = 0
        var tick = function () {
          tries++
          fetchSessionHistory(explainSessionId, 20).then(function (value) {
            var msgs = assistantMessages((value && value.events) || [])
            if (msgs.length > beforeCount) {
              clearExplainPolling()
              if (waitingEl.parentNode) waitingEl.remove()
              addExplainEntry('assistant', msgs[msgs.length - 1])
              say('Explicación lista; está en el panel derecho')
              return
            }
            if (tries >= 60) {
              clearExplainPolling()
              if (waitingEl.parentNode) waitingEl.remove()
              addExplainEntry('assistant', 'Se agotó la espera; consulta el panel de explicaciones en un momento.')
              return
            }
            explainPanelTimer = setTimeout(tick, 2000)
          }, function () {
            if (tries >= 60) {
              clearExplainPolling()
              if (waitingEl.parentNode) waitingEl.remove()
              addExplainEntry('assistant', 'Se agotó la espera; consulta el panel de explicaciones en un momento.')
              return
            }
            explainPanelTimer = setTimeout(tick, 2000)
          })
        }
        tick()
      }

      function deleteSessionById(sessionId) {
        return fetch('/__chameleon/session/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId }),
        }).then(function (res) {
          return res.json()
        }).then(function (data) {
          if (!data || !data.ok) {
            throw new Error((data && data.error) || 'No se pudo borrar')
          }
          return data
        })
      }

      function getExplainMappings() {
        var out = []
        var prefix = 'dsh-whale-maid-mascot:explain-session:'
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i)
            if (key && key.indexOf(prefix) === 0) {
              var explainId = storeGet(key)
              if (explainId) {
                out.push({
                  key: key,
                  sourceId: key.slice(prefix.length),
                  explainId: explainId
                })
              }
            }
          }
        } catch (e) {}
        return out
      }

      var explainDeletesInFlight = Object.create(null)

      function deleteExplainSession(explainId) {
        if (explainDeletesInFlight[explainId]) return explainDeletesInFlight[explainId]
        var pending
        try {
          pending = Promise.resolve(deleteSessionById(explainId))
        } catch (e) {
          return Promise.reject(e)
        }
        var request = pending.then(function (result) {
          delete explainDeletesInFlight[explainId]
          return result
        }, function (err) {
          delete explainDeletesInFlight[explainId]
          throw err
        })
        explainDeletesInFlight[explainId] = request
        return request
      }

      function forgetExplainSession(explainId) {
        if (!explainId) return
        var stillMapped = getExplainMappings().some(function (m) {
          return m.explainId === explainId
        })
        if (stillMapped) return
        var arr = getExplainSessionIds().filter(function (id) {
          return id !== explainId
        })
        storeSet(LS_EXPLAIN_SESSIONS, JSON.stringify(arr))
      }

      function removeExplainMapping(key, explainId) {
        // A new explanation may have replaced this mapping while deletion was pending.
        if (storeGet(key) === explainId) storeRemove(key)
        forgetExplainSession(explainId)
      }

      function cleanupOrphanExplainSessions() {
        if (!__sessionsSvc || !__sessionsSvc.list) return
        var snap
        try {
          snap = __sessionsSvc.list.getSnapshot()
        } catch (e) {
          return
        }
        if (!snap || snap.phase !== 'ready') return
        var byId = snap.byId || {}
        var mappings = getExplainMappings()
        mappings.forEach(function (m) {
          var sourceExists = !!byId[m.sourceId]
          var explainExists = !!byId[m.explainId]
          if (!explainExists) {
            removeExplainMapping(m.key, m.explainId)
          } else if (!sourceExists) {
            deleteExplainSession(m.explainId).then(function () {
              removeExplainMapping(m.key, m.explainId)
            }, function () {})
          }
        })
      }

      function cleanupAllExplainSessions() {
        clearExplainPolling()
        var mappings = getExplainMappings()
        var ids = getExplainSessionIds()
        var unique = []
        mappings.forEach(function (m) {
          if (unique.indexOf(m.explainId) === -1) unique.push(m.explainId)
        })
        ids.forEach(function (id) {
          if (unique.indexOf(id) === -1) unique.push(id)
        })
        if (unique.length === 0) {
          if (explainPanelBody) explainPanelBody.innerHTML = ''
          say('No hay explicaciones que limpiar')
          return
        }
        var deletes = unique.map(function (id) {
          return deleteExplainSession(id).then(function () {
            return true
          }, function () {
            return false
          })
        })
        Promise.all(deletes).then(function (results) {
          var failed = results.filter(function (ok) { return !ok }).length
          mappings.forEach(function (m) {
            if (results[unique.indexOf(m.explainId)]) removeExplainMapping(m.key, m.explainId)
          })
          unique.forEach(function (id, i) {
            if (results[i]) forgetExplainSession(id)
          })
          if (explainPanelBody) explainPanelBody.innerHTML = ''
          if (failed > 0) {
            addExplainEntry('assistant', failed + ' sesiones ocultas no se pudieron borrar; se conservaron los registros, inténtalo más tarde.')
            say('Algunas explicaciones no se pudieron limpiar')
          } else {
            addExplainEntry('assistant', 'Historial de explicaciones limpiado.')
            say('Historial de explicaciones limpiado')
          }
        })
      }

      function onCleanupExplainClick() {
        if (typeof window.confirm === 'function') {
          if (!window.confirm('¿Borrar todo el historial de explicaciones?')) return
        }
        cleanupAllExplainSessions()
      }

      function setupExplainCleanupWatch() {
        ensureServices()
        if (explainListUnsubscribe) return
        if (__sessionsSvc && __sessionsSvc.list && typeof __sessionsSvc.list.subscribe === 'function') {
          explainListUnsubscribe = __sessionsSvc.list.subscribe(function () {
            cleanupOrphanExplainSessions()
          })
        }
        clearInterval(explainCleanupTimer)
        explainCleanupTimer = setInterval(cleanupOrphanExplainSessions, 30000)
      }

      function onMouseUpForExplain() {
        if (!explainMode) return
        var text = getSelectedText()
        if (!text) {
          pendingExplainText = ''
          pendingExplainContext = ''
          hideExplainFloat()
          return
        }
        pendingExplainText = text
        pendingExplainContext = getSelectionContext()
        showExplainFloat()
      }

      function showExplainFloat() {
        if (!explainBtnEl) return
        var sel = window.getSelection()
        if (!sel || !sel.rangeCount || sel.isCollapsed) {
          hideExplainFloat()
          return
        }
        var rect = sel.getRangeAt(0).getBoundingClientRect()
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          hideExplainFloat()
          return
        }
        var left = Math.min(rect.right + 8, window.innerWidth - 160)
        var top = Math.min(rect.bottom + 8, window.innerHeight - 44)
        explainBtnEl.style.left = Math.max(8, left) + 'px'
        explainBtnEl.style.top = Math.max(8, top) + 'px'
        explainBtnEl.style.display = 'block'
      }

      function hideExplainFloat() {
        if (explainBtnEl) explainBtnEl.style.display = 'none'
      }

      function getSelectedText() {
        try {
          var sel = window.getSelection()
          return sel ? String(sel.toString() || '').trim() : ''
        } catch (e) {
          return ''
        }
      }

      function getSelectionContext() {
        try {
          var sel = window.getSelection()
          if (!sel || !sel.rangeCount) return ''
          var node = sel.anchorNode
          if (!node) return ''
          var el = node.nodeType === 1 ? node : node.parentElement
          while (el && el !== document.body) {
            var text = (el.innerText || el.textContent || '').trim()
            if (text.length >= 20) return text.slice(0, 2000)
            el = el.parentElement
          }
          return ''
        } catch (e) {
          return ''
        }
      }

      function buildRecentContext(events) {
        var messages = []
        events.forEach(function (entry) {
          var ev = entry && entry.event ? entry.event : entry
          if (!ev || !ev.type) return
          if (ev.type === 'user/message') {
            var userText = extractText(ev.data && ev.data.content)
            if (userText) messages.push('Usuario: ' + userText)
          } else if (ev.type === 'assistant/message') {
            var assistantText = extractText(ev.data && ev.data.message && ev.data.message.content)
            if (assistantText) messages.push('Asistente: ' + assistantText)
          }
        })
        return messages.slice(-6).join('\n')
      }

      function sendPrompt(sessionId, text) {
        var payload = {
          sessionId: sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: text }]
        }
        if (typeof Intl !== 'undefined' && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions) {
          try {
            payload.clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
          } catch (e) {}
        }
        return callRpc('session.prompt', payload)
      }

      function placeInitial() {
        var saved = readPos()
        if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
          var left = saved.left
          var top = saved.top
          // Restore a relative spot when the window has changed size since the
          // position was saved (different monitor, smaller window...).
          if (saved.vw > 0 && saved.vh > 0 && window.innerWidth > 0 && window.innerHeight > 0) {
            left = left * window.innerWidth / saved.vw
            top = top * window.innerHeight / saved.vh
          }
          root.style.left = Math.round(left) + 'px'
          root.style.top = Math.round(top) + 'px'
        } else {
          root.style.left = Math.max(8, window.innerWidth - 150 - 14) + 'px'
          root.style.top = Math.max(8, window.innerHeight - 244 - 128) + 'px'
        }
        clampPos()
        savePos()
        lastViewport = { w: window.innerWidth, h: window.innerHeight }
      }

      function say(text, holdMs) {
        var ms = holdMs || 2400
        bubbleText.textContent = text || pick(GREETING_LINES)
        bubble.classList.add('show')
        bubbleLockUntil = Date.now() + ms + 300
        clearTimeout(bubbleTimer)
        bubbleTimer = setTimeout(function () {
          bubble.classList.remove('show')
        }, ms)
      }

      function showEmoji(ch, ms) {
        emojiEl.textContent = ch
        emojiEl.classList.remove('show')
        void emojiEl.offsetWidth // restart the pop animation
        emojiEl.classList.add('show')
        clearTimeout(emojiTimer)
        emojiTimer = setTimeout(function () {
          emojiEl.classList.remove('show')
        }, ms || 2200)
      }

      function showBlush(ms) {
        blushL.classList.add('show')
        blushR.classList.add('show')
        clearTimeout(blushTimer)
        blushTimer = setTimeout(function () {
          blushL.classList.remove('show')
          blushR.classList.remove('show')
        }, ms || 2600)
      }

      function reactClass(cls, ms) {
        root.classList.remove('wm-squish', 'wm-shake', 'wm-wobble')
        void root.offsetWidth
        root.classList.add(cls)
        clearTimeout(reactionTimer)
        reactionTimer = setTimeout(function () {
          root.classList.remove(cls)
        }, ms)
      }

      function setStyle(next, announce) {
        style = STYLE_ORDER.indexOf(next) !== -1 ? next : 'a'
        clearTimeout(moodTimer)
        moodTimer = null
        currentMood = 'neutral'
        img.src = STYLE_ASSETS[style] || ASSET_A
        if (style === 'c') {
          img.style.height = 'auto'
          img.style.width = '140px'
        } else if (style === 'b') {
          img.style.height = '214px'
          img.style.width = ''
        } else {
          img.style.height = '230px'
          img.style.width = ''
        }
        if (bodyWrap) bodyWrap.className = 'wm-body style-' + style
        if (root) {
          root.classList.remove('style-a', 'style-b', 'style-c', 'style-d', 'style-e', 'style-f')
          root.classList.add('style-' + style)
        }
        styleBtn.textContent = style.toUpperCase()
        try {
          storeSet(LS_STYLE, style)
        } catch (e) {}
        if (announce) {
          say(pick(STYLE_LINES[style] || STYLE_LINES.a))
        }
      }

      // One friendly tap reaction: no body zones, no flirting. Rapid clicking
      // still gets a mild comedic complaint instead of anger dialogue.
      function reactTap() {
        var leveled = addLove(1)
        setMood('happy', { emoji: '👋', ms: 5000 })
        if (leveled) levelUp()
        else zoneSay('tap', tapLine())
        reactClass('wm-squish', 600)
      }

      function reactAngry() {
        setMood('surprised', { emoji: '😵', ms: 6000, emojiMs: 2400 })
        say(pick(ANGRY_LINES), 3200)
        reactClass('wm-shake', 1200)
      }

      function recordRapidClick() {
        var now = Date.now()
        clickTimes.push(now)
        clickTimes = clickTimes.filter(function (t) { return now - t < 2600 })
        if (clickTimes.length >= 10) {
          clickTimes = []
          return true
        }
        return false
      }

      function reactAt(e) {
        if (recordRapidClick()) reactAngry()
        else reactTap()
      }

      function onPointerDown(e) {
        if (e.button !== 0) return
        if (e.target && e.target.classList && e.target.classList.contains('wm-btn')) return
        resetIdleTimer()
        drag.active = true
        drag.moved = false
        drag.pointerId = e.pointerId
        drag.offX = e.clientX - parseInt(root.style.left, 10)
        drag.offY = e.clientY - parseInt(root.style.top, 10)
        dragTilt = 0
        lastDragX = e.clientX
        lastDragY = e.clientY
        clearTimeout(reboundTimer)
        clearTimeout(dropTimer)
        if (bodyWrap) {
          bodyWrap.classList.remove('wm-rebound')
          bodyWrap.style.animation = ''
          bodyWrap.style.transform = ''
        }
        if (root) {
          root.classList.remove('wm-drop')
          root.style.animation = ''
        }
        root.classList.add('dragging')
        try {
          root.setPointerCapture(e.pointerId)
        } catch (err) {}
        e.preventDefault()
        e.stopPropagation()
      }

      function onPointerMove(e) {
        if (!drag.active) return
        var dx = e.clientX - drag.offX
        var dy = e.clientY - drag.offY
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true
        dragTilt = Math.max(-14, Math.min(14, (e.clientX - lastDragX) * 0.8))
        lastDragX = e.clientX
        lastDragY = e.clientY
        if (drag.moved && bodyWrap) {
          bodyWrap.style.transform = 'translateX(-50%) rotate(' + dragTilt + 'deg)'
        }
        root.style.left = dx + 'px'
        root.style.top = dy + 'px'
        root.style.right = 'auto'
        root.style.bottom = 'auto'
        e.preventDefault()
      }

      function finishDrag(e, opts) {
        if (!drag.active) return
        opts = opts || {}
        var wasMoved = drag.moved
        var tilt = dragTilt
        drag.active = false
        dragTilt = 0
        if (root) root.classList.remove('dragging')
        if (bodyWrap) {
          bodyWrap.classList.remove('wm-rebound')
          bodyWrap.style.animation = ''
          bodyWrap.style.transform = ''
        }
        if (root) {
          clampPos()
          savePos()
        }
        if (wasMoved && !opts.cancel) {
          playRebound(tilt)
          playDrop()
        } else if (!wasMoved && !opts.cancel) {
          resetIdleTimer()
          if (e) reactAt(e)
        }
      }

      function onPointerUp(e) {
        finishDrag(e)
      }

      // Safety net: a pointer released outside the window (or a lost pointer
      // capture) used to leave the body stuck at its drag angle. Finish the
      // drag from the window/document too, and clear the tilt on blur.
      function onWindowPointerUp(e) {
        finishDrag(null, { cancel: true })
      }

      function onWindowBlur() {
        finishDrag(null, { cancel: true })
      }

      function onHide(e) {
        e.stopPropagation()
        hideContextMenu()
        closeChat()
        closeWorks()
        resetIdleTimer()
        root.style.display = 'none'
        restoreBtn.style.display = 'block'
        try {
          storeSet(LS_HIDDEN, '1')
        } catch (err) {}
      }

      function onStyle(e) {
        e.stopPropagation()
        resetIdleTimer()
        var idx = STYLE_ORDER.indexOf(style)
        setStyle(STYLE_ORDER[(idx + 1) % STYLE_ORDER.length], true)
      }

      function onRestore() {
        root.style.display = 'block'
        restoreBtn.style.display = 'none'
        resetIdleTimer()
        try {
          storeSet(LS_HIDDEN, '0')
        } catch (err) {}
        say('Aquí estoy otra vez.')
      }

      function cleanup() {
        clearTimeout(swapTimer)
        clearTimeout(bubbleTimer)
        clearTimeout(emojiTimer)
        clearTimeout(blushTimer)
        clearTimeout(reactionTimer)
        clearTimeout(reboundTimer)
        clearTimeout(dropTimer)
        clearTimeout(archiveArmTimer)
        clearTimeout(feedArmTimer)
        clearTimeout(idleTimer)
        clearTimeout(moodTimer)
        moodTimer = null
        clearChatAbort()
        chatPending = false
        clearExplainPolling()
        if (explainListUnsubscribe) {
          explainListUnsubscribe()
          explainListUnsubscribe = null
        }
        clearInterval(explainCleanupTimer)
        explainCleanupTimer = null
        if (sessionWatchUnsubscribe) {
          sessionWatchUnsubscribe()
          sessionWatchUnsubscribe = null
        }
        clearInterval(sessionWatchTimer)
        sessionWatchTimer = null
        clearInterval(workspaceTimer)
        workspaceTimer = null
        document.removeEventListener('click', onDocumentClick)
        document.removeEventListener('contextmenu', onDocumentContextMenu)
        document.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('mouseup', onMouseUpForExplain)
        window.removeEventListener('resize', onWindowResize)
        window.removeEventListener('pointerup', onWindowPointerUp)
        window.removeEventListener('pointercancel', onWindowPointerUp)
        window.removeEventListener('blur', onWindowBlur)
        document.removeEventListener('scroll', onScrollCapture, true)
        document.removeEventListener('pointermove', onWorksHeadMove)
        document.removeEventListener('pointerup', onWorksHeadUp)
        document.removeEventListener('pointercancel', onWorksHeadUp)
        if (root && root.parentNode) root.parentNode.removeChild(root)
        if (restoreBtn && restoreBtn.parentNode) restoreBtn.parentNode.removeChild(restoreBtn)
        if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
        if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl)
        if (archivedOverlay && archivedOverlay.parentNode) archivedOverlay.parentNode.removeChild(archivedOverlay)
        if (explainBtnEl && explainBtnEl.parentNode) explainBtnEl.parentNode.removeChild(explainBtnEl)
        if (explainPanelEl && explainPanelEl.parentNode) explainPanelEl.parentNode.removeChild(explainPanelEl)
        if (chatPanelEl && chatPanelEl.parentNode) chatPanelEl.parentNode.removeChild(chatPanelEl)
        if (worksPanelEl && worksPanelEl.parentNode) worksPanelEl.parentNode.removeChild(worksPanelEl)
        if (chatInputEl && chatInputEl.parentNode) chatInputEl.parentNode.removeChild(chatInputEl)
        if (chatBodyEl && chatBodyEl.parentNode) chatBodyEl.parentNode.removeChild(chatBodyEl)
        root = null
        bodyWrap = null
        img = null
        bubble = null
        hideBtn = null
        styleBtn = null
        emojiEl = null
        blushL = null
        blushR = null
        restoreBtn = null
        menuEl = null
        archiveBtn = null
        newSessionBtn = null
        archivedListBtn = null
        archivedOverlay = null
        archivedPanel = null
        archivedListEl = null
        archivedDetailEl = null
        explainBtnEl = null
        explainPanelEl = null
        explainPanelBody = null
        explainPanelTimer = null
        explainMode = false
        openExplainPanelBtn = null
        commonPromptBtn = null
        notifBtn = null
        aiBtn = null
        chatBtn = null
        chatToggleBtn = null
        chatPanelEl = null
        chatBodyEl = null
        chatInputEl = null
        chatSendBtn = null
        chatClearBtn = null
        chatCloseBtn = null
        chatTypingEl = null
        chatDrag.active = false
        bubbleLockUntil = 0
        zoneSeq = 0
        worksDrag.active = false
        worksPanelEl = null
        worksBodyEl = null
        worksSummaryEl = null
        worksPreviewEl = null
        worksListEl = null
        worksToggleBtn = null
        worksBtn = null
        worksCloseBtn = null
        worksRefreshBtn = null
        workspaceSummary = null
        workspaceFiles = null
        workspacePolling = false
        poseManifest = null
        chatAbortCtrl = null
        __ctx = null
        __workspacesSvc = null
        __wsListSvc = null
        __sessionsSvc = null
      }

      function PromptSettingsSection() {
        if (!React) return null
        var useState = React.useState
        var useEffect = React.useEffect
        var itemsState = useState(getCustomPrompts)
        var items = itemsState[0]
        var setItems = itemsState[1]
        var labelState = useState('')
        var label = labelState[0]
        var setLabel = labelState[1]
        var textState = useState('')
        var text = textState[0]
        var setText = textState[1]
        var editState = useState(-1)
        var editIndex = editState[0]
        var setEditIndex = editState[1]

        useEffect(function () {
          saveCustomPrompts(items)
        }, [items])

        function addOrUpdate() {
          if (!label.trim() || !text.trim()) return
          var next = items.slice()
          if (editIndex >= 0) next[editIndex] = { label: label.trim(), text: text.trim() }
          else next.push({ label: label.trim(), text: text.trim() })
          setItems(next)
          setLabel('')
          setText('')
          setEditIndex(-1)
        }

        function startEdit(i) {
          setLabel(items[i].label)
          setText(items[i].text)
          setEditIndex(i)
        }

        function removeItem(i) {
          setItems(items.filter(function (_, idx) { return idx !== i }))
          if (editIndex === i) {
            setEditIndex(-1)
            setLabel('')
            setText('')
          }
        }

        var inputStyle = {
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid #cbd5e1',
          font: 'inherit',
          width: '100%',
          boxSizing: 'border-box'
        }
        var rowStyle = {
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: 8,
          marginBottom: 8
        }

        return React.createElement('div', { style: { padding: '16px', maxWidth: 680 } },
          React.createElement('h3', {}, '🐋 Mascota Whale-chan'),
          React.createElement('p', { style: { color: '#64748b', marginTop: 0 } },
            'Aquí gestionas los «Prompts frecuentes» del menú contextual. Se aplican al momento.'),
          React.createElement('div', {},
            items.map(function (p, i) {
              return React.createElement('div', { key: i, style: rowStyle },
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', { style: { fontWeight: 600 } }, p.label),
                  React.createElement('div', { style: { color: '#64748b', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, p.text)
                ),
                React.createElement('button', { type: 'button', onClick: function () { startEdit(i) } }, 'Editar'),
                React.createElement('button', { type: 'button', onClick: function () { removeItem(i) } }, 'Borrar')
              )
            })
          ),
          React.createElement('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
            React.createElement('input', {
              placeholder: 'Nombre',
              value: label,
              onChange: function (e) { setLabel(e.target.value) },
              style: inputStyle
            }),
            React.createElement('textarea', {
              placeholder: 'Contenido del prompt',
              value: text,
              onChange: function (e) { setText(e.target.value) },
              rows: 3,
              style: inputStyle
            }),
            React.createElement('button', {
              type: 'button',
              onClick: addOrUpdate,
              style: { alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }
            }, editIndex >= 0 ? 'Guardar cambios' : 'Añadir prompt')
          )
        )
      }

      function apply(ctx) {
        adoptServices(ctx)
        notifEnabled = readNotifEnabled()
        setupExplainCleanupWatch()
        setupSessionWatch()
        if (ctx && ctx.slots && React) {
          ctx.slots.inject('settings.section', function () {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'whale-maid-mascot',
              order: 100,
              label: 'Mascota Whale-chan'
            }, PromptSettingsSection)
          })
        }
        ready(function () {
          injectStyles()
          buildDom()
          love = readLove()
          loveLevel = getLoveLevel(love)
          chatHistory = readChatHistory()
          placeInitial()
          setStyle(readStyle(), false)
          loadPoseManifest()
          if (isHidden()) {
            root.style.display = 'none'
            restoreBtn.style.display = 'block'
          }
          root.addEventListener('pointerdown', onPointerDown, true)
          root.addEventListener('pointermove', onPointerMove, true)
          root.addEventListener('pointerup', onPointerUp, true)
          root.addEventListener('pointercancel', onPointerUp, true)
          root.addEventListener('contextmenu', onContextMenu)
          root.addEventListener('dragenter', onDragEnter, true)
          root.addEventListener('dragover', onDragOver, true)
          root.addEventListener('dragleave', onDragLeave, true)
          root.addEventListener('drop', onDrop, true)
          hideBtn.addEventListener('click', onHide)
          styleBtn.addEventListener('click', onStyle)
          if (chatToggleBtn) chatToggleBtn.addEventListener('click', onChatToggleButton)
          if (worksToggleBtn) worksToggleBtn.addEventListener('click', onWorksToggleButton)
          restoreBtn.addEventListener('click', onRestore)
          if (menuEl) {
            menuEl.addEventListener('pointerdown', function (e) { e.stopPropagation() })
            menuEl.addEventListener('click', function (e) { e.stopPropagation() })
          }
          document.addEventListener('click', onDocumentClick)
          document.addEventListener('contextmenu', onDocumentContextMenu)
          document.addEventListener('keydown', onKeyDown)
          document.addEventListener('mouseup', onMouseUpForExplain)
          window.addEventListener('resize', onWindowResize)
          window.addEventListener('pointerup', onWindowPointerUp)
          window.addEventListener('pointercancel', onWindowPointerUp)
          window.addEventListener('blur', onWindowBlur)
          document.addEventListener('scroll', onScrollCapture, true)
          resetIdleTimer()
          startWorkspaceWatch()
          // Small hook so browser tests can force a workspace poll without waiting.
          try { window.__whaleMaidPollWorkspace = function (opts) { return pollWorkspace(opts) } } catch (e) {}
        })
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return function () {
              cleanup()
            }
          }, 'whale-maid-mascot: in-page pet')
        }
      }

      exports.apply = apply
      exports.inject = ['workspaces', 'sessions', 'slots', 'uiWorkspace']
      return module.exports
    },
  })
}
