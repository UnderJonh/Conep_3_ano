import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';

test('corrida oficial real → vencedor → ranking público → treino → reconexão', async ({ page, context, browser }) => {
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Configure conta dedicada: E2E_EMAIL e E2E_PASSWORD.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const screenshots = process.env.E2E_SCREENSHOTS ?? join(tmpdir(), 'conep-game-qa');
  mkdirSync(screenshots, { recursive: true });
  await page.goto('/');
  await expect(page).toHaveTitle('Voltage Run · Arena CONEP');
  await page.getByLabel('E-mail', { exact: true }).fill(process.env.E2E_EMAIL!);
  await page.getByLabel('Senha', { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Escolha sua arena.' })).toBeVisible();
  await page.getByLabel('Nome da arena').fill('Arena CONEP · validação');
  await page.getByRole('button', { name: 'Criar arena', exact: true }).click();
  await expect(page).toHaveURL(/\/testes\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;
  const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
  const login = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  expect(login.error).toBeNull();
  const anonymous = await browser.newContext();
  try {
    await expect(page.getByText('Conectado ao tempo real', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('-- V');
    await page.locator('.device-setup summary').click();
    const tokens: Record<number, string> = {};
    for (const player of [1, 2]) {
      await page.getByRole('button', { name: `Gerar token Player ${player}` }).click();
      const input = page.locator('.device-grid > div').nth(player - 1).getByLabel('DEVICE_TOKEN');
      await expect(input).toBeVisible(); tokens[player] = await input.inputValue();
    }
    await page.locator('.device-setup summary').click();
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.screenshot({ path: join(screenshots, 'ready.png'), fullPage: true });
    await page.getByRole('button', { name: /Iniciar corrida/ }).click();
    await expect(page.locator('.race-stage')).toHaveClass(/phase-running/);
    const early = await db.rpc('concluir_corrida', { p_teste_id: id });
    expect(early.error?.code).toBe('PT409');
    const fakeKeyboard = await db.rpc('pisada_treino', { p_teste_id: id, p_player: 1, p_forca: 3.3 });
    expect(fakeKeyboard.error?.code).toBe('PT409');
    const clock = await db.rpc('hora_servidor');
    const offset = Date.parse(clock.data!) - Date.now();
    async function send(player: number, values: object, token = tokens[player]) {
      return fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/receber-tensao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
        body: JSON.stringify({ teste_id: id, player, ...values }),
      });
    }
    async function pulse(player: number, force: number) {
      const ms = Math.floor(Date.now() + offset);
      const amostras = [{ tensao: 0, instante_ms: ms - 100 }, { tensao: force, instante_ms: ms - 80 }, { tensao: 0, instante_ms: ms }];
      const response = await send(player, { amostras });
      expect(response.status, await response.text()).toBe(200);
      return amostras;
    }
    const first = await Promise.all([pulse(1, 3.3), pulse(2, 1.5)]);
    await expect(page.getByLabel('Pisadas Player 1', { exact: true })).toHaveText('1');
    await expect(page.getByLabel('Pontos Player 1', { exact: true })).toHaveText('40');
    // Pode expirar durante a espera do WebSocket; ambos os caminhos mantêm o placar.
    expect([200, 400]).toContain((await send(1, { amostras: first[0] })).status);
    await expect(page.getByLabel('Pisadas Player 1', { exact: true })).toHaveText('1');
    expect((await send(2, { tensao: 3.3 }, tokens[1])).status).toBe(401);
    expect((await send(1, { tensao: -1 })).status).toBe(400);
    for (let n = 0; n < 8; n++) {
      await new Promise(resolve => setTimeout(resolve, 320));
      await Promise.all(n % 2 ? [pulse(1, 3.3)] : [pulse(1, 3.3), pulse(2, 1.5)]);
    }
    await expect(page.getByLabel('Pisadas Player 1', { exact: true })).toHaveText('9');
    await expect(page.getByLabel('Pisadas Player 2', { exact: true })).toHaveText('5');
    await Promise.all([send(1, { tensao: 2.81 }), send(2, { tensao: 1.94 })]);
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('2,81 V');
    await expect(page.getByLabel('Tensão Player 2', { exact: true })).toHaveText('1,94 V');
    await page.screenshot({ path: join(screenshots, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: join(screenshots, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1536, height: 1024 });
    // Deixa o servidor encerrar a corrida sozinho, sem esta arena aberta.
    const publicPage = await anonymous.newPage();
    await publicPage.goto('http://127.0.0.1:5173/ranking');
    await expect(publicPage.getByRole('heading', { name: /Os nomes que foram mais longe/ })).toBeVisible();
    await page.getByRole('link', { name: 'Corridas', exact: true }).click();
    const started = await db.from('testes').select('corrida_fim').eq('id', id).single();
    const remaining = Math.max(0, Date.parse(started.data!.corrida_fim) - (Date.now() + offset) + 8000);
    await new Promise(resolve => setTimeout(resolve, remaining));
    const finished = await db.from('testes').select('*').eq('id', id).single();
    expect(finished.error).toBeNull(); expect(finished.data!.status).toBe('finalizado');
    const finals = await Promise.all([1, 2].map(() => db.rpc('concluir_corrida', { p_teste_id: id })));
    expect(finals.every(result => !result.error)).toBe(true);
    const history = await db.from('rodadas').select('*').eq('teste_id', id);
    expect(history.data).toHaveLength(1);
    expect(history.data![0].resultado.vencedor).toBe(1);
    const winnerScore = history.data![0].infos_player_1.pontos;
    await page.goto(`/testes/${id}`);
    await expect(page.getByRole('heading', { name: 'PLAYER 1 VENCEU!' })).toBeVisible();
    await page.getByLabel('Nome do vencedor').fill('QA Voltage Run');
    await page.getByRole('button', { name: 'Entrar no ranking', exact: true }).click();
    await expect(page.getByText('QA Voltage Run, sua vitória está no ranking mundial!')).toBeVisible();
    await expect(publicPage.locator('tbody tr').filter({ hasText: 'QA Voltage Run' })).toHaveCount(1);
    const rank = await db.from('ranking_mundial').select('*').eq('rodada_id', history.data![0].id).single();
    expect(rank.data!.pontos).toBe(winnerScore);
    await page.screenshot({ path: join(screenshots, 'winner.png'), fullPage: true });
    await publicPage.screenshot({ path: join(screenshots, 'ranking.png'), fullPage: true });
    await page.getByRole('button', { name: /Treino no teclado/ }).click();
    await page.getByRole('button', { name: /Iniciar corrida/ }).click();
    await expect(page.locator('.race-stage')).toHaveClass(/phase-running/);
    await page.keyboard.press('s');
    await expect(page.getByLabel('Pisadas Player 1', { exact: true })).toHaveText('1');
    await page.getByRole('button', { name: 'K · Pisada leve', exact: true }).click();
    await expect(page.getByLabel('Pisadas Player 2', { exact: true })).toHaveText('1');
    expect((await send(1, { tensao: 3.3 })).status).toBe(409);
    await page.getByRole('button', { name: 'Interromper corrida', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar interrupção', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Corrida interrompida' })).toBeVisible();
    await expect(page.getByLabel('Nome do vencedor')).toHaveCount(0);
    await context.setOffline(true);
    expect((await send(1, { tensao: 1.23 })).status).toBe(200);
    await context.setOffline(false);
    await expect(page.getByLabel('Tensão Player 1', { exact: true })).toHaveText('1,23 V', { timeout: 45_000 });
    await page.reload();
    await expect(page.getByText('Conectado ao tempo real', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Corrida interrompida' })).toBeVisible();
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  } finally {
    await context.setOffline(false);
    await db.auth.signOut();
    await anonymous.close();
  }
});
