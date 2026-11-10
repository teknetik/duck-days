import * as THREE from 'three';

/**
 * World conventions: +x east, +z south, +y up, 1 unit = 1 metre.
 * The water rests at y = 0 and the GPU wave simulation covers the square
 * x, z in [-POND_HALF, POND_HALF]. The visible, irregular shoreline sits well
 * inside that square; the rest of it is hidden under the banks.
 */
export const POND_HALF = 16;
export const WATER_LEVEL = 0;

export interface Lobe {
  x: number;
  z: number;
  rx: number;
  rz: number;
  depth: number;
}

/** Overlapping basins that are smooth-unioned into the pond outline. */
export const LOBES: readonly Lobe[] = [
  { x: 0.5, z: 1.5, rx: 9.0, rz: 6.5, depth: 1.5 }, // open water
  { x: 2.5, z: 4.5, rx: 6.0, rz: 4.4, depth: 2.9 }, // the deep pool (south)
  { x: 8.0, z: -5.2, rx: 4.8, rz: 4.2, depth: 0.8 }, // lily cove (north-east)
  { x: -6.0, z: -5.0, rx: 5.2, rz: 4.6, depth: 0.65 }, // willow shallows (north-west)
  { x: -5.0, z: -3.0, rx: 2.7, rz: 2.1, depth: 1.1 }, // scour pool under the log: deep enough to dive
];

export type AreaId = 'lily' | 'willow' | 'deep';

export interface Area {
  id: AreaId;
  title: string;
  subtitle: string;
  x: number;
  z: number;
  radius: number;
}

export const AREAS: readonly Area[] = [
  { id: 'lily', title: 'Lily Cove', subtitle: 'Pads, blooms and dragonflies', x: 7.8, z: -5.2, radius: 4.2 },
  { id: 'willow', title: 'Willow Shallows', subtitle: 'Reeds, roots and a mossy log', x: -6.0, z: -4.8, radius: 4.4 },
  { id: 'deep', title: 'The Deep Pool', subtitle: 'Hold Space to look beneath', x: 2.5, z: 4.8, radius: 3.6 },
];

export const LANDMARKS = {
  /** Trunk base of the weeping willow, on the north-west bank. */
  willowBase: new THREE.Vector3(-10.5, 0, -8.9),
  /** Direction the willow leans, out over the shallows. */
  willowLean: new THREE.Vector2(0.72, 0.69),
  /** Half-submerged log lying in the willow shallows. */
  log: { x: -5.3, z: -3.3, yaw: 0.32, length: 3.5, radius: 0.2 },
  /** Small pad cluster with one bloom straight ahead of the spawn point. */
  heroBloom: new THREE.Vector3(0.15, 0, -0.9),
  /** Centre of the main lily pad field. */
  lilyField: new THREE.Vector3(8.0, 0, -5.3),
  /** Centre of the deepest water. */
  deepCentre: new THREE.Vector3(2.5, 0, 4.6),
} as const;

/** The duck starts over open water, looking a little west of north. */
export const SPAWN = {
  x: 1.0,
  z: 3.2,
  heading: Math.atan2(-0.208, -0.978),
} as const;

/** Late-afternoon sun, low in the west-south-west. Unit vector pointing AT the sun. */
export const SUN_DIRECTION = new THREE.Vector3(-0.8, 0.45, 0.28).normalize();

/** Bearing (from the pond centre) of the meadow gap that lets the low sun reach the water. */
export const SUN_GAP_BEARING = Math.atan2(SUN_DIRECTION.z, SUN_DIRECTION.x);
