import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { TimelineMax, TweenMax, TweenLite, Bounce, Power1 } from "gsap";
import { utils } from "expo-three";
import {
  BASE_ANIMATION_TIME,
  groundLevel,
  IDLE_DURING_GAME_PLAY,
  PLAYER_IDLE_SCALE,
  startingRow,
} from "./GameSettings";
import ModelLoader from "./ModelLoader";
// import { TimelineMax } from "@tweenjs/tween.js";

const normalizeAngle = (angle) => {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
};

const createRecordCrown = () => {
  const crown = new Group();
  crown.name = "record-crown";
  crown.position.set(0, 1.10, 0);
  crown.scale.setScalar(0.78);
  const gold = new MeshStandardMaterial({
    color: 0xffcf33,
    emissive: 0x3a2500,
    metalness: 0.38,
    roughness: 0.32,
  });
  const red = new MeshStandardMaterial({ color: 0xe63b2e, emissive: 0x350500 });
  const band = new Mesh(new CylinderGeometry(0.27, 0.29, 0.16, 8), gold);
  band.position.y = -0.04;
  crown.add(band);
  for (let index = 0; index < 5; index++) {
    const angle = (index / 5) * Math.PI * 2;
    const spike = new Mesh(new ConeGeometry(0.085, 0.30, 4), gold);
    spike.position.set(Math.cos(angle) * 0.20, 0.16, Math.sin(angle) * 0.20);
    spike.rotation.y = -angle;
    crown.add(spike);
  }
  const jewel = new Mesh(new BoxGeometry(0.09, 0.09, 0.035), red);
  jewel.position.set(0, -0.035, 0.275);
  jewel.rotation.z = Math.PI / 4;
  crown.add(jewel);
  crown.visible = false;
  return crown;
};

class PlayerScaleAnimation extends TimelineMax {
  constructor(player) {
    super();

    this.to(player.scale, BASE_ANIMATION_TIME, {
      x: 1,
      y: 1.2,
      z: 1,
    })
      .to(player.scale, BASE_ANIMATION_TIME, {
        x: 1.0,
        y: 0.8,
        z: 1,
      })
      .to(player.scale, BASE_ANIMATION_TIME, {
        x: 1,
        y: 1,
        z: 1,
        ease: Bounce.easeOut,
      });
  }
}

class PlayerIdleAnimation extends TimelineMax {
  constructor(player) {
    super({ repeat: -1 });

    this.to(player.scale, 0.3, {
      y: PLAYER_IDLE_SCALE,
      ease: Power1.easeIn,
    }).to(player.scale, 0.3, { y: 1, ease: Power1.easeOut });
  }
}

class PlayerPositionAnimation extends TimelineMax {
  constructor(player, { targetPosition, initialPosition, onComplete }) {
    super({
      onComplete: () => onComplete(),
    });

    const delta = {
      x: targetPosition.x - initialPosition.x,
      z: targetPosition.z - initialPosition.z,
    };

    const inAirPosition = {
      x: initialPosition.x + delta.x * 0.75,
      y: targetPosition.y + 0.5,
      z: initialPosition.z + delta.z * 0.75,
    };

    this.to(player.position, BASE_ANIMATION_TIME, { ...inAirPosition }).to(
      player.position,
      BASE_ANIMATION_TIME,
      {
        x: targetPosition.x,
        y: targetPosition.y,
        z: targetPosition.z,
      }
    );
  }
}

export default class CrossyPlayer extends Group {
  animations = [];

  _character;
  crown;

  setCharacter(character) {
    if (this._character === character) return;
    this._character = character;
    const node = ModelLoader._hero.getNode(character);
    if (!node)
      throw new Error(`Failed to get node for character: ${character}`);
    if (this.node) {
      this.disposeMaterials();
      this.remove(this.node);
    }

    node.traverse((child) => {
      if (!child.isMesh) return;
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
    });

    utils.scaleLongestSideToSize(node, 1);
    utils.alignMesh(node, { x: 0.5, z: 0.5, y: 1.0 });
    this.node = node;
    this.add(node);
  }

  setColor(color) {
    this.node.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.color.set(color));
    });
  }

  setCrowned(value) {
    if (!this.crown && !value) return;
    if (!this.crown) {
      this.crown = createRecordCrown();
      this.add(this.crown);
    }
    this.crown.visible = value;
  }

  disposeCrown() {
    if (!this.crown) return;
    this.crown.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
    this.remove(this.crown);
    this.crown = null;
  }

  disposeMaterials() {
    const materials = new Set();
    this.node?.traverse((child) => {
      if (!child.isMesh) return;
      (Array.isArray(child.material) ? child.material : [child.material])
        .forEach((material) => materials.add(material));
    });
    materials.forEach((material) => material.dispose());
  }

  constructor(character) {
    super();
    this.setCharacter(character);
    this.reset();
  }

  moveOnEntity() {
    if (!this.ridingOn) {
      return;
    }

    // let target = this._hero.ridingOn.mesh.position.x + this._hero.ridingOnOffset;
    this.position.x += this.ridingOn.speed;
    this.initialPosition.x = this.position.x;
  }

  moveOnCar() {
    if (!this.hitBy) {
      return;
    }

    let target = this.hitBy.mesh.position.x;
    this.position.x += this.hitBy.speed;
    if (this.initialPosition) this.initialPosition.x = target;
  }

  stopAnimations() {
    this.animations.map((val) => {
      if (val.pause) {
        val.pause();
      }
      val = null;
    });
    this.animations = [];
  }

  reset() {
    this.position.set(0, groundLevel, startingRow);
    this.scale.set(1, 1, 1);
    this.rotation.set(0, Math.PI, 0);

    this.initialPosition = null;
    this.targetPosition = null;
    this.moving = false;
    this.hitBy = null;
    this.ridingOn = null;
    this.ridingOnOffset = null;
    this.isAlive = true;
  }

  skipPendingMovement() {
    if (!this.moving) {
      return;
    }
    this.position.set(
      this.targetPosition.x,
      this.targetPosition.y,
      this.targetPosition.z
    );
    if (this.targetRotation) {
      this.rotation.y = normalizeAngle(this.targetRotation);
    }
    // return
  }

  finishedMovingAnimation() {
    this.moving = false;
    if (IDLE_DURING_GAME_PLAY) {
      if (this.idleAnimation) {
        this.idleAnimation.play();
      } else {
        this.idle();
      }
    }
    this.lastPosition = this.position;

    // this._hero.position.set(Math.round(this._hero.position.x), this._hero.position.y, Math.round(this._hero.position.z))
  }

  stopIdle() {
    if (this.idleAnimation && this.idleAnimation.pause) {
      this.idleAnimation.pause();
    }
    this.idleAnimation = null;
    this.scale.set(1, 1, 1);
  }

  idle() {
    if (this.idleAnimation) {
      return;
    }
    this.stopIdle();

    this.idleAnimation = new PlayerIdleAnimation(this);
  }

  createPositionAnimation({ onComplete }) {
    return new PlayerPositionAnimation(this, {
      onComplete: () => {
        this.finishedMovingAnimation();
        onComplete();
      },
      targetPosition: this.targetPosition,
      initialPosition: this.initialPosition,
    });
  }

  commitMovementAnimations({ onComplete }) {
    const positionChangeAnimation = this.createPositionAnimation({
      onComplete,
    });

    this.animations = [
      positionChangeAnimation,
      new PlayerScaleAnimation(this),
      TweenMax.to(this.rotation, BASE_ANIMATION_TIME, {
        y: this.targetRotation,
        ease: Power1.easeInOut,
        // Reset angle when finished
        onComplete: () => (this.rotation.y = normalizeAngle(this.rotation.y)),
      }),
    ];

    this.initialPosition = this.targetPosition;
  }

  runPosieAnimation() {
    this.stopIdle();

    TweenMax.to(this.scale, 0.2, {
      x: 1.2,
      y: 0.75,
      z: 1,
      // ease: Bounce.easeOut,
    });
  }

  hitBy = null;
  moving = false;

  collideWithCar(road, car) {
    if (
      this.moving &&
      Math.abs(this.position.z - Math.round(this.position.z)) > 0.1
    ) {
      this.getHitByCar(road, car);
    } else {
      this.getRunOverByCar(road, car);
    }
  }

  getRunOverByCar(road, car) {
    this.position.y = road.top - 0.05;

    TweenLite.to(this.scale, 0.2, {
      y: 0.05,
      x: 1.7,
      z: 1.7,
    });
    TweenMax.to(this.rotation, 0.2, {
      y: Math.random() * Math.PI - Math.PI / 2,
    });
  }

  getHitByCar(road, car) {
    this.hitBy = car;

    const forward = this.position.z - Math.round(this.position.z) > 0;
    this.position.z = road.position.z + (forward ? 0.52 : -0.52);

    TweenLite.to(this.scale, 0.15, {
      y: 1.5,
      z: 0.2,
    });
    TweenMax.to(this.rotation, 0.15, {
      z: Math.random() * Math.PI - Math.PI / 2,
    });
  }
}
