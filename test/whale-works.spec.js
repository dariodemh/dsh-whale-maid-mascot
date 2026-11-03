// Browser tests for "Mis trabajos": workspace panel, previews, drag + live reactions.
import { test, expect } from '@playwright/test'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
)
const ROOT = 'C:\\Users\\Demo\\Documents\\demo-workspace'

function summary(extraFiles = []) {
  const files = [
    { path: 'proyecto/notas.md', name: 'notas.md', ext: 'md', kind: 'text', bytes: 120, mtime: Date.now() - 60000 },
    { path: 'logo.png', name: 'logo.png', ext: 'png', kind: 'image', bytes: 5000, mtime: Date.now() - 120000 },
    { path: 'entrega_final.pdf', name: 'entrega_final.pdf', ext: 'pdf', kind: 'pdf', bytes: 90000, mtime: Date.now() - 300000 },
    ...extraFiles,
  ]
  const artifacts = files.filter((f) => ['image', 'pdf', 'slides', 'doc', 'sheet'].includes(f.kind))
  return {
    root: ROOT,
    name: 'demo-workspace',
    totals: { files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), kinds: { image: 1, pdf: 1, text: 1 } },
    projects: [{ name: 'proyecto', files: 1, bytes: 120, lastMtime: Date.now() - 60000, artifacts: 0 }],
    recent: files.slice().sort((a, b) => b.mtime - a.mtime),
    artifacts: artifacts.slice().sort((a, b) => b.mtime - a.mtime),
    generatedAt: Date.now(),
  }
}

async function prepare(page, options = {}) {
  await page.addInitScript((root) => {
    localStorage.setItem('dsh-whale-maid-mascot:works-root', root)
    localStorage.removeItem('dsh-whale-maid-mascot:chat')
    localStorage.removeItem('dsh-whale-maid-mascot:works-pos')
    localStorage.setItem('dsh-whale-maid-mascot:style', 'd')
  }, ROOT)

  let phase = 'before'
  await page.route(/\/whale-maid-mascot\/workspace(\?|$)/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(phase === 'before' ? summary() : summary(options.extraFiles || [])),
  }))
  await page.route(/\/whale-maid-mascot\/workspace\/file\?/, (route) => {
    const url = new URL(route.request().url())
    const path = url.searchParams.get('path') || ''
    if (path.endsWith('.png')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX })
    }
    if (path.endsWith('.pdf')) {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4 test') })
    }
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '# notas\nhola mundo\n' })
  })
  await page.route('**/whale-maid-mascot/line', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ line: '¡Un entregable nuevo! Me encanta~', mood: 'happy' }),
  }))
  await page.route('**/whale-maid-mascot/chat', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ line: '¡Qué bonito proyecto!', mood: 'happy' }),
  }))

  await page.goto('/test/test.html')
  await expect(page.locator('.wm-root')).toBeVisible()
  await page.waitForFunction(() => typeof window.__whaleMaidPollWorkspace === 'function')
  return { setPhase: (next) => { phase = next } }
}

async function clickWorksButton(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('.wm-works-btn')
    if (btn) btn.click()
  })
}

test('the 👀 panel lists projects, recent files and deliverables', async ({ page }) => {
  await prepare(page)
  await clickWorksButton(page)
  await expect(page.locator('.wm-works.open')).toBeVisible()
  await expect(page.locator('.wm-works-head')).toContainText('Mis trabajos')
  await expect(page.locator('.wm-works-sum')).toContainText('demo-workspace')

  const rows = page.locator('.wm-works-row')
  await expect(rows.first()).toBeVisible()
  await expect(page.locator('.wm-works-body')).toContainText('Entregables recientes')
  await expect(page.locator('.wm-works-body')).toContainText('entrega_final.pdf')
  await expect(page.locator('.wm-works-body')).toContainText('notas.md')
  await expect(page.locator('.wm-works-body')).toContainText('Proyectos')
  await expect(page.locator('.wm-works-body')).toContainText('proyecto')
})

test('clicking a row previews text, images and pdfs', async ({ page }) => {
  await prepare(page)
  await clickWorksButton(page)

  await page.locator('.wm-works-row', { hasText: 'notas.md' }).click()
  await expect(page.locator('.wm-works-preview.show pre')).toContainText('hola mundo')

  await page.locator('.wm-works-row', { hasText: 'logo.png' }).click()
  await expect(page.locator('.wm-works-preview.show img')).toBeVisible()

  await page.locator('.wm-works-row', { hasText: 'entrega_final.pdf' }).click()
  await expect(page.locator('.wm-works-preview.show iframe')).toBeVisible()
})

test('the panel can be dragged and remembers its position', async ({ page }) => {
  await prepare(page)
  await clickWorksButton(page)
  const before = await page.locator('.wm-works').boundingBox()
  const head = await page.locator('.wm-works-head').boundingBox()
  await page.mouse.move(head.x + 70, head.y + 12)
  await page.mouse.down()
  await page.mouse.move(head.x + 70 - 140, head.y + 12 + 40, { steps: 6 })
  await page.mouse.up()
  const after = await page.locator('.wm-works').boundingBox()
  expect(Math.round(after.x)).toBe(Math.round(before.x) - 140)
  expect(Math.round(after.y)).toBeGreaterThan(Math.round(before.y))
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dsh-whale-maid-mascot:works-pos')))
  expect(Math.abs(saved.left - after.x)).toBeLessThan(2)
})

test('she reacts when a new deliverable appears', async ({ page }) => {
  const harness = await prepare(page, {
    extraFiles: [{
      path: 'entrega_v2.pdf', name: 'entrega_v2.pdf', ext: 'pdf', kind: 'pdf',
      bytes: 120000, mtime: Date.now(),
    }],
  })
  // Establish the baseline, then simulate a new file appearing in the workspace.
  await page.evaluate(() => window.__whaleMaidPollWorkspace({ force: true }))
  await page.waitForTimeout(200)
  harness.setPhase('after')
  await page.evaluate(() => window.__whaleMaidPollWorkspace({ force: true }))
  await expect(page.locator('.wm-bubble.show')).toContainText('entregable nuevo')
  await expect(page.locator('.wm-emoji.show')).toBeVisible()
})

test('chat messages carry the work context', async ({ page }) => {
  let chatBody = null
  await prepare(page)
  await page.route('**/whale-maid-mascot/chat', async (route) => {
    chatBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ line: '¡Qué bonito proyecto!', mood: 'happy' }),
    })
  })
  await page.evaluate(() => window.__whaleMaidPollWorkspace({ force: true }))
  await page.waitForTimeout(200)
  await page.evaluate(() => document.querySelector('.wm-chat-btn').click())
  await expect(page.locator('.wm-chat.open')).toBeVisible()
  await page.locator('.wm-chat-input').fill('¿qué opinas de mi trabajo?')
  await page.locator('.wm-chat-input').press('Enter')
  await expect(page.locator('.wm-chat-msg.mascot').last()).toHaveText('¡Qué bonito proyecto!')
  expect(chatBody && chatBody.context).toBeTruthy()
  expect(chatBody.context.workspace).toBe('demo-workspace')
  expect(chatBody.context.artifacts.some((f) => f.name === 'entrega_final.pdf')).toBe(true)
})
