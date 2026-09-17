import Engine from '../../../Expo-Crossy-Road-master/src/GameEngine';
import ModelLoader from '../../../Expo-Crossy-Road-master/src/ModelLoader';
import CrossyPlayer from '../../../Expo-Crossy-Road-master/src/CrossyPlayer';
import AudioManager from '../../../Expo-Crossy-Road-master/src/AudioManager';
import { AmbientLight, DirectionalLight, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { disposeAudio, pauseGameAudio } from './audio';
import { TweenMax } from 'gsap';

let models;
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
    engine.camera.zoom = Math.min(dimensions.width, dimensions.height) * dimensions.scale / 4;
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
    resize: engine.updateScale,
    dispose() {
      disposed = true; engine.pause(); engine._hero.stopIdle(); engine._hero.stopAnimations();
      engine.scene.traverse(node => {
        TweenMax.killTweensOf(node.position); TweenMax.killTweensOf(node.rotation); TweenMax.killTweensOf(node.scale);
      });
      engine.renderer.dispose();
      engine._hero.disposeMaterials();
      AudioManager.dispose(); disposeAudio();
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
    dispose() { observer.disconnect(); hero.disposeMaterials(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}
