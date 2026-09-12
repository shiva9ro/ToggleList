import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const browserPath = process.env.BROWSER_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync)
if (!browserPath) throw new Error('Set BROWSER_PATH to a Chromium browser executable.')
const profile = mkdtempSync(join(tmpdir(), 'togglelist-browser-test-'))
let finish
const result = new Promise((resolve) => { finish = resolve })
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  plugins: [{
    name: 'browser-test-result',
    configureServer(vite) {
      vite.middlewares.use('/__test_result', (req, res) => {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => { res.end('ok'); finish(JSON.parse(body)) })
      })
    },
  }],
})
let browser
let timer
try {
  timer = setTimeout(() => finish({ ok: false, error: 'Browser test timed out' }), 60_000)
  await server.listen()
  const port = server.httpServer.address().port
  browser = spawn(browserPath, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--window-size=390,844',
    `http://127.0.0.1:${port}/tests/browser.html`,
  ], { windowsHide: true, stdio: 'ignore' })
  browser.once('error', (error) => finish({ ok: false, error: String(error) }))
  const report = await result
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
} finally {
  clearTimeout(timer)
  if (browser?.pid && browser.exitCode == null) {
    await new Promise((resolve) => { browser.once('exit', resolve); browser.kill() })
  }
  await server.close()
  // Only the freshly created test profile is removed.
  const target = resolve(profile)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('togglelist-browser-test-')) {
    console.error('Unexpected test profile directory; cleanup skipped')
    process.exitCode = 1
  } else {
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
