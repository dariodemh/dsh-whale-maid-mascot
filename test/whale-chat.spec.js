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

test('body zones show their own comments (head / chest / legs / skirt)', async ({ page }) => {
  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  const seen = []
  for (const y of [0.12, 0.33, 0.9, 0.6]) {
    await page.waitForTimeout(200)
    await tapZone(page, y)
    const text = (await page.locator('.wm-bubble').innerText()).trim()
    expect(text.length).toBeGreaterThan(0)
    seen.push(text)
  }
  // Four different zones -> four different comments.
  expect(new Set(seen).size).toBe(seen.length)
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
      body: JSON.stringify({ line: '¡Q-qué vergüenza... no me mires tanto!', mood: 'shy' }),
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
  await expect(mascotMsg).toHaveText('¡Q-qué vergüenza... no me mires tanto!')
  await expect(page.locator('.wm-chat-msg.user').last()).toHaveText('hola Whale-chan')
  // The speech bubble above the sprite repeats the reply.
  await expect(page.locator('.wm-bubble.show')).toHaveText('¡Q-qué vergüenza... no me mires tanto!')
  // shy -> side view of the current outfit.
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
    body: JSON.stringify({ line: 'Jeje, te recuerdo~', mood: 'happy' }),
  }))
  await openChat(page)
  await page.locator('.wm-chat-input').fill('¿te acuerdas de mí?')
  await page.locator('.wm-chat-input').press('Enter')
  await expect(page.locator('.wm-chat-msg.mascot').last()).toHaveText('Jeje, te recuerdo~')

  await page.reload()
  await expect(page.locator('.wm-root')).toBeVisible()
  await clickChatButton(page)
  await expect(page.locator('.wm-chat.open')).toBeVisible()
  await expect(page.locator('.wm-chat-msg.user').last()).toHaveText('¿te acuerdas de mí?')
  await expect(page.locator('.wm-chat-msg.mascot').last()).toHaveText('Jeje, te recuerdo~')
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
