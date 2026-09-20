import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = join(tmpdir(), 'conep-crossy-qa');

test('multiplayer local compartilha o mundo, separa placares e usa Espaço e Enter', async ({ page }) => {
  mkdirSync(directory, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));

  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Multiplayer local', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Escolha o modo' })).toBeVisible();
  const playerOne = dialog.getByRole('region', { name: 'Jogador 1' });
  const playerTwo = dialog.getByRole('region', { name: 'Jogador 2' });
  await playerOne.getByRole('button', { name: 'Rodinhas', exact: true }).click();
  await playerOne.getByRole('button', { name: 'Azul · jogador 1' }).click();
  await playerTwo.getByRole('button', { name: 'Toucinho', exact: true }).click();
  await playerTwo.getByRole('button', { name: 'Lilás · jogador 2' }).click();
  await expect(playerOne.getByRole('button', { name: 'Rodinhas', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(playerTwo.getByRole('button', { name: 'Toucinho', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: join(directory, 'multiplayer-setup.png') });

  await dialog.getByRole('button', { name: 'Jogar', exact: true }).click();
  await expect(page.locator('canvas.game-canvas')).toHaveCount(1);
  const scoreOne = page.getByLabel('Pontuação do jogador 1');
  const scoreTwo = page.getByLabel('Pontuação do jogador 2');
  await expect(scoreOne).toHaveText('0');
  await expect(scoreTwo).toHaveText('0');
  await expect(page.getByText('ESPAÇO', { exact: true })).toBeVisible();
  await expect(page.getByText('ENTER', { exact: true })).toBeVisible();

  await page.keyboard.press('Space');
  await expect(scoreOne).toHaveText('1');
  await expect(scoreTwo).toHaveText('0');
  await page.keyboard.press('Enter');
  await expect(scoreOne).toHaveText('1');
  await expect(scoreTwo).toHaveText('1');
  await page.keyboard.press('Enter');
  await expect(scoreTwo).toHaveText('2');
  await page.screenshot({ path: join(directory, 'multiplayer-gameplay-desktop.png') });

  await page.getByRole('button', { name: 'Configurar multiplayer local' }).click();
  await expect(playerOne.getByRole('button', { name: 'Rodinhas', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(playerTwo.getByRole('button', { name: 'Toucinho', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: '1 jogador', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();

  await page.getByRole('button', { name: 'Multiplayer local', exact: true }).click();
  await dialog.getByRole('button', { name: 'Jogar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(scoreOne).toBeVisible();
  await expect(scoreTwo).toBeVisible();
  const divider = await page.locator('.crossy-app').evaluate(element => getComputedStyle(element, '::after').height);
  expect(Number.parseFloat(divider)).toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: join(directory, 'multiplayer-gameplay-mobile.png') });
  expect(errors).toEqual([]);
});
