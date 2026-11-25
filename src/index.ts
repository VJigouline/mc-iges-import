import * as THREE from 'three';
import { IgesBuilder, type IgesOptions, type IgesStats } from './builder.js';
import { parseIges, type IgesGlobal } from './iges.js';

export { parseIges, splitParams, IgesError, IGES_UNITS } from './iges.js';
export type { IgesDocument, IgesEntity, IgesGlobal, IgesValue } from './iges.js';
export { Geometry, GeometryError, Transform } from './geometry.js';
export type { Curve, Surface } from './geometry.js';
export { IgesBuilder } from './builder.js';
export type { IgesOptions, IgesStats } from './builder.js';

export interface IgesLoadResult {
  /** The model, in metres and Y up: a group per level, holding a mesh and lines per colour. */
  group: THREE.Group;
  /** The global section: the sending system, units, author and so on. */
  global: IgesGlobal;
  /** Metres per model unit. */
  unitScale: number;
  warnings: string[];
  stats: IgesStats;
}

/** Reads an IGES file (.igs, .iges) and tessellates its surfaces. */
export function loadIges(input: string | ArrayBuffer | Uint8Array, options: IgesOptions = {}): IgesLoadResult {
  // IGES is ASCII; Latin-1 keeps any stray bytes in their columns.
  const text = typeof input === 'string' ? input : new TextDecoder('latin1').decode(input instanceof Uint8Array ? input : new Uint8Array(input));
  const doc = parseIges(text);
  const builder = new IgesBuilder(doc, options);
  const model = builder.build();
  const scale = builder.unitScale();
  const group = new THREE.Group();
  group.name = doc.global.fileName.replace(/\\/g, '/').split('/').pop()?.replace(/\.(igs|iges)$/i, '') || 'IGES';
  // IGES models are Z up.
  group.rotation.x = -Math.PI / 2;
  group.scale.setScalar(scale);
  group.add(model);
  if (doc.global.modelScale !== 1) builder.warnings.push(`The file's model scale is ${doc.global.modelScale}; it is not applied`);
  return { group, global: doc.global, unitScale: scale, warnings: builder.warnings, stats: builder.stats };
}
