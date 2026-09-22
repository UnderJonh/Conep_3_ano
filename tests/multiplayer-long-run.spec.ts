import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('multiplayer mantém os comandos e enquadra os jogadores após vários passos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));
  await page.route(/\/src\/crossy\/game\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'const cameras = [engine.camera, engine.camera.clone()];';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `${marker} window.__localQA = { engine, players, states, pending, viewOffsets, cameras };`) });
  });

  await page.setViewportSize({ width: 1536, height: 696 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Configurar multiplayer local' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Jogar', exact: true }).click();
  await expect(page.getByLabel('Pontuação do jogador 2')).toHaveText('0');
  await page.evaluate(() => {
    const map = (window as any).__localQA.engine.gameMap;
    const generate = map.newRow;
    map.newRow = () => generate('grass');
    map.treeCollision = () => false;
    map.reset(); map.init();
  });

  const score = page.getByLabel('Pontuação do jogador 2');
  const scoreOne = page.getByLabel('Pontuação do jogador 1');
  for (let step = 1; step <= 18; step++) {
    await page.keyboard.press('Enter');
    await expect(score).toHaveText(String(step));
  }
  await page.screenshot({ path: join(tmpdir(), 'conep-multiplayer-after-18.png') });
  await page.evaluate(() => { (window as any).__localQA.players[1].position.z += 12; });
  await expect.poll(() => page.evaluate(() => {
    const qa = (window as any).__localQA;
    return qa.viewOffsets[1].z - (8 - qa.players[1].position.z);
  })).toBe(0);
  await page.screenshot({ path: join(tmpdir(), 'conep-multiplayer-camera-recovered.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => (window as any).__localQA.cameras[0].zoom)).toBe(97.5);
  await expect(page.locator('canvas.game-canvas')).toHaveCSS('width', '390px');
  await page.screenshot({ path: join(tmpdir(), 'conep-multiplayer-mobile-after-18.png') });
  const state = await page.evaluate(() => {
    const qa = (window as any).__localQA;
    return { states: qa.states, positions: qa.players.map((player: any) => player.position.z), rows: Object.keys(qa.engine.gameMap.floorMap).length, offsets: qa.viewOffsets };
  });
  expect(state.states).toEqual(['home', 'playing']);
  await expect(scoreOne).toHaveText('0');
  expect(state.positions[1]).toBeGreaterThan(25);
  expect(errors).toEqual([]);
});
