import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('P1 e P2 do controle USB movem os jogadores correspondentes', async ({ page }) => {
  test.skip(true, 'O painel do controle ESP32 está oculto na interface atual.');
  const errors: string[] = [];
  const actions: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => {
    if (entry.type() === 'error') errors.push(entry.text());
    if (entry.type() === 'info' && entry.text().startsWith('[ESP32]')) actions.push(entry.text());
  });
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
  await expect(page).toHaveTitle('Crossy Road · CONEP');
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
  expect(actions).toEqual(['[ESP32] P1 → Espaço', '[ESP32] P2 → Enter', '[ESP32] P2 → Enter']);
  await page.screenshot({ path: join(tmpdir(), 'conep-usb-controller.png') });

  await page.getByRole('button', { name: 'O controle ESP32' }).click();
  await page.getByRole('button', { name: 'Desconectar controle' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Controle USB desconectado.' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('falha ao abrir a porta mostra como liberar a ESP32', async ({ page }) => {
  test.skip(true, 'O painel do controle ESP32 está oculto na interface atual.');
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        async requestPort() {
          return {
            readable: null,
            async open() { throw new DOMException("Failed to execute 'open' on 'SerialPort': Failed to open serial port.", 'NetworkError'); },
            async close() {},
          };
        },
      },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'O controle ESP32' }).click();
  await page.getByRole('button', { name: 'Conectar controle' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Feche o Monitor Serial' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Conectar controle' })).toBeEnabled();
});
