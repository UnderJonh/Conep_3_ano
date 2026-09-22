import { expect, test } from '@playwright/test';

test('P1 e P2 do controle USB movem os jogadores correspondentes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    let input: ReadableStreamDefaultController<Uint8Array>;
    const port = {
      readable: new ReadableStream<Uint8Array>({ start(controller) { input = controller; } }),
      async open() {},
      async close() { try { input.close(); } catch { /* Já fechada. */ } },
    };
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { async requestPort() { return port; } },
    });
    (window as Window & { emitSerial: (text: string) => void }).emitSerial = text => {
      input.enqueue(new TextEncoder().encode(text));
    };
  });

  await page.goto('/');
  await expect(page.getByAltText('Crossy Road')).toBeVisible();
  await page.getByRole('button', { name: 'Configurar multiplayer local' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Jogar', exact: true }).click();
  const one = page.getByLabel('Pontuação do jogador 1');
  const two = page.getByLabel('Pontuação do jogador 2');
  await expect(one).toHaveText('0');
  await expect(two).toHaveText('0');

  await page.getByRole('button', { name: 'O controle ESP32' }).click();
  await page.getByRole('button', { name: 'Conectar controle' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Controle USB conectado.' })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar' }).click();

  await page.evaluate(() => (window as Window & { emitSerial: (text: string) => void }).emitSerial('ID CROSSY-CONTROLE v1\nP'));
  await expect(one).toHaveText('0');
  await page.evaluate(() => (window as Window & { emitSerial: (text: string) => void }).emitSerial('1\nP2\n'));
  await expect(one).toHaveText('1');
  await expect(two).toHaveText('1');
  await page.evaluate(() => (window as Window & { emitSerial: (text: string) => void }).emitSerial('P2\n'));
  await expect(two).toHaveText('2');

  await page.getByRole('button', { name: 'O controle ESP32' }).click();
  await page.getByRole('button', { name: 'Desconectar controle' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Controle USB desconectado.' })).toBeVisible();
  expect(errors).toEqual([]);
});
