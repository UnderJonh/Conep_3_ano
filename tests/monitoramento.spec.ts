import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';

test('login → criar teste → HTTPS → Realtime → histórico → reconexão', async ({ page, context }) => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Configure uma conta de QA: E2E_EMAIL e E2E_PASSWORD.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const screenshots = process.env.E2E_SCREENSHOTS ?? join(tmpdir(), 'conep-qa');
  mkdirSync(screenshots, { recursive: true });
  await page.goto('/');
  await expect(page).toHaveTitle('CONEP · Monitor de tensão');
  await expect(page.getByRole('heading', { name: 'Acompanhe seu teste' })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Senha', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meus testes' })).toBeVisible();
  await page.getByLabel('Nome do novo teste').fill('Teste de validação');
  await page.getByRole('button', { name: 'Criar teste' }).click();
  await expect(page).toHaveURL(/\/testes\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;
  const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
  const login = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  expect(login.error).toBeNull();
  try {
    await expect(page.getByText('Conectado ao tempo real', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('-- V');
    await page.getByText('Configurar dispositivos', { exact: true }).click();
    const tokens: Record<number, string> = {};
    for (const player of [1, 2]) {
      await page.getByRole('button', { name: `Gerar token Player ${player}` }).click();
      const group = page.locator('.device-grid > div').nth(player - 1);
      await expect(group.getByLabel('DEVICE_TOKEN')).toBeVisible();
      tokens[player] = await group.getByLabel('DEVICE_TOKEN').inputValue();
    }
    await page.getByText('Configurar dispositivos', { exact: true }).click();
    await page.getByRole('button', { name: 'Iniciar teste' }).click();
    await expect(page.getByText('Rodando', { exact: true })).toBeVisible();
    async function send(player: number, tensao: number, token = tokens[player]) {
      return fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/receber-tensao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
        body: JSON.stringify({ teste_id: id, player, tensao }),
      });
    }
    const initial = await Promise.all([send(1, 2.81), send(2, 1.94)]);
    for (const response of initial) expect(response.status, await response.text()).toBe(200);
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('2,81 V');
    await expect(page.getByLabel('Tensão Player 2', { exact: true })).toHaveText('1,94 V');
    expect((await send(2, 3.3, tokens[1])).status).toBe(401);
    expect((await send(1, -1)).status).toBe(400);
    // Duas finalizações concorrentes para a mesma rodada: exatamente uma vence.
    const finals = await Promise.all([1, 2].map(() => db.rpc('finalizar_rodada', { p_teste_id: id, p_rodada_esperada: 1 })));
    expect(finals.filter((result) => !result.error)).toHaveLength(1);
    expect(finals.find((result) => result.error)?.error?.code).toBe('PT409');
    await expect(page.getByText('RODADA 2', { exact: true })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('-- V');
    await Promise.all([send(1, 3.12), send(2, 2.08)]);
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('3,12 V');
    await page.getByRole('button', { name: 'Finalizar rodada', exact: true }).click();
    await page.getByRole('button', { name: 'Salvar e avançar', exact: true }).click();
    await expect(page.getByText('RODADA 3', { exact: true })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await Promise.all([send(1, 2.81), send(2, 1.94)]);
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('2,81 V');
    await expect(page.getByLabel('Tensão Player 2', { exact: true })).toHaveText('1,94 V');
    await page.reload();
    await expect(page.getByText('Conectado ao tempo real', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Tensão Player 2', { exact: true })).toHaveText('1,94 V');
    await page.screenshot({ path: join(screenshots, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: /Pausar/ }).click();
    await expect(page.getByText('Pausado', { exact: true })).toBeVisible();
    expect((await send(1, 1.23)).status).toBe(409);
    await page.getByRole('button', { name: 'Retomar teste' }).click();
    await expect(page.getByText('Rodando', { exact: true })).toBeVisible();
    await context.setOffline(true);
    expect((await send(1, 1.23)).status).toBe(200);
    await context.setOffline(false);
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('1,23 V', { timeout: 45_000 });
    await expect(page.getByText('Conectado ao tempo real', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('1,23 V');
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Acompanhe seu teste' })).toBeVisible();
  } finally {
    await context.setOffline(false);
    await db.auth.signOut();
  }
});
