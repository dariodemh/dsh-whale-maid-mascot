// Browser regression tests for the Whale-chan chat panel, mood poses and taps.
// Playwright intercepts the AI routes, so no model or DSH app is needed.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const POSE_PNG = readFileSync(fileURLToPath(new URL('../assets/mascot_a.png', import.meta.url)))
const CHAT_BTN = '.wm-chat-btn'

async function clickChatButton(page) {
  // The button fades in on hover; a direct DOM click keeps the test layout-independent.
  await page.evaluate((sel) => {
    const btn = document.querySelector(sel)
    if (btn) btn.click()
  }, CHAT_BTN)
}

async function openChat(page) {
  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  await clickChatButton(page)
  await expect(page.locator('.wm-chat.open')).toBeVisible()
}

async function tapZone(page, yFrac) {
  await page.evaluate((y) => new Promise((resolve) => {
    const root = document.querySelector('.wm-root')
    const img = document.querySelector('.wm-img')
    if (!root || !img) return resolve(false)
    const rect = img.getBoundingClientRect()
    const opts = {
      bubbles: true, cancelable: true, button: 0, pointerId: 1,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height * y,
      pointerType: 'mouse', isPrimary: true,
    }
    root.dispatchEvent(new PointerEvent('pointerdown', opts))
    root.dispatchEvent(new PointerEvent('pointerup', opts))
    setTimeout(resolve, 80)
  }), yFrac)
}

test('the 💬 button opens the chat and taps no longer open it by accident', async ({ page }) => {
  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  await expect(page.locator('.wm-chat')).toBeHidden()

  await clickChatButton(page)
  await expect(page.locator('.wm-chat.open')).toBeVisible()
  await expect(page.locator('.wm-chat-head')).toContainText('Whale-chan')

  // Close again, then open from the right-click menu.
  await page.keyboard.press('Escape')
  await expect(page.locator('.wm-chat.open')).toBeHidden()
  await page.locator('.wm-root').dispatchEvent('contextmenu', { clientX: 260, clientY: 200 })
  const menuItem = page.locator('.wm-menu-item', { hasText: 'Hablar con Whale-chan' })
  await expect(menuItem).toBeVisible()
  await menuItem.click()
  await expect(page.locator('.wm-chat.open')).toBeVisible()

  // A rapid double tap on the body must react, not toggle the chat.
  await page.keyboard.press('Escape')
  await expect(page.locator('.wm-chat.open')).toBeHidden()
  await tapZone(page, 0.12)
  await tapZone(page, 0.33)
  await expect(page.locator('.wm-chat.open')).toBeHidden()
})

test('taps get a neutral companion reaction, without flirting', async ({ page }) => {
  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  const seen = []
  for (const y of [0.2, 0.6]) {
    await page.waitForTimeout(200)
    await tapZone(page, y)
    const text = (await page.locator('.wm-bubble').innerText()).trim()
    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toMatch(/amo|pecho|falda|pervert|vergüenza|corazón|piernas/i)
    seen.push(text)
  }
  expect(seen.length).toBe(2)
  await expect(page.locator('.wm-chat.open')).toBeHidden()
})

test('the chat panel can be dragged by its header and remembers the position', async ({ page }) => {
  await openChat(page)
  const before = await page.locator('.wm-chat').boundingBox()
  const head = await page.locator('.wm-chat-head').boundingBox()
  await page.mouse.move(head.x + 60, head.y + 12)
  await page.mouse.down()
  await page.mouse.move(head.x + 60 - 120, head.y + 12 + 40, { steps: 6 })
  await page.mouse.up()
  const after = await page.locator('.wm-chat').boundingBox()
  expect(Math.round(after.x)).toBe(Math.round(before.x) - 120)
  expect(Math.round(after.y)).toBeGreaterThan(Math.round(before.y))

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-whale-maid-mascot:chat-pos')))
  expect(Math.abs(saved.left - after.x)).toBeLessThan(2)
  expect(Math.abs(saved.top - after.y)).toBeLessThan(2)

  // Reopening keeps the dragged position instead of snapping back.
  await page.keyboard.press('Escape')
  await clickChatButton(page)
  const reopened = await page.locator('.wm-chat').boundingBox()
  expect(Math.abs(reopened.x - after.x)).toBeLessThan(2)
  expect(Math.abs(reopened.y - after.y)).toBeLessThan(2)
})

test('chat replies, shows the text in the bubble and swaps to the mood pose', async ({ page }) => {
  let chatBody = null
  const poses = {
    school_front: '/whale-maid-mascot/poses/school_front.png',
    school_side: '/whale-maid-mascot/poses/school_side.png',
    school_back: '/whale-maid-mascot/poses/school_back.png',
  }
  await page.route('**/whale-maid-mascot/poses.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ moods: ['shy'], poses }),
  }))
  await page.route('**/whale-maid-mascot/poses/*.png', (route) => route.fulfill({
    status: 200, contentType: 'image/png', body: POSE_PNG,
  }))
  await page.route('**/whale-maid-mascot/chat', async (route) => {
    chatBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ line: 'Mmm, déjame pensarlo un momento.', mood: 'thinking' }),
    })
  })

  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  // Switch to the school uniform (style A -> D): mood poses need a non-chibi outfit.
  await page.evaluate(() => document.querySelector('.wm-style').click())
  await expect(page.locator('.wm-img')).toHaveAttribute('src', /poses\/school_front\.png/)

  await clickChatButton(page)
  await expect(page.locator('.wm-chat.open')).toBeVisible()
  await page.locator('.wm-chat-input').fill('hola Whale-chan')
  await page.locator('.wm-chat-input').press('Enter')

  const mascotMsg = page.locator('.wm-chat-msg.mascot').last()
  await expect(mascotMsg).toHaveText('Mmm, déjame pensarlo un momento.')
  await expect(page.locator('.wm-chat-msg.user').last()).toHaveText('hola Whale-chan')
  // The speech bubble above the sprite repeats the reply.
  await expect(page.locator('.wm-bubble.show')).toHaveText('Mmm, déjame pensarlo un momento.')
  // thinking -> side view of the current outfit.
  await expect(page.locator('.wm-img')).toHaveAttribute('src', /poses\/school_side\.png/)

  // The request carries the user message, the affection level and the LLM session id.
  expect(chatBody && chatBody.message).toBe('hola Whale-chan')
  expect(typeof chatBody.love).toBe('number')
  expect(String(chatBody.sessionId)).toMatch(/^whale-chan-/)
})

test('style button cycles the non-chibi outfits instead of the chibi ones', async ({ page }) => {
  await page.route('**/whale-maid-mascot/poses/*.png', (route) => route.fulfill({
    status: 200, contentType: 'image/png', body: POSE_PNG,
  }))
  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  const srcs = []
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => document.querySelector('.wm-style').click())
    srcs.push(await page.locator('.wm-img').getAttribute('src'))
  }
  expect(srcs).toEqual([
    '/whale-maid-mascot/poses/school_front.png',
    '/whale-maid-mascot/poses/hoodie_front.png',
    '/whale-maid-mascot/poses/xiaohei_front.png',
    '/whale-maid-mascot/a.png',
  ])
})

test('chat keeps its history after a reload', async ({ page }) => {
  await page.route('**/whale-maid-mascot/chat', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ line: 'Me acuerdo de ti, sí.', mood: 'happy' }),
  }))
  await openChat(page)
  await page.locator('.wm-chat-input').fill('¿te acuerdas de mí?')
  await page.locator('.wm-chat-input').press('Enter')
  await expect(page.locator('.wm-chat-msg.mascot').last()).toHaveText('Me acuerdo de ti, sí.')

  await page.reload()
  await expect(page.locator('.wm-root')).toBeVisible()
  await clickChatButton(page)
  await expect(page.locator('.wm-chat.open')).toBeVisible()
  await expect(page.locator('.wm-chat-msg.user').last()).toHaveText('¿te acuerdas de mí?')
  await expect(page.locator('.wm-chat-msg.mascot').last()).toHaveText('Me acuerdo de ti, sí.')
})

test('the chat accepts an attached image and sends it to the host', async ({ page }) => {
  let chatBody = null
  await page.route('**/whale-maid-mascot/image**', (route) => route.fulfill({
    status: 200, contentType: 'image/png', body: POSE_PNG,
  }))
  await page.route('**/whale-maid-mascot/chat', async (route) => {
    chatBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        line: 'Veo la imagen. Bonita captura.',
        mood: 'happy',
        images: ['/whale-maid-mascot/image?id=sha256%3Atest'],
      }),
    })
  })
  await openChat(page)
  await page.locator('.wm-chat input[type=file]').setInputFiles({
    name: 'captura.png',
    mimeType: 'image/png',
    buffer: POSE_PNG,
  })
  await expect(page.locator('.wm-chat-chip img')).toBeVisible()
  await page.locator('.wm-chat-input').fill('mira esta captura')
  await page.locator('.wm-chat-input').press('Enter')
  await expect(page.locator('.wm-chat-msg.mascot').last()).toContainText('Veo la imagen')
  expect(Array.isArray(chatBody && chatBody.images)).toBe(true)
  expect(chatBody.images[0].mimeType).toBe('image/png')
  expect(typeof chatBody.images[0].dataBase64).toBe('string')
  await expect(page.locator('.wm-chat-msg.user .wm-chat-img')).toHaveCount(1)
})

test('the 🖼️ button requests a progress drawing and shows it in the chat', async ({ page }) => {
  let drawBody = null
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480"><rect width="720" height="480" fill="#0b1220"/><text x="40" y="80" fill="#e2e8f0">Progreso</text></svg>'
  await page.route('**/whale-maid-mascot/draw.svg**', (route) => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: svg,
  }))
  await page.route('**/whale-maid-mascot/draw', async (route) => {
    drawBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: '/whale-maid-mascot/draw.svg?id=test', kind: 'progress', width: 720, height: 480 }),
    })
  })
  await openChat(page)
  await page.locator('.wm-chat-draw').click()
  await expect(page.locator('.wm-chat-msg.mascot .wm-chat-img').last()).toBeVisible()
  expect(drawBody && drawBody.kind).toBe('progress')
})

test('the companion menu exposes proactive and auto-draw settings', async ({ page }) => {
  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  await page.locator('.wm-root').dispatchEvent('contextmenu', { clientX: 260, clientY: 200 })
  await expect(page.locator('.wm-menu-item', { hasText: 'Proactividad' })).toBeVisible()
  await expect(page.locator('.wm-menu-item', { hasText: 'Dibujos automáticos' })).toBeVisible()
})

test('the pet follows viewport resizes and stays inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  const before = await page.locator('.wm-root').boundingBox()

  // Shrink: the pet should move to keep the same relative spot...
  await page.setViewportSize({ width: 640, height: 480 })
  await page.waitForTimeout(350)
  const small = await page.locator('.wm-root').boundingBox()
  expect(small.x).toBeLessThan(before.x)
  expect(small.y).toBeLessThan(before.y)
  // ...and stay reachable (at least a good part of it on screen).
  expect(small.x + small.width).toBeGreaterThan(320)
  expect(small.y).toBeLessThan(480)

  // Grow again: it must not be left off screen.
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForTimeout(350)
  const grown = await page.locator('.wm-root').boundingBox()
  expect(grown.x).toBeGreaterThanOrEqual(0)
  expect(grown.y).toBeGreaterThanOrEqual(0)
  expect(grown.x + grown.width).toBeLessThanOrEqual(1400 + 45)

  // The saved position also carries the viewport it was authored at.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-whale-maid-mascot:pos')))
  expect(saved.vw).toBe(1400)
  expect(saved.vh).toBe(900)
})

test('a failed reply falls back to a soft in-character line', async ({ page }) => {
  await page.route('**/whale-maid-mascot/chat', (route) => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'model error: quota exceeded' }),
  }))
  await openChat(page)
  await page.locator('.wm-chat-input').fill('¿estás ahí?')
  await page.locator('.wm-chat-input').press('Enter')
  await expect(page.locator('.wm-chat-msg.typing')).toHaveCount(0)
  await expect(page.locator('.wm-chat-msg.mascot').last()).toBeVisible()
  await expect(page.locator('.wm-bubble.show')).toBeVisible()
})
