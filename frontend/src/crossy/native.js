// Small browser adapters for the imported Expo game engine.
export const Dimensions = {
  get: () => ({ width: window.innerWidth, height: window.innerHeight, scale: Math.min(window.devicePixelRatio || 1, 2) }),
};
export const Vibration = { vibrate() {}, cancel() {} };
export const Image = { getSize(uri) { return new Promise((resolve, reject) => { const image = new window.Image(); image.onload = () => resolve({ width: image.width, height: image.height }); image.onerror = reject; image.src = uri; }); } };
