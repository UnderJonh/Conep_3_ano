import Engine from '../../../Expo-Crossy-Road-master/src/GameEngine';
import ModelLoader from '../../../Expo-Crossy-Road-master/src/ModelLoader';
import { TweenMax } from 'gsap';

let models;
export async function createGame(canvas, callbacks) {
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
  engine.setupGame('chicken');
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
      engine._hero.stopAnimations(); engine._hero.stopIdle();
      state = 'home'; engine.init(); callbacks.onState(state);
    },
    pause(value) {
      if (paused === value || disposed) return;
      paused = value; pending = 0;
      if (paused) engine.pause(); else engine.unpause();
    },
    resize: engine.updateScale,
    dispose() {
      disposed = true; engine.pause(); engine._hero.stopIdle(); engine._hero.stopAnimations();
      engine.scene.traverse(node => {
        TweenMax.killTweensOf(node.position); TweenMax.killTweensOf(node.rotation); TweenMax.killTweensOf(node.scale);
      });
      engine.renderer.dispose();
    },
  };
}
