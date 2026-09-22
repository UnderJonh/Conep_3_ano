import Engine from '../../../Expo-Crossy-Road-master/src/GameEngine';
import ModelLoader from '../../../Expo-Crossy-Road-master/src/ModelLoader';
import CrossyPlayer from '../../../Expo-Crossy-Road-master/src/CrossyPlayer';
import AudioManager from '../../../Expo-Crossy-Road-master/src/AudioManager';
import { AmbientLight, DirectionalLight, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { disposeAudio, pauseGameAudio } from './audio';
import { TweenMax } from 'gsap';
import { startingRow } from '../../../Expo-Crossy-Road-master/src/GameSettings';

let models;

const COMPACT_DESKTOP_MIN_WIDTH = 768;
const COMPACT_DESKTOP_REFERENCE_HEIGHT = 900;
const COMPACT_DESKTOP_MIN_CAMERA_SCALE = 0.8;
// Max visible half-width in world units. The terrain strips are 25 units wide
// (-12.5 to 12.5) and the camera + world offset can shift up to ~4 units, so
// 7.5 keeps a safe margin on every aspect ratio.
const MAX_VISIBLE_HALF_WIDTH = 6.5;

function cameraZoom(width, height, scale, viewportWidth = width) {
  const compactDesktopScale = viewportWidth >= COMPACT_DESKTOP_MIN_WIDTH
    ? Math.max(COMPACT_DESKTOP_MIN_CAMERA_SCALE, Math.min(1, height / COMPACT_DESKTOP_REFERENCE_HEIGHT))
    : 1;
  const baseZoom = Math.min(width, height) * scale * compactDesktopScale / 4;
  // Prevent ultrawide / very-wide windows from showing the world edges.
  const minZoomForWidth = (width * scale) / MAX_VISIBLE_HALF_WIDTH;
  return Math.max(baseZoom, minZoomForWidth);
}
export async function createGame(canvas, callbacks, appearance = { character: 'chicken', color: '#ffffff' }) {
  models ??= ModelLoader.loadModels();
  await models;
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('Este navegador precisa de WebGL 2 para abrir o jogo.');
  gl.endFrameEXP = () => {};
  const engine = new Engine();
  let state = 'home';
  let paused = false;
  let disposed = false;
  let pending = 0;
  engine.onUpdateScore = callbacks.onScore;
  engine.onGameInit = () => callbacks.onScore(0);
  engine.onGameReady = () => {};
  engine._isGameStateEnded = () => state !== 'playing' || paused || disposed;
  engine.onGameEnded = () => { state = 'over'; pending = 0; callbacks.onState(state); };
  engine.setupGame(appearance.character);
  engine._hero.setColor(appearance.color);
  const updateScale = engine.camera.updateScale;
  engine.camera.updateScale = dimensions => {
    updateScale(dimensions);
    engine.camera.zoom = cameraZoom(dimensions.width, dimensions.height, dimensions.scale);
    engine.camera.updateProjectionMatrix();
  };
  engine.init();
  await engine._onGLContextCreate(gl);
  engine.updateScale();
  const forward = () => {
    if (paused || disposed || state === 'over') return;
    if (state === 'home') {
      state = 'playing'; engine._hero.stopIdle(); callbacks.onState(state);
    }
    pending = Math.min(pending + 1, 10);
  };
  const tick = engine.tick;
  engine.tick = (time) => {
    if (pending && !engine._hero.moving && !engine.isGameEnded()) {
      pending--; engine.moveWithDirection('SWIPE_UP');
    }
    tick(time);
  };
  return {
    forward,
    restart() {
      pending = 0;
      pauseGameAudio(true); pauseGameAudio(paused);
      engine._hero.stopAnimations(); engine._hero.stopIdle();
      engine._hero.setCrowned(false);
      canvas.dataset.crowned = 'false';
      state = 'home'; engine.init(); callbacks.onState(state);
    },
    pause(value) {
      if (paused === value || disposed) return;
      paused = value; pending = 0;
      pauseGameAudio(paused);
      if (paused) engine.pause(); else engine.unpause();
    },
    setAppearance(value) {
      if (disposed) return;
      engine._hero.setCharacter(value.character);
      engine._hero.setColor(value.color);
      engine.renderer.render(engine.scene, engine.camera);
    },
    setCrowned(value) {
      if (disposed) return;
      engine._hero.setCrowned(value);
      canvas.dataset.crowned = String(value);
      engine.renderer.render(engine.scene, engine.camera);
    },
    resize: engine.updateScale,
    dispose() {
      disposed = true; engine.pause(); engine._hero.stopIdle(); engine._hero.stopAnimations();
      delete canvas.dataset.crowned;
      engine.scene.traverse(node => {
        TweenMax.killTweensOf(node.position); TweenMax.killTweensOf(node.rotation); TweenMax.killTweensOf(node.scale);
      });
      engine.renderer.dispose();
      engine._hero.disposeMaterials();
      engine._hero.disposeCrown();
      AudioManager.dispose(); disposeAudio();
    },
  };
}

export async function createLocalMultiplayerGame(canvas, callbacks, appearances) {
  models ??= ModelLoader.loadModels();
  await models;
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) throw new Error('Este navegador precisa de WebGL 2 para abrir o jogo.');
  gl.endFrameEXP = () => {};

  const engine = new Engine();
  const states = ['home', 'home'];
  const pending = [0, 0];
  const viewOffsets = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  let paused = false;
  let disposed = false;
  let raf = 0;

  engine.setupGame(appearances[0].character);
  engine._hero.setColor(appearances[0].color);
  const secondHero = new CrossyPlayer(appearances[1].character);
  secondHero.setColor(appearances[1].color);
  engine.scene.world.add(secondHero);
  const players = [engine._hero, secondHero];

  const secondDriver = new Engine();
  secondDriver.scene = engine.scene;
  secondDriver.gameMap = engine.gameMap;
  secondDriver._hero = secondHero;
  secondDriver.camera = engine.camera;
  secondDriver.onUpdateScore = value => callbacks.onScore(2, value);
  secondDriver._isGameStateEnded = () => states[1] !== 'playing' || paused || disposed;
  const drivers = [engine, secondDriver];

  engine.onUpdateScore = value => callbacks.onScore(1, value);
  engine.onGameInit = () => {
    callbacks.onScore(1, 0);
    callbacks.onScore(2, 0);
  };
  engine.onGameReady = () => {};
  engine._isGameStateEnded = () => states[0] !== 'playing' || paused || disposed;
  engine._isPlayerStateEnded = player => {
    const index = players.indexOf(player);
    return index < 0 || states[index] !== 'playing' || paused || disposed;
  };
  engine.onPlayerEnded = player => {
    const index = players.indexOf(player);
    if (index < 0) return;
    states[index] = 'over';
    pending[index] = 0;
    callbacks.onState(index + 1, 'over');
  };

  const ensureRowsAhead = engine.gameMap.ensureRowsAhead.bind(engine.gameMap);
  engine.gameMap.ensureRowsAhead = position => {
    const activePlayers = players.filter((_, index) => states[index] !== 'over');
    const positions = (activePlayers.length ? activePlayers : players).map(player => player.position.z);
    ensureRowsAhead(Math.max(position, ...positions), Math.min(...positions));
  };

  engine.init();
  secondHero.reset();
  secondHero.idle();
  await engine._onGLContextCreate(gl);
  engine.pause();

  const cameras = [engine.camera, engine.camera.clone()];
  function resize() {
    if (disposed) return;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    engine.renderer.setSize(Math.round(width * scale), Math.round(height * scale), false);
    const sideBySide = width >= 700;
    const viewWidth = sideBySide ? width / 2 : width;
    const viewHeight = sideBySide ? height : height / 2;
    for (const camera of cameras) {
      camera.left = -(viewWidth * scale);
      camera.right = viewWidth * scale;
      camera.top = viewHeight * scale;
      camera.bottom = -(viewHeight * scale);
      camera.zoom = cameraZoom(viewWidth, viewHeight, scale, width);
      camera.updateProjectionMatrix();
    }
  }

  function renderViews() {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const sideBySide = canvas.getBoundingClientRect().width >= 700;
    engine.renderer.setScissorTest(true);
    players.forEach((player, index) => {
      const offset = viewOffsets[index];
      if (states[index] !== 'over') {
        offset.z = startingRow - player.position.z;
        offset.x = Math.max(-3, Math.min(2, -player.position.x));
      }
      engine.scene.world.position.x = offset.x;
      engine.scene.world.position.z = offset.z;
      const viewport = sideBySide
        ? { x: index * Math.floor(width / 2), y: 0, width: index === 0 ? Math.floor(width / 2) : Math.ceil(width / 2), height }
        : { x: 0, y: index === 0 ? Math.floor(height / 2) : 0, width, height: index === 0 ? Math.ceil(height / 2) : Math.floor(height / 2) };
      engine.renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
      engine.renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
      engine.renderer.render(engine.scene, cameras[index]);
    });
    engine.renderer.setScissorTest(false);
    engine.scene.world.position.x = 0;
    engine.scene.world.position.z = 0;
  }

  function frame() {
    if (paused || disposed) return;
    raf = requestAnimationFrame(frame);
    players.forEach((player, index) => {
      if (pending[index] && !player.moving && !drivers[index].isGameEnded()) {
        pending[index]--;
        drivers[index].moveWithDirection('SWIPE_UP');
      }
    });
    engine.gameMap.tick(Date.now(), players);
    players.forEach((player, index) => {
      if (!player.moving) {
        player.moveOnEntity();
        player.moveOnCar();
        if (player.isAlive && (player.position.x < -5 || player.position.x > 5)) {
          engine.onCollide({}, 'feathers', undefined, player);
        }
      }
      if (states[index] !== 'over') engine.gameMap.ensureRowsAhead(player.position.z);
    });
    renderViews();
    gl.endFrameEXP();
  }

  function forward(playerNumber) {
    const index = playerNumber - 1;
    if (states.every(state => state === 'over')) {
      if (playerNumber === 1 && !paused && !disposed) restart();
      return;
    }
    if (paused || disposed || states[index] === 'over') return;
    if (states[index] === 'home') {
      states[index] = 'playing';
      players[index].stopIdle();
      callbacks.onState(playerNumber, 'playing');
    }
    pending[index] = Math.min(pending[index] + 1, 10);
  }

  function restart() {
    pending.fill(0);
    players.forEach(player => { player.stopAnimations(); player.stopIdle(); });
    states.fill('home');
    viewOffsets.forEach(offset => { offset.x = 0; offset.z = 0; });
    engine.init();
    secondHero.reset();
    secondHero.idle();
    callbacks.onState(1, 'home');
    callbacks.onState(2, 'home');
    renderViews();
  }

  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  frame();
  return {
    forward,
    restart,
    pause(value) {
      if (paused === value || disposed) return;
      paused = value;
      pending.fill(0);
      pauseGameAudio(paused);
      if (paused) cancelAnimationFrame(raf);
      else frame();
    },
    setAppearance(value, playerNumber = 1) {
      if (disposed) return;
      const player = players[playerNumber - 1];
      player.setCharacter(value.character);
      player.setColor(value.color);
      renderViews();
    },
    resize,
    dispose() {
      disposed = true;
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
      players.forEach(player => { player.stopIdle(); player.stopAnimations(); player.disposeMaterials(); player.disposeCrown(); });
      engine.scene.traverse(node => {
        TweenMax.killTweensOf(node.position); TweenMax.killTweensOf(node.rotation); TweenMax.killTweensOf(node.scale);
      });
      engine.renderer.dispose();
      AudioManager.dispose();
      disposeAudio();
    },
  };
}

export async function createCharacterPreview(canvas, appearance) {
  models ??= ModelLoader.loadModels();
  await models;
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 1.8));
  const light = new DirectionalLight(0xffffff, 2);
  light.position.set(3, 5, 2); scene.add(light);
  const camera = new OrthographicCamera(-1.25, 1.25, 1.25, -1.25, .1, 20);
  camera.position.set(2, 1.7, 2.5); camera.lookAt(0, .5, 0);
  const hero = new CrossyPlayer(appearance.character);
  hero.position.set(0, 0, 0); hero.rotation.set(0, -.35, 0); hero.setColor(appearance.color);
  scene.add(hero);
  const render = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const aspect = width / height;
    camera.left = -aspect; camera.right = aspect;
    camera.top = 1; camera.bottom = -1;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(render); observer.observe(canvas); render();
  return {
    setAppearance(value) { hero.setCharacter(value.character); hero.setColor(value.color); render(); },
    setCrowned(value) { hero.setCrowned(value); render(); },
    dispose() { observer.disconnect(); hero.disposeMaterials(); hero.disposeCrown(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}
