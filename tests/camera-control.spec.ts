import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const rows = [
  { profile: 'desktop', horizontal: 0, vertical: 0, zoom: 1, updated_at: '2026-10-08T00:00:00Z' },
  { profile: 'mobile', horizontal: 0.16, vertical: 0.065, zoom: 1, updated_at: '2026-10-08T00:00:00Z' },
];

test('controlecam abre o editor, aplica a câmera ao vivo e salva os dois perfis', async ({ page }) => {
  const errors: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/crossy_camera_settings*', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: rows }); return; }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const profile = new URL(route.request().url()).searchParams.get('profile')?.replace('eq.', '') as 'desktop' | 'mobile';
    const row = { ...rows.find(value => value.profile === profile)!, ...body, profile };
    updates.push(row);
    await route.fulfill({ json: row });
  });
  await page.route('**/auth/v1/signup', route => {
    const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: '2026-10-08T00:00:00Z' };
    const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    return route.fulfill({ json: { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user } });
  });
  await page.route(/\/src\/crossy\/game\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = 'const engine = new Engine();';
    await route.fulfill({ response, body: source.replace(marker, `${marker} window.__crossyQA = engine;`) });
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();
  await page.keyboard.type('controlecam');
  const panel = page.getByRole('complementary', { name: 'Controle de câmera' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'PC', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const cameraCenter = () => page.evaluate(() => {
    const camera = (window as any).__crossyQA.camera;
    return { horizontal: (camera.left + camera.right) / 2, zoom: camera.zoom };
  });
  const before = await cameraCenter();
  await page.locator('#camera-desktop-horizontal').fill('10');
  await expect.poll(async () => (await cameraCenter()).horizontal).toBeLessThan(before.horizontal);
  await page.locator('#camera-desktop-zoom').fill('120');
  await expect.poll(async () => (await cameraCenter()).zoom).toBeGreaterThan(before.zoom);
  await expect.poll(() => updates.some(update => update.profile === 'desktop' && update.horizontal === 0.1 && update.zoom === 1.2)).toBe(true);

  await panel.getByRole('button', { name: 'Celular', exact: true }).click();
  await expect(page.locator('#camera-mobile-horizontal')).toHaveValue('16');
  await page.locator('#camera-mobile-horizontal').fill('20');
  await expect.poll(() => updates.some(update => update.profile === 'mobile' && update.horizontal === 0.2)).toBe(true);
  await page.screenshot({ path: join(tmpdir(), 'conep-crossy-qa', 'camera-control-desktop.png') });
  await page.getByRole('button', { name: 'Fechar controle de câmera' }).click();
  await expect(panel).not.toBeVisible();
  expect(errors).toEqual([]);
});
