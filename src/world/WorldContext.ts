import type * as THREE from 'three';
import type { PondUniforms } from '../water/pondShading';
import type { Colliders } from './Colliders';
import type { DensityRegistry } from './instancing';
import type { Heightfield } from './Terrain';

/** Everything a scenery builder needs: where the ground is, how to shade, what to register. */
export interface WorldContext {
  field: Heightfield;
  pond: PondUniforms;
  colliders: Colliders;
  density: DensityRegistry;
  /** Maximum anisotropy the GPU supports, for ground-hugging textures. */
  maxAnisotropy: number;
  /** Things the duck's eye can perch on or hide behind, filled in by builders. */
  perches: THREE.Vector3[];
  /** Reed-bed centres, used to drive the rustle in the soundscape. */
  reedBeds: THREE.Vector3[];
}
