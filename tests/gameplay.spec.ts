import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = join(tmpdir(), 'conep-crossy-qa');
mkdirSync(directory, { recursive: true });

async function exposeEngine(page: Page) {
  await page.route('**/rest/v1/crossy_ranking*', route => route.fulfill({ json: [] }));
  await page.route(/\/src\/crossy\/game\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('const engine = new Engine();', 'const engine = new Engine(); window.__crossyQA = engine;');
    await route.fulfill({ response, body });
  });
}

test('mundo mantém terreno e caminho livre por 2.000 faixas, inclusive sequências longas do mesmo tipo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await exposeEngine(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();
  const result = await page.evaluate(() => {
    const engine = (window as any).__crossyQA;
    engine.pause();
    const map = engine.gameMap;
    const generate = map.newRow;
    const types = ['grass', 'water', 'roadtype'];
    // 80-row blocks force safe recycling even when one pool fills completely.
    map.newRow = (kind?: string) => generate(kind ?? types[Math.floor(map.rowCount / 80) % types.length]);
    let checkedRivers = 0;
    let largestPool = 0;
    for (let position = 8; position < 2008; position++) {
      map.ensureRowsAhead(position);
      for (let rowIndex = position; rowIndex <= position + 24; rowIndex++) {
        const row = map.getRow(rowIndex);
        if (!row || row.entity.position.z !== rowIndex) throw new Error(`Terreno ausente ou reciclado em ${rowIndex}`);
        if (row.type === 'grass' && map.treeCollision({ x: 0, z: rowIndex })) throw new Error(`Obstáculo no caminho em ${rowIndex}`);
        if (row.type === 'water') {
          const crossing = row.entity.getRidableForPosition({ x: 0, z: rowIndex });
          if (!crossing || crossing.speed !== 0) throw new Error(`Rio sem passagem fixa em ${rowIndex}`);
          checkedRivers++;
        }
      }
      if (Object.keys(map.floorMap).length > 34) throw new Error('Mapa retém faixas antigas');
      largestPool = Math.max(largestPool, ...[map.grasses, map.water, map.roads, map.railRoads].map(pool => pool.items.length));
    }
    // Simulate a delayed frame / jump ahead, then verify the whole horizon.
    map.ensureRowsAhead(2200); map.ensureRowsAhead(2200);
    for (let index = 2200; index <= 2224; index++) {
      if (map.getRow(index)?.entity.position.z !== index) throw new Error(`Vácuo após atraso em ${index}`);
    }
    map.reset(); map.init();
    for (let index = 8; index <= 32; index++) {
      if (map.getRow(index)?.entity.position.z !== index) throw new Error('Reinício deixou terreno ausente');
    }
    engine.unpause();
    return { checkedRivers, largestPool };
  });
  expect(result.checkedRivers).toBeGreaterThan(1000);
  expect(result.largestPool).toBeLessThanOrEqual(34);
  await page.getByRole('button', { name: 'Mover galinha para frente' }).click();
  await expect(page.getByLabel('Pontuação', { exact: true })).toHaveText('1');
  expect(errors).toEqual([]);
});

test('câmera mantém o personagem inteiro em desktops com pouca altura', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await exposeEngine(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();

  const compactZoom = await page.evaluate(() => (window as any).__crossyQA.camera.zoom);
  expect(compactZoom).toBeLessThan(768 / 4);
  await page.keyboard.press('Space');
  await expect(page.getByLabel('Pontuação', { exact: true })).toHaveText('1');
  await page.screenshot({ path: join(directory, 'camera-compact-desktop.png') });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(() => page.evaluate(() => (window as any).__crossyQA.camera.zoom)).toBe(250);
  await page.screenshot({ path: join(directory, 'camera-standard-desktop.png') });
  expect(errors).toEqual([]);
});

test('câmera no celular deixa o personagem abaixo do centro e abre o caminho à frente', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await exposeEngine(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mover galinha para frente' })).toBeVisible();

  await page.keyboard.press('Space');
  await expect(page.getByLabel('Pontuação', { exact: true })).toHaveText('1');
  const framing = await page.evaluate(() => {
    const engine = (window as any).__crossyQA;
    engine.scene.updateMatrixWorld(true);
    engine.camera.updateMatrixWorld(true);
    const position = engine._hero.position.clone();
    engine._hero.getWorldPosition(position);
    position.project(engine.camera);
    return {
      screenY: (1 - position.y) / 2,
      zoom: engine.camera.zoom,
    };
  });

  expect(framing.zoom).toBe(97.5);
  expect(framing.screenY).toBeGreaterThan(0.66);
  expect(framing.screenY).toBeLessThan(0.73);
  await page.screenshot({ path: join(directory, 'camera-mobile.png') });
  expect(errors).toEqual([]);
});

test('sons próprios acompanham personagem e música tem loop e controle independente', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await exposeEngine(page);
  await page.addInitScript(() => {
    (window as any).qaAudio = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      (window as any).qaAudio.push({ duration: this.buffer?.duration, loop: this.loop });
      start.apply(this, args);
    };
  });
  const effects = () => page.evaluate(() => (window as any).qaAudio.filter(sound => !sound.loop));
  await page.goto('/');
  await expect(page.getByText('Pise forte para iniciar', { exact: true })).toBeVisible();
  await expect(page.getByText('Ou toque na tela / pressione espaço')).toHaveCount(0);
  expect(await page.getByAltText('Crossy Road').evaluate(image => image.getBoundingClientRect().width)).toBeGreaterThan(800);
  await page.screenshot({ path: join(directory, 'updated-home-desktop.png') });
  await page.getByRole('button', { name: 'Personalizar personagem' }).click();
  await page.getByLabel('Música de fundo').fill('0');
  const durations: number[] = [];
  for (const name of ['Galinha', 'Toucinho', 'Abacodificador', 'Rodinhas', 'Palmeiro']) {
    await page.getByRole('button', { name, exact: true }).click();
    const before = (await effects()).length;
    await page.getByRole('button', { name: 'Testar som', exact: true }).click();
    await expect.poll(async () => (await effects()).length).toBeGreaterThan(before);
    durations.push((await effects()).at(-1).duration);
  }
  expect(new Set(durations).size).toBe(5);
  // Actual game movement uses the selected profile, not only the preview button.
  await page.getByRole('button', { name: 'Toucinho', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  const beforeMove = (await effects()).length;
  await page.getByRole('button', { name: 'Mover galinha para frente' }).click();
  await expect(page.getByLabel('Pontuação', { exact: true })).toHaveText('1');
  await expect.poll(async () => (await effects()).length).toBeGreaterThan(beforeMove);
  expect((await effects()).at(-1).duration).toBeCloseTo(durations[1], 2);
  await page.getByRole('button', { name: 'Personalizar personagem' }).click();
  await page.getByLabel('Sons do jogo').fill('0');
  await page.getByLabel('Música de fundo').fill('35');
  await page.getByRole('button', { name: 'Ouvir música' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).qaAudio.filter(sound => sound.loop && sound.duration > 15).length)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Testar som', exact: true })).toBeDisabled();
  await page.screenshot({ path: join(directory, 'updated-customization-desktop.png') });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Personalizar personagem' })).toBeEnabled();
  await page.getByRole('button', { name: 'Personalizar personagem' }).click();
  await expect(page.getByLabel('Música de fundo')).toHaveValue('35');
  await expect(page.getByLabel('Sons do jogo')).toHaveValue('0');
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && element.scrollWidth <= element.clientWidth;
  })).toBe(true);
  await page.screenshot({ path: join(directory, 'updated-customization-mobile.png') });
  // Even while the form scrolls, the close control remains available.
  await page.locator('.dialog-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole('button', { name: 'Fechar', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(directory, 'updated-home-mobile.png') });
  expect(errors).toEqual([]);
});
