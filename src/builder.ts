// Builds three.js objects from IGES entities: trimmed and bounded surfaces and B-rep faces are
// made into mc-solids faces with loops in their surface's parameters, then tessellated; free
// curves and points are drawn as lines and points. Objects are grouped by level and coloured.

import * as THREE from 'three';
import { ParametricCurve, Vector3 } from 'mc-curves';
import { Coedge, Edge, Face, Loop, Vertex } from 'mc-solids';
import type { ISurface } from 'mc-surfaces';
import { Geometry, GeometryError, Transform, type Curve, type Surface } from './geometry.js';
import { IGES_UNITS, type IgesDocument, type IgesEntity } from './iges.js';

export interface IgesOptions {
  /** Largest distance between a surface and its triangles, in model units. Default: 1/2000 of the model's size. */
  chordTolerance?: number;
  /** Metres per model unit, overriding the file's units. */
  unitScale?: number;
  /** Draws curves that belong to no surface. Default true. */
  curves?: boolean;
  /** Adds entities that are blanked (hidden), hidden. Default false: they are left out. */
  blanked?: boolean;
}

export interface IgesStats {
  entities: number;
  faces: number;
  failedFaces: number;
  triangles: number;
  curves: number;
  points: number;
  /** Entities not drawn, by type number. */
  skipped: Record<string, number>;
}

type UV = { u: number; v: number };

const STANDARD_COLORS: Record<number, number> = { 1: 0x000000, 2: 0xff0000, 3: 0x00ff00, 4: 0x0000ff, 5: 0xffff00, 6: 0xff00ff, 7: 0x00ffff, 8: 0xffffff };
const DEFAULT_COLOR = 0xb4b4b4;
const SURFACES = new Set([108, 114, 118, 120, 122, 128, 140, 190, 192, 194, 196, 198]);
const CURVES = new Set([100, 102, 104, 106, 110, 112, 126, 130]);

export class IgesBuilder {
  readonly warnings: string[] = [];
  readonly stats: IgesStats = { entities: 0, faces: 0, failedFaces: 0, triangles: 0, curves: 0, points: 0, skipped: {} };
  private readonly geo: Geometry;
  private readonly options: IgesOptions;
  private tolerance = 0.01;
  private readonly warned = new Set<string>();
  private readonly levels = new Map<string, { faces: Map<number, number[]>; normals: Map<number, number[]>; lines: Map<number, number[]>; points: Map<number, number[]> }>();

  constructor(
    readonly doc: IgesDocument,
    options: IgesOptions = {},
  ) {
    this.geo = new Geometry(doc);
    this.options = options;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(message);
  }

  private skip(type: number, reason: string): void {
    this.stats.skipped[type] = (this.stats.skipped[type] ?? 0) + 1;
    this.warnOnce(`skip:${type}`, reason);
  }

  /** The colour of an entity as RGB. */
  color(e: IgesEntity): number {
    if (e.color < 0) {
      const def = this.doc.entities.get(-e.color);
      if (def?.type === 314) {
        const [r, g, b] = def.params.map((v) => (typeof v === 'number' ? v : 0));
        const c = (x = 0) => Math.max(0, Math.min(255, Math.round((x / 100) * 255)));
        return (c(r) << 16) | (c(g) << 8) | c(b);
      }
    }
    return STANDARD_COLORS[e.color] ?? DEFAULT_COLOR;
  }

  private levelName(e: IgesEntity): string {
    return e.level > 0 ? `Level ${e.level}` : 'Level 0';
  }

  private bucket(e: IgesEntity) {
    const name = this.levelName(e);
    let l = this.levels.get(name);
    if (!l) this.levels.set(name, (l = { faces: new Map(), normals: new Map(), lines: new Map(), points: new Map() }));
    return l;
  }

  /** The size of the model, from its curves' and surfaces' points, for a default tolerance. */
  private modelSize(): number {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const add = (x: number, y: number, z: number) => {
      if (!Number.isFinite(x + y + z)) return;
      lo[0] = Math.min(lo[0]!, x); lo[1] = Math.min(lo[1]!, y); lo[2] = Math.min(lo[2]!, z);
      hi[0] = Math.max(hi[0]!, x); hi[1] = Math.max(hi[1]!, y); hi[2] = Math.max(hi[2]!, z);
    };
    for (const e of this.doc.entities.values()) {
      if (e.status.subordinate === 0 && ![144, 143, 186, 128, 110, 100, 126].includes(e.type)) continue;
      const t = e.transform ? this.geo.matrix(e.transform) : null;
      const at = (x: number, y: number, z: number) => {
        const p = t ? t.apply(new Vector3(x, y, z)) : new Vector3(x, y, z);
        add(p.x, p.y, p.z);
      };
      const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
      if (e.type === 110) {
        at(p[0]!, p[1]!, p[2]!);
        at(p[3]!, p[4]!, p[5]!);
      } else if (e.type === 128) {
        const k1 = p[0]!, k2 = p[1]!, m1 = p[2]!, m2 = p[3]!;
        const start = 9 + (k1 + m1 + 2) + (k2 + m2 + 2) + (k1 + 1) * (k2 + 1);
        for (let i = 0; i < (k1 + 1) * (k2 + 1); i++) at(p[start + 3 * i]!, p[start + 3 * i + 1]!, p[start + 3 * i + 2]!);
      } else if (e.type === 126 && e.status.use !== 5) {
        const k = p[0]!, m = p[1]!;
        const start = 6 + (k + m + 2) + (k + 1);
        for (let i = 0; i <= k; i++) at(p[start + 3 * i]!, p[start + 3 * i + 1]!, p[start + 3 * i + 2]!);
      }
    }
    const d = Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
    return Number.isFinite(d) && d > 0 ? d : 1;
  }

  build(): THREE.Group {
    this.tolerance = this.options.chordTolerance ?? this.modelSize() / 2000;
    const instanced = new Set<number>();
    for (const e of this.doc.entities.values()) if (e.type === 408) instanced.add(e.de);
    for (const e of this.doc.entities.values()) {
      // Only independent entities are drawn; others are parts of them.
      if (e.status.subordinate !== 0 || instanced.has(e.de)) continue;
      if (e.status.blank === 1 && !this.options.blanked) continue;
      this.draw(e, null);
    }
    for (const w of this.geo.warnings) this.warnings.push(w);
    return this.output();
  }

  private draw(e: IgesEntity, outer: Transform | null, depth = 0): void {
    if (depth > 16) return;
    this.stats.entities++;
    try {
      switch (e.type) {
        case 144:
          this.trimmed(e, outer);
          break;
        case 143:
          this.bounded(e, outer);
          break;
        case 186:
          this.solid(e, outer);
          break;
        case 514:
          this.shell(e, outer);
          break;
        case 510:
          this.brepFace(e, outer);
          break;
        case 408:
          this.instance(e, outer, depth);
          break;
        case 116:
          this.points(e, [this.geo.point(e.de)], outer);
          break;
        case 108:
          if (e.form !== 0 && typeof e.params[4] === 'number' && e.params[4] > 0) this.planeRegion(e, outer);
          else this.skip(108, 'Unbounded planes are not drawn');
          break;
        default:
          if (CURVES.has(e.type)) {
            if (this.options.curves ?? true) this.freeCurve(e, outer);
          } else if (SURFACES.has(e.type)) {
            this.untrimmed(e, outer);
          } else if (![124, 314, 402, 406, 308, 0, 212, 214, 216, 218, 222, 228, 230, 202, 204, 206, 210, 220, 304, 410, 404, 502, 504, 508, 123].includes(e.type)) {
            this.skip(e.type, `Entity type ${e.type} is not read`);
          }
      }
    } catch (error) {
      if (SURFACES.has(e.type) || [144, 143, 186, 510, 514].includes(e.type)) this.stats.failedFaces++;
      this.warnOnce(`fail:${e.type}:${(error as Error).message}`, `Entity ${e.de} (type ${e.type}) could not be read: ${(error as Error).message}`);
    }
  }

  // Faces.

  /** Samples a curve into points. */
  private sample(c: Curve): Vector3[] {
    const count = Math.max(2, Math.min(2000, c.segments * 4));
    return Array.from({ length: count + 1 }, (_, i) => c.at(c.t0 + ((c.t1 - c.t0) * i) / count));
  }

  /** A loop's polygon in the surface's parameters, from a parameter-space curve. */
  private uvFromParameterCurve(curveDe: number): UV[] {
    return this.sample(this.geo.curve(curveDe)).map((p) => ({ u: p.x, v: p.y }));
  }

  /** A loop's polygon in the surface's parameters, by projecting a model-space curve onto it. */
  private uvFromModelCurve(points: Vector3[], s: Surface): UV[] {
    const out: UV[] = [];
    for (const p of points) {
      const c = s.surface.closestPoint(p);
      let { u, v } = c;
      // Unwrap closed directions, so the loop stays continuous across seams.
      const prev = out[out.length - 1];
      if (prev && s.periodU) u += s.periodU * Math.round((prev.u - u) / s.periodU);
      if (prev && s.periodV) v += s.periodV * Math.round((prev.v - v) / s.periodV);
      out.push({ u, v });
    }
    return out;
  }

  /** The parameter polygon of a 142 curve on a surface, preferring its parameter curve where its parameters can be trusted. */
  private curveOnSurface(de: number, s: Surface, transform: Transform | null): UV[] {
    const e = this.geo.entity(de);
    if (e.type !== 142) {
      // A plain model-space curve as a boundary.
      const pts = this.sample(this.geo.curve(de)).map((p) => (transform ? transform.apply(p) : p));
      return this.uvFromModelCurve(pts, s);
    }
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const bptr = p[2]!;
    const cptr = p[3]!;
    if (bptr && s.igesParameters) return this.uvFromParameterCurve(bptr);
    if (cptr) {
      const pts = this.sample(this.geo.curve(cptr)).map((q) => (transform ? transform.apply(q) : q));
      return this.uvFromModelCurve(pts, s);
    }
    if (bptr) return this.uvFromParameterCurve(bptr);
    throw new GeometryError('A curve on a surface has neither a parameter curve nor a model curve');
  }

  /** The domain rectangle of a surface, as an outer loop. */
  private domainLoop(surface: ISurface): UV[] {
    const { domainU: du, domainV: dv } = surface;
    return [
      { u: du.start, v: dv.start },
      { u: du.end, v: dv.start },
      { u: du.end, v: dv.end },
      { u: du.start, v: dv.end },
    ];
  }

  /** Tessellates a region of a surface bounded by parameter polygons. */
  private face(e: IgesEntity, s: Surface, outer: UV[], holes: UV[][], transform: Transform | null, color: number): void {
    const area = (poly: UV[]) => {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        a += p.u * q.v - q.u * p.v;
      }
      return a / 2;
    };
    const clean = (poly: UV[]) => {
      const out: UV[] = [];
      for (const p of poly) {
        const last = out[out.length - 1];
        if (!last || Math.abs(last.u - p.u) + Math.abs(last.v - p.v) > 1e-12) out.push(p);
      }
      const first = out[0];
      const last = out[out.length - 1];
      if (first && last && out.length > 1 && Math.abs(first.u - last.u) + Math.abs(first.v - last.v) < 1e-12) out.pop();
      return out;
    };
    const loop = (poly: UV[], ccw: boolean) => {
      const p = clean(poly);
      if (p.length < 3) throw new GeometryError('A trimming loop has fewer than three points');
      const ordered = area(p) > 0 === ccw ? p : [...p].reverse();
      const closed = [...ordered, ordered[0]!];
      const ts = closed.map((_, i) => i);
      const at = (t: number): UV => {
        const i = Math.min(closed.length - 2, Math.max(0, Math.floor(t)));
        const f = t - i;
        return { u: closed[i]!.u + (closed[i + 1]!.u - closed[i]!.u) * f, v: closed[i]!.v + (closed[i + 1]!.v - closed[i]!.v) * f };
      };
      const curve = new ParametricCurve((t) => {
        const uv = at(t);
        return s.surface.pointAt(uv.u, uv.v);
      }, 0, closed.length - 1);
      const vertex = new Vertex(s.surface.pointAt(ordered[0]!.u, ordered[0]!.v));
      const edge = new Edge(curve, 0, closed.length - 1, vertex, vertex);
      return new Loop([new Coedge(edge, true, ts, closed)]);
    };
    let outerPoly = outer;
    if (Math.abs(area(clean(outer))) < 1e-14) {
      // A loop with no area in the parameter plane, such as a full turn without its seam: use the domain.
      outerPoly = this.domainLoop(s.surface);
      this.warnOnce('seamless', 'Some faces have boundaries without seams; their whole surface is drawn');
    }
    const f = new Face(s.surface, loop(outerPoly, true), holes.map((h) => loop(h, false)));
    const mesh = f.tessellate(this.tolerance);
    const l = this.bucket(e);
    const pos = l.faces.get(color) ?? [];
    const nor = l.normals.get(color) ?? [];
    for (const i of mesh.triangles) {
      const p = transform ? transform.apply(mesh.points[i]!) : mesh.points[i]!;
      const q = transform ? transform.applyDirection(mesh.normals[i]!).normalized() : mesh.normals[i]!;
      pos.push(p.x, p.y, p.z);
      nor.push(q.x, q.y, q.z);
    }
    l.faces.set(color, pos);
    l.normals.set(color, nor);
    this.stats.faces++;
    this.stats.triangles += mesh.triangles.length / 3;
  }

  private colorOf(e: IgesEntity, ...fallbacks: IgesEntity[]): number {
    for (const x of [e, ...fallbacks]) if (x.color !== 0) return this.color(x);
    return DEFAULT_COLOR;
  }

  private withOuter(e: IgesEntity, outer: Transform | null): Transform | null {
    // Trimming curves and surfaces carry their own transforms; a trimmed surface's own one applies to the result.
    const own = e.transform ? this.geo.matrix(e.transform) : null;
    if (own && outer) return outer.compose(own);
    return own ?? outer;
  }

  /** Entity 144: a surface trimmed by curves on it. */
  private trimmed(e: IgesEntity, outer: Transform | null): void {
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const surfaceDe = p[0]!;
    const hasOuter = p[1] === 1;
    const holes = p[2]!;
    const s = this.geo.surface(surfaceDe);
    const transform = this.withOuter(e, outer);
    const outerPoly = hasOuter && p[3] ? this.curveOnSurface(p[3], s, null) : this.domainLoop(s.surface);
    const holePolys = Array.from({ length: holes }, (_, i) => this.curveOnSurface(p[4 + i]!, s, null));
    this.face(e, s, outerPoly, holePolys, transform, this.colorOf(e, this.geo.entity(surfaceDe)));
  }

  /** Entity 143: a surface bounded by 141 boundaries. */
  private bounded(e: IgesEntity, outer: Transform | null): void {
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const s = this.geo.surface(p[1]!);
    const loops = Array.from({ length: p[2]! }, (_, i) => this.boundary(p[3 + i]!, s));
    if (!loops.length) return;
    this.face(e, s, loops[0]!, loops.slice(1), this.withOuter(e, outer), this.colorOf(e, this.geo.entity(p[1]!)));
  }

  /** Entity 141: a boundary as model curves, with parameter curves where given. */
  private boundary(de: number, s: Surface): UV[] {
    const e = this.geo.entity(de);
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const type = p[0]!;
    const count = p[3]!;
    const out: UV[] = [];
    let i = 4;
    for (let k = 0; k < count; k++) {
      const curve = p[i]!;
      const sense = p[i + 1]!;
      const nParam = p[i + 2]!;
      const params = p.slice(i + 3, i + 3 + nParam);
      i += 3 + nParam;
      let uv: UV[];
      if (type === 1 && params.length && s.igesParameters) uv = params.flatMap((c) => this.uvFromParameterCurve(c));
      else uv = this.uvFromModelCurve(this.sample(this.geo.curve(curve)), s);
      out.push(...(sense === 2 ? uv.reverse() : uv));
    }
    return out;
  }

  /** Entity 186: a manifold solid B-rep: an outer shell and voids. */
  private solid(e: IgesEntity, outer: Transform | null): void {
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const t = this.withOuter(e, outer);
    this.shell(this.geo.entity(p[0]!), t);
    const voids = p[2]!;
    for (let i = 0; i < voids; i++) this.shell(this.geo.entity(p[3 + 2 * i]!), t);
  }

  private shell(e: IgesEntity, outer: Transform | null): void {
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const count = p[0]!;
    for (let i = 0; i < count; i++) {
      try {
        this.brepFace(this.geo.entity(p[1 + 2 * i]!), outer);
      } catch (error) {
        this.stats.failedFaces++;
        this.warnOnce(`face:${(error as Error).message}`, `A B-rep face could not be read: ${(error as Error).message}`);
      }
    }
  }

  /** Entity 510: a face of a surface bounded by 508 loops of 504 edges. */
  private brepFace(e: IgesEntity, outer: Transform | null): void {
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const s = this.geo.surface(p[0]!);
    const loops = Array.from({ length: p[1]! }, (_, i) => this.brepLoop(p[3 + i]!, s));
    if (!loops.length) {
      this.face(e, s, this.domainLoop(s.surface), [], outer, this.colorOf(e, this.geo.entity(p[0]!)));
      return;
    }
    // The outer loop flag says whether the first loop is the outer one.
    this.face(e, s, loops[0]!, loops.slice(1), outer, this.colorOf(e, this.geo.entity(p[0]!)));
  }

  private brepLoop(de: number, s: Surface): UV[] {
    const e = this.geo.entity(de);
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const count = p[0]!;
    const out: UV[] = [];
    let i = 1;
    for (let k = 0; k < count; k++) {
      const type = p[i]!;
      const list = p[i + 1]!;
      const index = p[i + 2]!;
      const forward = p[i + 3]! === 1;
      const nParam = p[i + 4]!;
      const params: number[] = [];
      for (let j = 0; j < nParam; j++) params.push(p[i + 6 + 2 * j]!);
      i += 5 + 2 * nParam;
      if (type === 1) continue; // a vertex
      let uv: UV[];
      if (params.length && s.igesParameters) {
        uv = params.flatMap((c) => this.uvFromParameterCurve(c));
        if (!forward) uv.reverse();
      } else {
        const edges = this.geo.entity(list);
        const ep = edges.params.map((v) => (typeof v === 'number' ? v : 0));
        const curve = ep[1 + 5 * (index - 1)]!;
        const pts = this.sample(this.geo.curve(curve));
        if (!forward) pts.reverse();
        uv = this.uvFromModelCurve(pts, s);
      }
      out.push(...uv);
    }
    return out;
  }

  /** A surface that no trimmed surface uses: drawn over its whole domain. */
  private untrimmed(e: IgesEntity, outer: Transform | null): void {
    if (e.type === 108 || e.type === 190) {
      this.skip(e.type, 'Unbounded planes are not drawn');
      return;
    }
    const s = this.geo.surface(e.de);
    this.face(e, s, this.domainLoop(s.surface), [], outer, this.colorOf(e));
  }

  /** Entity 108 form 1: a plane bounded by a closed curve. */
  private planeRegion(e: IgesEntity, outer: Transform | null): void {
    const s = this.geo.surface(e.de);
    const curve = e.params[4] as number;
    this.face(e, s, this.uvFromModelCurve(this.sample(this.geo.curve(curve)), s), [], outer, this.colorOf(e));
  }

  /** Entity 408: a placed copy of a 308 subfigure definition. */
  private instance(e: IgesEntity, outer: Transform | null, depth: number): void {
    const p = e.params.map((v) => (typeof v === 'number' ? v : 0));
    const def = this.geo.entity(p[0]!);
    const scale = p[4] || 1;
    let t = new Transform([scale, 0, 0, 0, scale, 0, 0, 0, scale], [p[1]!, p[2]!, p[3]!]);
    const own = e.transform ? this.geo.matrix(e.transform) : null;
    if (own) t = own.compose(t);
    if (outer) t = outer.compose(t);
    const dp = def.params.map((v) => (typeof v === 'number' ? v : 0));
    const count = dp[2]!;
    for (let i = 0; i < count; i++) {
      const child = this.doc.entities.get(dp[3 + i]!);
      if (child) this.draw(child, t, depth + 1);
    }
  }

  private freeCurve(e: IgesEntity, outer: Transform | null): void {
    const c = this.geo.curve(e.de);
    const pts = this.sample(c).map((p) => (outer ? outer.apply(p) : p));
    const l = this.bucket(e);
    const color = this.color(e);
    const list = l.lines.get(color) ?? [];
    for (let i = 0; i + 1 < pts.length; i++) list.push(pts[i]!.x, pts[i]!.y, pts[i]!.z, pts[i + 1]!.x, pts[i + 1]!.y, pts[i + 1]!.z);
    l.lines.set(color, list);
    this.stats.curves++;
  }

  private points(e: IgesEntity, pts: Vector3[], outer: Transform | null): void {
    const l = this.bucket(e);
    const color = this.color(e);
    const list = l.points.get(color) ?? [];
    for (const q of pts) {
      const p = outer ? outer.apply(q) : q;
      list.push(p.x, p.y, p.z);
    }
    l.points.set(color, list);
    this.stats.points += pts.length;
  }

  // Output.

  private output(): THREE.Group {
    const model = new THREE.Group();
    const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    const materials = new Map<number, THREE.MeshStandardMaterial>();
    for (const [name, l] of [...this.levels.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
      const group = new THREE.Group();
      group.name = name;
      for (const [color, pos] of l.faces) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(l.normals.get(color)!, 3));
        let m = materials.get(color);
        if (!m) materials.set(color, (m = new THREE.MeshStandardMaterial({ name: hex(color), color: hex(color), roughness: 0.5, metalness: 0, side: THREE.DoubleSide })));
        const mesh = new THREE.Mesh(geometry, m);
        mesh.name = `${name} ${hex(color)}`;
        group.add(mesh);
      }
      for (const [color, pos] of l.lines) {
        const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ name: hex(color), color: hex(color) }));
        lines.name = `${name} curves ${hex(color)}`;
        group.add(lines);
      }
      for (const [color, pos] of l.points) {
        const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        group.add(new THREE.Points(geometry, new THREE.PointsMaterial({ name: hex(color), color: hex(color), size: 3, sizeAttenuation: false })));
      }
      model.add(group);
    }
    return model;
  }

  /** Metres per model unit, from the global section. */
  unitScale(): number {
    if (this.options.unitScale) return this.options.unitScale;
    const g = this.doc.global;
    if (g.unitsFlag === 3) {
      const names: Record<string, number> = { IN: 0.0254, INCH: 0.0254, MM: 0.001, FT: 0.3048, MI: 1609.344, M: 1, KM: 1000, MIL: 2.54e-5, UM: 1e-6, CM: 0.01, UIN: 2.54e-8 };
      return names[g.unitsName.trim().toUpperCase()] ?? 1;
    }
    return IGES_UNITS[g.unitsFlag] ?? 1;
  }
}
