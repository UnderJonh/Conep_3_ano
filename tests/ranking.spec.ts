import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = join(tmpdir(), 'conep-crossy-qa');
mkdirSync(directory, { recursive: true });

async function setup(page: Page, scores: number[], shared = false) {
  // Deterministic game callbacks exercise record detection without random road collisions.
  await page.route(/\/src\/crossy\/game\.js(?:\?|$)/, route => route.fulfill({ contentType: 'text/javascript', body: `
    export async function createGame(canvas, callbacks) {
      let run = 0, started = false, paused = false;
      const scores = ${JSON.stringify(scores)};
      callbacks.onScore(0);
      return {
        forward() {
          if (paused) return;
          callbacks.onState('playing'); callbacks.onScore(scores[run] ?? 0);
          if (started) callbacks.onState('over'); else started = true;
        },
        restart() { run++; started = false; callbacks.onScore(0); callbacks.onState('home'); },
        pause(value) { paused = value; }, setAppearance() {}, setGodMode() {}, resize() {}, dispose() {}
      };
    }
  ` }));
  await page.route(/\/src\/lib\/supabase\.ts(?:\?|$)/, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/const url = [^\n]+/, `const url = ${JSON.stringify(shared ? 'https://ranking.test.supabase.co' : '')};`)
      .replace(/const key = [^\n]+/, 'const key = "sb_publishable_test";');
    await route.fulfill({ response, body });
  });
}

async function finishRun(page: Page) {
  await page.getByRole('button', { name: 'Mover galinha para frente' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Mover galinha para frente' }).click();
  await expect(page.getByRole('heading', { name: 'Fim de jogo' })).toBeVisible();
}

test('recorde pede nome, pausa controles, salva ranking e persiste; empate e pontuação menor não pedem nome', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await setup(page, [12, 12, 9, 17]);
  await page.goto('/');
  await expect(page).toHaveTitle('Crossy Road · CONEP');
  await page.getByRole('button', { name: 'Ranking de jogadores' }).click();
  await expect(page.getByText('Ainda não há recordes. Jogue e marque o primeiro!')).toBeVisible();
  await page.keyboard.press('Escape');
  await finishRun(page);
  const name = page.getByRole('textbox', { name: 'Nome do jogador' });
  await expect(page.getByRole('dialog', { name: 'Novo recorde!' })).toBeVisible();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('maxlength', '24');
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Pontuação', { exact: true })).toHaveText('12');
  await name.fill('   ');
  await expect(page.getByRole('button', { name: 'Salvar no ranking' })).toBeDisabled();
  await name.fill('  João  ');
  await page.screenshot({ path: join(directory, 'record-desktop.png') });
  await name.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Ranking de jogadores' })).toBeVisible();
  await expect(page.getByRole('row', { name: '1 João 12' })).toBeVisible();
  await expect(page.getByLabel('Recorde', { exact: true })).toContainText('12');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  for (const score of [12, 9]) {
    await page.getByRole('button', { name: 'Jogar novamente' }).click();
    await finishRun(page);
    await expect(page.getByLabel('Pontuação', { exact: true })).toHaveText(String(score));
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  await page.getByRole('button', { name: 'Jogar novamente' }).click();
  await finishRun(page);
  await expect(page.getByRole('dialog', { name: 'Novo recorde!' })).toBeVisible();
  await name.fill('Ana');
  await page.getByRole('button', { name: 'Salvar no ranking' }).click();
  await expect(page.getByRole('row', { name: '1 Ana 17' })).toBeVisible();
  await expect(page.getByRole('row', { name: '2 João 12' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Recorde', { exact: true })).toContainText('17');
  await page.getByRole('button', { name: 'Ranking de jogadores' }).click();
  await expect(page.getByRole('row', { name: '1 Ana 17' })).toBeVisible();
  await page.screenshot({ path: join(directory, 'ranking-desktop.png') });
  expect(errors).toEqual([]);
});

test('celular mostra recorde e ranking sem cortes; cancelar permite reiniciar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, [30, 40]);
  await page.goto('/');
  await finishRun(page);
  await page.getByRole('textbox', { name: 'Nome do jogador' }).fill('ABCDEFGHIJKLMNOPQRSTUVWX');
  const dialog = page.getByRole('dialog');
  const fits = () => dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth;
  });
  expect(await fits()).toBe(true);
  await page.screenshot({ path: join(directory, 'record-mobile.png') });
  await page.getByRole('button', { name: 'Salvar no ranking' }).click();
  await expect(page.getByRole('row', { name: '1 ABCDEFGHIJKLMNOPQRSTUVWX 30' })).toBeVisible();
  expect(await fits()).toBe(true);
  await page.screenshot({ path: join(directory, 'ranking-mobile.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Jogar novamente' }).click();
  await finishRun(page);
  await page.getByRole('button', { name: 'Agora não' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Jogar novamente' }).click();
  await expect(page.getByAltText('Crossy Road')).toBeVisible();
});

test('dados locais inválidos não impedem o jogo e armazenamento bloqueado informa a limitação', async ({ page }) => {
  await setup(page, [1]);
  await page.addInitScript(() => {
    localStorage.setItem('crossy:ranking:v1', '{broken json');
    Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); };
  });
  await page.goto('/');
  await finishRun(page);
  await page.getByRole('textbox', { name: 'Nome do jogador' }).fill('Ana');
  await page.getByRole('button', { name: 'Salvar no ranking' }).click();
  await expect(page.getByRole('row', { name: '1 Ana 1' })).toBeVisible();
  await expect(page.getByText('Armazenamento indisponível.', { exact: false })).toBeVisible();
});

test('ranking compartilhado carrega jogadores e permite repetir envio falho sem duplicar a partida', async ({ page }) => {
  await setup(page, [31], true);
  const entries = [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nome: 'Ana', pontos: 20, created_at: '2026-09-17T12:00:00Z' }];
  await page.route('https://ranking.test.supabase.co/rest/v1/crossy_ranking*', route => route.fulfill({ json: entries }));
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-09-17T12:00:00Z' };
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  await page.route('https://ranking.test.supabase.co/auth/v1/signup', route => route.fulfill({ json: {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test`, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user,
  } }));
  const submissions: { p_id: string; p_nome: string; p_pontos: number }[] = [];
  await page.route('https://ranking.test.supabase.co/rest/v1/rpc/registrar_recorde_crossy', async route => {
    const body = route.request().postDataJSON(); submissions.push(body);
    if (submissions.length === 1) { await route.fulfill({ status: 503, json: { message: 'Tente novamente', code: 'TEMP' } }); return; }
    const entry = { id: body.p_id, nome: body.p_nome, pontos: body.p_pontos, created_at: new Date().toISOString() };
    entries.unshift(entry);
    await route.fulfill({ json: entry });
  });
  await page.goto('/');
  await expect(page.getByLabel('Recorde', { exact: true })).toContainText('20');
  await finishRun(page);
  await page.getByRole('textbox', { name: 'Nome do jogador' }).fill('João');
  await page.getByRole('button', { name: 'Salvar no ranking' }).click();
  await expect(page.getByRole('alert')).toContainText('Tente novamente');
  await expect(page.getByRole('dialog', { name: 'Novo recorde!' })).toBeVisible();
  await page.getByRole('button', { name: 'Salvar no ranking' }).click();
  await expect(page.getByRole('row', { name: '1 João 31' })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  await page.reload();
  await expect(page.getByLabel('Recorde', { exact: true })).toContainText('31');
  await page.getByRole('button', { name: 'Ranking de jogadores' }).click();
  await expect(page.getByRole('row', { name: '1 João 31' })).toBeVisible();
});
