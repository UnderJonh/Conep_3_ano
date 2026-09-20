import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = join(tmpdir(), 'conep-crossy-qa');

test('single player muda a progressão na metade do recorde e recebe a coroa ao superar', async ({ page }) => {
  mkdirSync(directory, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [{
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    nome: 'Recordista',
    pontos: 2,
    created_at: '2026-09-20T12:00:00Z',
  }] }));
  await page.addInitScript(() => {
    const audioWindow = window as Window & { qaMusicLoops?: number[] };
    audioWindow.qaMusicLoops = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (this.buffer && this.loop) audioWindow.qaMusicLoops!.push(this.buffer.duration);
      start.apply(this, args);
    };
  });

  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto('/');
  await expect(page.getByLabel('Recorde', { exact: true })).toContainText('2');
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();

  const thresholds = await page.evaluate(async () => {
    const { recordProgress } = await import('/src/lib/recordProgress.ts');
    return [recordProgress(1, 0), recordProgress(49, 100), recordProgress(50, 100), recordProgress(100, 100), recordProgress(101, 100)];
  });
  expect(thresholds).toEqual([
    { stage: 'normal', crowned: false },
    { stage: 'normal', crowned: false },
    { stage: 'near', crowned: false },
    { stage: 'near', crowned: false },
    { stage: 'victory', crowned: true },
  ]);

  await page.keyboard.press('Space');
  await expect(page.getByLabel('Pontuação')).toHaveText('1');
  await expect.poll(() => page.evaluate(() => (window as Window & { qaMusicLoops: number[] }).qaMusicLoops
    .some(duration => Math.abs(duration - 32 * 60 / 126) < 0.2))).toBe(true);
  await expect(page.locator('canvas.game-canvas')).toHaveAttribute('data-crowned', 'false');

  await page.keyboard.press('Space');
  await expect(page.getByLabel('Pontuação')).toHaveText('2');
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Pontuação')).toHaveText('3');
  await expect.poll(() => page.evaluate(() => (window as Window & { qaMusicLoops: number[] }).qaMusicLoops
    .some(duration => Math.abs(duration - 32 * 60 / 138) < 0.2))).toBe(true);
  await expect(page.locator('canvas.game-canvas')).toHaveAttribute('data-crowned', 'true');
  await page.screenshot({ path: join(directory, 'record-crown-victory.png') });
  expect(errors).toEqual([]);
});
