import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('digitar GOD em qualquer tela ativa invencibilidade em todos os modos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));
  await page.route(/\/src\/crossy\/game\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    const body = (await response.text())
      .replaceAll('const engine = new Engine();', 'const engine = new Engine(); (window.__godModeEngines ??= []).push(engine);')
      .replace('const players = [engine._hero, secondHero];', 'const players = [engine._hero, secondHero]; window.__godModePlayers = players;');
    await route.fulfill({ response, body });
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Crossy Road · CONEP');
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();

  await page.getByRole('button', { name: 'Ranking de jogadores' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.type('GoD');
  await expect(page.locator('main')).toHaveAttribute('data-god-mode', 'active');
  await page.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.getByText('GOD MODE', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Mover galinha para frente' }).click();
  await expect(page.getByLabel('Pontuação', { exact: true })).toHaveText('1');
  const singlePlayerSurvived = await page.evaluate(async () => {
    const engine = (window as any).__godModeEngines.at(-1);
    await engine.onCollide({}, 'water', undefined, engine._hero);
    return engine._hero.isAlive;
  });
  expect(singlePlayerSurvived).toBe(true);
  await expect(page.getByText('Fim de jogo', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(tmpdir(), 'conep-god-mode-single.png') });

  await page.getByRole('button', { name: 'Configurar multiplayer local' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Jogar', exact: true }).click();
  await expect(page.getByLabel('Placar multiplayer local')).toBeVisible();
  const localPlayersSurvived = await page.evaluate(async () => {
    const engine = (window as any).__godModeEngines.at(-1);
    const players = (window as any).__godModePlayers;
    await engine.onCollide({}, 'water', undefined, players[0]);
    await engine.onCollide({}, 'feathers', 'train', players[1]);
    return players.map((player: any) => ({ alive: player.isAlive, invincible: player.invincible }));
  });
  expect(localPlayersSurvived).toEqual([
    { alive: true, invincible: true },
    { alive: true, invincible: true },
  ]);
  await expect(page.getByText('Fim de jogo', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(tmpdir(), 'conep-god-mode-local.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBadgeIsClear = await page.getByText('GOD MODE', { exact: true }).evaluate(element => {
    const badge = element.getBoundingClientRect();
    const playerHud = document.querySelector('.local-hud-player')?.getBoundingClientRect();
    const insideViewport = badge.left >= 0 && badge.top >= 0 && badge.right <= innerWidth && badge.bottom <= innerHeight;
    const overlapsHud = playerHud
      ? badge.left < playerHud.right && badge.right > playerHud.left && badge.top < playerHud.bottom && badge.bottom > playerHud.top
      : false;
    return insideViewport && !overlapsHud;
  });
  expect(mobileBadgeIsClear).toBe(true);
  await page.screenshot({ path: join(tmpdir(), 'conep-god-mode-local-mobile.png') });

  await page.keyboard.type('HuMaN');
  await expect(page.locator('main')).toHaveAttribute('data-god-mode', 'inactive');
  await expect(page.getByText('GOD MODE', { exact: true })).toHaveCount(0);
  const playersAreHuman = await page.evaluate(() => (window as any).__godModePlayers.map((player: any) => player.invincible));
  expect(playersAreHuman).toEqual([false, false]);
  await page.getByRole('button', { name: 'Mover jogador 1 para frente' }).click();
  await expect(page.getByLabel('Pontuação do jogador 1')).toHaveText('1');
  const humanPlayerSurvived = await page.evaluate(async () => {
    const engine = (window as any).__godModeEngines.at(-1);
    const player = (window as any).__godModePlayers[0];
    await engine.onCollide({}, 'water', undefined, player);
    return player.isAlive;
  });
  expect(humanPlayerSurvived).toBe(false);
  await expect(page.getByLabel('Fim de jogo do jogador 1')).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), 'conep-human-mode-local-mobile.png') });
  expect(errors).toEqual([]);
});
