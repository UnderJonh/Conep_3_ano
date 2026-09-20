import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, mkdirSync } from 'node:fs';

test('uma placa → config.h → pisada forte via Edge e Realtime → galinha avança', async ({ page }) => {
  test.skip(!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Supabase não configurado');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  mkdirSync(`${process.env.TEMP}/conep-crossy-qa`, { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();
  await page.getByRole('button', { name: 'Configurar ESP32' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Gerar token da placa', exact: true })).toBeEnabled({ timeout: 40000 });
  await expect(dialog.getByText('Navegador conectado', { exact: false })).toBeVisible({ timeout: 40000 });
  await dialog.getByLabel('Nome do Wi-Fi (SSID)').fill('CONEP teste');
  await dialog.getByLabel('Senha do Wi-Fi').fill('teste-123');
  await dialog.getByLabel('Pino do sensor').selectOption('32');
  await dialog.getByLabel('GPIO do jogador 2').selectOption('33');
  await dialog.getByRole('button', { name: 'Gerar token da placa', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Baixar config.h' })).toBeEnabled();
  const token = await dialog.getByLabel('Token da placa', { exact: true }).inputValue();
  const id = await dialog.getByLabel('ID da conexão').inputValue().catch(async () => { await dialog.getByText('Como gravar a placa', { exact: true }).click(); return dialog.getByLabel('ID da conexão').inputValue(); });
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Baixar config.h' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('config.h');
  const config = readFileSync((await download.path())!, 'utf8');
  expect(config).toContain('const int PLAYER_ID = 1;');
  expect(config).toContain('const int PINO_ADC = 32;');
  expect(config).toContain('const int PINO_ADC_PLAYER_1 = 32;');
  expect(config).toContain('const int PINO_ADC_PLAYER_2 = 33;');
  expect(config).toContain(id); expect(config).toContain(token);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar ESP32' }).click();
  await expect(dialog.getByLabel('Nome do Wi-Fi (SSID)')).toHaveValue('CONEP teste');
  await expect(dialog.getByLabel('Token da placa', { exact: true })).toHaveValue(token);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  const endpoint = `${process.env.VITE_SUPABASE_URL}/functions/v1/receber-tensao`;
  // A single server-timestamped reading also warms the database connection.
  const warmup = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
    body: JSON.stringify({ teste_id: id, player: 1, tensao: 0 }),
  });
  expect(warmup.status, JSON.stringify(await warmup.json())).toBe(200);
  const send = async (amostras: { tensao: number; instante_ms: number }[], deviceToken = token) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken }, body: JSON.stringify({ teste_id: id, player: 1, amostras }) });
    return { status: response.status, body: await response.json() };
  };
  let now = Date.now();
  const weak = await send([{ tensao: 0, instante_ms: now - 100 }, { tensao: 1.2, instante_ms: now - 80 }, { tensao: 0, instante_ms: now - 40 }]);
  expect(weak.status, JSON.stringify(weak.body)).toBe(200);
  await expect(page.getByAltText('Crossy Road')).toBeVisible();
  now = Date.now();
  const pulse = [{ tensao: 0, instante_ms: now - 100 }, { tensao: 2.4, instante_ms: now - 80 }, { tensao: 0, instante_ms: now - 40 }];
  const strong = await send(pulse); expect(strong.status).toBe(200);
  await expect(page.getByLabel('Pontuação')).toHaveText('1');
  const repeat = await send(pulse); expect(repeat.status).toBe(200);
  await expect(page.getByLabel('Pontuação')).toHaveText('1');
  const invalid = await send([{ tensao: 0, instante_ms: Date.now() }], '0'.repeat(64)); expect(invalid.status).toBe(401);
  await page.getByRole('button', { name: 'Configurar ESP32' }).click();
  // The real firmware keeps sending telemetry while the settings are open.
  const telemetry = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
    body: JSON.stringify({ teste_id: id, player: 1, tensao: 0 }),
  });
  expect(telemetry.status).toBe(200);
  await expect(dialog.getByText('Recebendo sinal do ESP32', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${process.env.TEMP}/conep-crossy-qa/esp-connected.png` });
  const slider = dialog.getByRole('slider');
  await slider.fill('2.5'); await dialog.getByRole('button', { name: 'Salvar força mínima', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Força mínima salva');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.reload(); await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();
  await page.getByRole('button', { name: 'Configurar ESP32' }).click();
  await expect(dialog.getByText('Navegador conectado', { exact: false })).toBeVisible({ timeout: 40000 });
  await expect(dialog.getByRole('slider')).toHaveValue('2.5');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await expect(page.getByAltText('Crossy Road')).toBeVisible(); // old commands are not replayed
  now = Date.now();
  expect((await send([{ tensao: 0, instante_ms: now - 100 }, { tensao: 3, instante_ms: now - 80 }, { tensao: 0, instante_ms: now - 40 }])).status).toBe(200);
  await expect(page.getByLabel('Pontuação')).toHaveText('1');
  const session = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([key]) => key.startsWith('sb-') && key.endsWith('-auth-token'))![1]));
  console.log('QA cleanup', JSON.stringify({ connection: id, user: session.user.id }));
  const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
  await db.auth.setSession(session);
  const outsider = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const auth = await outsider.auth.signInAnonymously(); expect(auth.error).toBeNull();
  const unauthorized = await outsider.rpc('configurar_crossy', { p_teste_id: id, p_limiar: 1.5 }); expect(unauthorized.error?.code).toBe('PT403');
  console.log('QA cleanup outsider', auth.data.user!.id);
  expect(errors).toEqual([]);
});
