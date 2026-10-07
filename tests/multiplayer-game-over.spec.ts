import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('lado de quem morreu fica opaco e apenas P1 reinicia o multiplayer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));
  await page.route(/\/src\/crossy\/game\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'const cameras = [engine.camera, engine.camera.clone()];';
    expect(source).toContain(marker);
    await route.fulfill({ response, body: source.replace(marker, `${marker} window.__localQA = { engine, players, states };`) });
  });
  await page.setViewportSize({ width: 1536, height: 696 });
  await page.goto('/');
  await expect(page).toHaveTitle('Crossy Road · CONEP');
  await page.getByRole('button', { name: 'Configurar multiplayer local' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Jogar', exact: true }).click();
  await page.evaluate(() => {
    const map = (window as any).__localQA.engine.gameMap;
    const generate = map.newRow;
    map.newRow = () => generate('grass');
    map.treeCollision = () => false;
    map.reset(); map.init();
  });

  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Pontuação do jogador 1')).toHaveText('1');
  await expect(page.getByLabel('Pontuação do jogador 2')).toHaveText('1');
  await page.evaluate(() => {
    const { engine, players } = (window as any).__localQA;
    players[0].isAlive = false;
    engine.gameOver(players[0]);
  });
  const overOne = page.getByLabel('Fim de jogo do jogador 1');
  await expect(overOne).toBeVisible();
  await expect(overOne).toHaveCSS('background-color', 'rgb(32, 53, 39)');
  await expect(page.getByLabel('Fim de jogo do jogador 2')).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(overOne).toBeVisible();
  for (let step = 2; step <= 14; step++) {
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Pontuação do jogador 2')).toHaveText(String(step));
  }
  await page.screenshot({ path: join(tmpdir(), 'conep-multiplayer-one-player-over.png') });

  await page.evaluate(() => {
    const { engine, players } = (window as any).__localQA;
    players[1].isAlive = false;
    engine.gameOver(players[1]);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const overTwo = page.getByLabel('Fim de jogo do jogador 2');
  await expect(overTwo).toBeVisible();
  await expect(overOne.getByText('Jogador 1: aperte para reiniciar')).toBeVisible();
  await expect(overTwo).toHaveCSS('background-color', 'rgb(32, 53, 39)');
  const bounds = await Promise.all([overOne.boundingBox(), overTwo.boundingBox()]);
  expect(bounds[0]).toMatchObject({ x: 0, y: 0, width: 390, height: 422 });
  expect(bounds[1]).toMatchObject({ x: 0, y: 422, width: 390, height: 422 });
  await page.keyboard.press('Enter');
  await expect(overOne).toBeVisible();
  await expect(overTwo).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), 'conep-multiplayer-both-over-mobile.png') });
  await page.keyboard.press('Space');
  await expect(overOne).toHaveCount(0);
  await expect(overTwo).toHaveCount(0);
  await expect(page.getByLabel('Pontuação do jogador 1')).toHaveText('0');
  await expect(page.getByLabel('Pontuação do jogador 2')).toHaveText('0');
  expect(errors).toEqual([]);
});
