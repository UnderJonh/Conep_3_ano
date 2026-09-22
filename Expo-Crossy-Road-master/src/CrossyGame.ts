import { Renderer } from "expo-three";
import { TweenMax } from "gsap";
import { Vibration } from "react-native";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  OrthographicCamera,
  Scene,
} from "three";

import * as THREE from "three";

import AudioManager from "./AudioManager";
import { MAP_OFFSET, maxRows, rowsAhead, rowsBehind, startingRow } from "./GameSettings";
import Feathers from "./Particles/Feathers";
import Water from "./Particles/Water";
import Rows from "./Row";
import { Fill } from "./Row/Grass";

// TODO Add to state - disable/enable when battery is low
const useParticles = true;
const useShadows = true;

export class CrossyScene extends Scene {
  world: CrossyWorld;
  worldWithCamera: Group;
  constructor({ gl }) {
    super();
    this.__gl = gl;

    this.worldWithCamera = new Group();
    this.world = new CrossyWorld();
    this.worldWithCamera.add(this.world);
    this.add(this.worldWithCamera);

    const light = new DirectionalLight(0xffffff, 1.0);
    light.position.set(20, 30, 0.05);
    light.castShadow = useShadows;
    light.shadow.mapSize.width = 1024 * 2;
    light.shadow.mapSize.height = 1024 * 2;

    const d = 15;
    const v = 6;
    light.shadow.camera.left = -d;
    light.shadow.camera.right = 9;
    light.shadow.camera.top = v;
    light.shadow.camera.bottom = -v;
    light.shadow.camera.far = 100;
    light.shadow.bias = 0.0001;

    this.add(light);

    this.light = light;

    // let helper = new CameraHelper(light.shadow.camera);
    // this.add(helper);
  }

  setShadowsEnabled(enabled) {
    this.light.castShadow = enabled;
  }

  resetParticles = (position) => {
    if (!useParticles) return;
    this.featherParticles.mesh.position.copy(position);
    this.waterParticles.mesh.position.copy(position);
    this.featherParticles.mesh.position.y = 0;
    this.waterParticles.mesh.position.y = 0;
  };

  useParticle = (model, type, direction = 0) => {
    if (!useParticles) return;
    requestAnimationFrame(async () => {
      if (type === "water") {
        this.waterParticles.mesh.position.copy(model.position);
        this.waterParticles.run(type);
        await AudioManager.playAsync(AudioManager.sounds.water);
      } else if (type === "feathers") {
        this.featherParticles.mesh.position.copy(model.position);
        this.featherParticles.run(type, direction);
      }
    });
  };

  waterParticles: Water | undefined;
  featherParticles: Feathers | undefined;

  createParticles = () => {
    if (!useParticles) return;

    this.waterParticles = new Water();
    this.world.add(this.waterParticles.mesh);

    this.featherParticles = new Feathers();
    this.world.add(this.featherParticles.mesh);
  };

  rumble = () => {
    Vibration.vibrate();

    TweenMax.to(this.position, 0.2, {
      x: 0,
      y: 0,
      z: 1,
    });
    TweenMax.to(this.position, 0.2, {
      x: 0,
      y: 0,
      z: 0,
      delay: 0.2,
    });
  };
}

export class CrossyCamera extends OrthographicCamera {
  constructor() {
    super(-1, 1, 1, -1, -30, 30);
    this.position.set(-1, 2.8, -2.9);
    this.lookAt(0, 0, 0);
  }

  updateScale = ({ width, height, scale }) => {
    this.left = -(width * scale);
    this.right = width * scale;
    this.top = height * scale;
    this.bottom = -(height * scale);
    this.zoom = 400;
    this.updateProjectionMatrix();
  };
}

export class CrossyWorld extends Group {
  constructor() {
    super();

    this.add(new AmbientLight(0xffffff, 1.8));
  }

  createParticles = () => {
    this.waterParticles = new Water();
    this.add(this.waterParticles.mesh);

    this.featherParticles = new Feathers();
    this.add(this.featherParticles.mesh);
  };
}

export class CrossyRenderer extends Renderer {
  constructor(props) {
    super(props);
    this.__gl = props.gl;
    this.setShadowsEnabled(useShadows);

    // Set proper color space for vibrant colors
    this.outputColorSpace = THREE.SRGBColorSpace;
  }

  setShadowsEnabled(enabled) {
    this.shadowMap.enabled = enabled;
  }
}

export class GameMap {
  floorMap = {};

  reset() {
    this.floorMap = {};
  }

  getRow(index) {
    return this.floorMap[`${index}`];
  }
  setRow(index, value) {
    this.floorMap[`${index}`] = value;
  }

  // Detect collisions with trees/cars
  treeCollision = (position) => {
    const targetZ = `${position.z | 0}`;
    if (targetZ in this.floorMap) {
      const { type, entity } = this.floorMap[targetZ];
      if (type === "grass") {
        const key = `${position.x | 0}`;
        if (key in entity.obstacleMap) {
          return true;
        }
      }
    }

    return false;
  };
}

export class EntityContainer {
  items = [];
  count = 0;
}

export class CrossyGameMap extends GameMap {
  grasses = new EntityContainer();
  water = new EntityContainer();
  roads = new EntityContainer();
  railRoads = new EntityContainer();
  rowCount = 0;
  firstRetainedRow = 0;

  constructor({ heroWidth, onCollide, scene }) {
    super();

    this.heroWidth = heroWidth;
    this.onCollide = onCollide;
    this.scene = scene;

    // Assign mesh to corresponding array
    // and add mesh to scene
    for (let i = 0; i < maxRows; i++) {
      this.grasses.items[i] = new Rows.Grass(this.heroWidth);
      this.water.items[i] = new Rows.Water(this.heroWidth, onCollide);
      this.roads.items[i] = new Rows.Road(this.heroWidth, onCollide);
      this.railRoads.items[i] = new Rows.RailRoad(this.heroWidth, onCollide);
      scene.world.add(this.grasses.items[i]);
      scene.world.add(this.water.items[i]);
      scene.world.add(this.roads.items[i]);
      scene.world.add(this.railRoads.items[i]);
    }
  }

  tick(dt, hero) {
    const players = Array.isArray(hero) ? hero : [hero];
    for (const railRoad of this.railRoads.items) {
      railRoad.update(dt, players);
    }
    for (const road of this.roads.items) {
      road.update(dt, players);
    }
    for (const water of this.water.items) {
      water.update(dt, players);
    }
  }

  // Helper to get clear positions (positions without obstacles) from a grass row
  getClearPositionsFromGrass = (grassEntity): number[] => {
    const blockedPositions = grassEntity.getBlockedPositions();
    const blockedSet = new Set(blockedPositions);
    // Playable x range is typically -4 to 4 (center area)
    const clearPositions: number[] = [];
    for (let x = -4; x <= 4; x++) {
      if (!blockedSet.has(x)) {
        clearPositions.push(x);
      }
    }
    return clearPositions;
  };

  // Scene generators
  acquireRow = (container, create) => {
    const index = container.count % container.items.length;
    let row = container.items[index];
    const previousIndex = row.position.z;
    // Never recycle terrain that is still around the player, even during a long
    // sequence of the same row type. Grow the pool only when all slots are live.
    if (previousIndex >= this.firstRetainedRow && this.getRow(previousIndex)?.entity === row) {
      const reusable = container.items.findIndex(item => item.position.z < this.firstRetainedRow || this.getRow(item.position.z)?.entity !== item);
      if (reusable >= 0) { container.count = reusable; row = container.items[reusable]; }
      else {
        row = create(); container.count = container.items.length;
        container.items.push(row); this.scene.world.add(row);
      }
    }
    if (this.getRow(row.position.z)?.entity === row) delete this.floorMap[`${row.position.z}`];
    return row;
  };

  ensureRowsAhead = (position, retainFrom = position) => {
    this.firstRetainedRow = Math.max(0, Math.floor(retainFrom) - rowsBehind);
    for (const index of Object.keys(this.floorMap)) {
      if (Number(index) >= this.firstRetainedRow) continue;
      this.floorMap[index].entity.active = false;
      delete this.floorMap[index];
    }
    while (this.rowCount <= Math.ceil(position) + rowsAhead) this.newRow();
  };

  newRow = (rowKind) => {
    if (this.grasses.count === this.grasses.items.length) {
      this.grasses.count = 0;
    }
    if (this.roads.count === this.roads.items.length) {
      this.roads.count = 0;
    }
    if (this.water.count === this.water.items.length) {
      this.water.count = 0;
    }
    if (this.railRoads.count === this.railRoads.items.length) {
      this.railRoads.count = 0;
    }
    if (this.rowCount < 10) {
      rowKind = "grass";
    }

    const ROW_TYPES = ["grass", "roadtype", "water"];
    if (rowKind == null) {
      rowKind = ROW_TYPES[Math.floor(Math.random() * ROW_TYPES.length)];
    }

    // Get the previous row info for coordination
    const previousRow = this.getRow(this.rowCount - 1);

    switch (rowKind) {
      case "grass":
        this.acquireRow(this.grasses, () => new Rows.Grass(this.heroWidth));
        this.grasses.items[this.grasses.count].position.z = this.rowCount;

        // If previous row is water, ensure lily pad positions are kept clear
        let requiredClearPositions: number[] = [];
        if (previousRow && previousRow.type === "water") {
          requiredClearPositions = previousRow.entity.getLilyPadPositions();
        }

        this.grasses.items[this.grasses.count].generate(
          this.mapRowToObstacle(this.rowCount),
          requiredClearPositions
        );
        this.setRow(this.rowCount, {
          type: "grass",
          entity: this.grasses.items[this.grasses.count],
        });
        this.grasses.count++;
        break;
      case "roadtype":
        if (((Math.random() * 4) | 0) === 0) {
          this.acquireRow(this.railRoads, () => new Rows.RailRoad(this.heroWidth, this.onCollide));
          this.railRoads.items[this.railRoads.count].position.z = this.rowCount;
          this.railRoads.items[this.railRoads.count].active = true;
          this.setRow(this.rowCount, {
            type: "railRoad",
            entity: this.railRoads.items[this.railRoads.count],
          });
          this.railRoads.count++;
        } else {
          this.acquireRow(this.roads, () => new Rows.Road(this.heroWidth, this.onCollide));
          this.roads.items[this.roads.count].position.z = this.rowCount;

          const previousRowType = (this.getRow(this.rowCount - 1) || {}).type;
          this.roads.items[this.roads.count].isFirstLane(
            previousRowType !== "road"
          );
          this.roads.items[this.roads.count].active = true;
          this.setRow(this.rowCount, {
            type: "road",
            entity: this.roads.items[this.roads.count],
          });
          this.roads.count++;
        }
        break;
      case "water":
        this.acquireRow(this.water, () => new Rows.Water(this.heroWidth, this.onCollide));
        this.water.items[this.water.count].position.z = this.rowCount;
        this.water.items[this.water.count].active = true;

        // If previous row is grass, get clear positions so lily pads are accessible
        let clearPositions: number[] = [];
        if (previousRow && previousRow.type === "grass") {
          clearPositions = this.getClearPositionsFromGrass(previousRow.entity);
        }

        this.water.items[this.water.count].generate(clearPositions);
        this.setRow(this.rowCount, {
          type: "water",
          entity: this.water.items[this.water.count],
        });
        this.water.count++;
        break;
    }

    this.rowCount++;
  };

  reset() {
    this.grasses.count = 0;
    this.water.count = 0;
    this.roads.count = 0;
    this.railRoads.count = 0;

    this.rowCount = 0;
    this.firstRetainedRow = 0;
    super.reset();
  }

  // Setup initial scene
  init = () => {
    for (const container of [this.grasses, this.water, this.roads, this.railRoads]) {
      for (const row of container.items) { row.position.z = MAP_OFFSET; row.active = false; }
    }

    this.grasses.items[this.grasses.count].position.z = this.rowCount;
    this.grasses.items[this.grasses.count].generate(
      this.mapRowToObstacle(this.rowCount)
    );
    this.grasses.count++;
    this.rowCount++;

    this.ensureRowsAhead(startingRow);
  };

  mapRowToObstacle = (row) => {
    if (this.rowCount < 5) {
      return Fill.solid;
    } else if (this.rowCount < 10) {
      return Fill.empty;
    }
    return Fill.random;
  };
}
