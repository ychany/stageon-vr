// 브라우저 종단 테스트: PC 모드로 한 번의 공연을 끝까지 진행하고 화면을 저장한다.
// 사용법: python3 -m http.server 8080 실행 후  node test/e2e.mjs [시나리오 번호 0–4] [outDir]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // 전역 설치된 playwright (NODE_PATH)

const scenario = process.argv[2] || '2';
const out = process.argv[3] || 'shots';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8080/index.html?fast=1');
await page.check(`input[name=scenario][value="${scenario}"]`);
await page.fill('#name', '테스트');
await page.screenshot({ path: `${out}/0-menu.png` });
await page.click('#startDesktop');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/1-backstage.png` });

// 대기실이 끝날 때까지 기다린 뒤 무대로 걸어 나간다
await page.waitForFunction(() => window.stageon.state.phase === 'call', null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.keyboard.down('KeyW');
await page.waitForFunction(() => window.stageon.state.phase !== 'call', null, { timeout: 120000 });
await page.keyboard.up('KeyW');
await page.screenshot({ path: `${out}/2-hush.png` });
await page.waitForFunction(() => window.stageon.state.phase === 'perform', null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.keyboard.press('KeyG');
await page.keyboard.press('KeyM');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/3-mistake.png` });
await page.waitForTimeout(2500);
await page.keyboard.press('KeyM');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/4-perform.png` });

await page.waitForFunction(() => window.stageon.state.phase === 'report', null, { timeout: 300000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/5-report.png` });
const summary = await page.evaluate(() => {
  const s = window.stageon.state;
  return { scenario: s.sc.title, encore: !!s.encoreDone, events: s.events.map((e) => e.type), phase: s.phase, mistakes: s.mistakes.length, hrSamples: s.hrLog.length, baseline: Math.round(s.baseline), people: s.venue.people.length, director: s.director.log };
});
console.log(JSON.stringify(summary));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
