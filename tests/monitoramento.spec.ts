import { test, expect } from '@playwright/test';

import { mkdirSync } from 'node:fs';

test('jogo 3D abre direto, avança uma vez por tecla e mostra créditos', async ({ page }) => {
  const errors: string[] = [];
  mkdirSync(`${process.env.TEMP}/conep-crossy-qa`, { recursive: true });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page).toHaveTitle('Crossy Road · CONEP');
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();
  await expect(page.getByAltText('Crossy Road')).toBeVisible();
  await expect(page.getByRole('button', { name: 'O controle ESP32' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Personalizar personagem' })).toBeVisible();
  const espButton = page.getByRole('button', { name: 'O controle ESP32' });
  await expect(espButton).toHaveText('');
  await expect(espButton.locator('+ button')).toHaveText('Créditos');
  await espButton.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'O controle ESP32' })).toBeVisible();
  for (const titulo of ['O que a gente queria fazer', 'Por que não deu certo', 'Como está agora', 'Como vai funcionar']) {
    await expect(page.getByRole('heading', { name: titulo, exact: true })).toBeVisible();
  }
  await expect(page.getByText('Botão do jogador 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Botão do jogador 2', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${process.env.TEMP}/conep-crossy-qa/aba-controle.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  // Fechar com Escape devolve o foco ao botão, e o jogo ignora teclas com um botão focado.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down('Space');
  await expect(page.getByLabel('Pontuação')).toHaveText('1');
  await page.keyboard.down('Space'); // browser repeat must not move again
  await page.keyboard.up('Space');
  await expect(page.getByLabel('Pontuação')).toHaveText('1');
  await page.getByRole('button', { name: 'Créditos', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Projeto CONEP · 3º ano', { exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Pontuação')).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Mover galinha para frente' }).click();
  await expect(page.getByLabel('Pontuação')).toHaveText('2');
  await page.screenshot({ path: `${process.env.TEMP}/conep-crossy-qa/game.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Créditos', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const fits = await page.getByRole('dialog').evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; });
  expect(fits).toBe(true);
  await page.screenshot({ path: `${process.env.TEMP}/conep-crossy-qa/mobile-credits.png` });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${process.env.TEMP}/conep-crossy-qa/mobile.png` });
  expect(errors).toEqual([]);
});
