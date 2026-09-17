import { Box3, Vector3, WebGLRenderer } from 'three';
export class Renderer extends WebGLRenderer {
  setSize(width, height) { super.setSize(width, height, false); }
  constructor({ gl, width, height, clearColor, ...options }) {
    super({ ...options, canvas: gl.canvas, context: gl });
    this.setSize(width, height);
    this.setClearColor(clearColor);
  }
}
export const utils = {
  scaleLongestSideToSize(node, size) {
    const dimensions = new Box3().setFromObject(node).getSize(new Vector3());
    node.scale.multiplyScalar(size / Math.max(dimensions.x, dimensions.y, dimensions.z));
  },
  alignMesh(node, alignment) {
    const box = new Box3().setFromObject(node);
    for (const axis of ['x', 'y', 'z']) {
      if (axis in alignment) node.position[axis] -= box.min[axis] + (box.max[axis] - box.min[axis]) * (1 - alignment[axis]);
    }
  },
};
