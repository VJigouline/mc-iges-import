// IGES curves and surfaces, evaluated in IGES's own parameters, so that the parameter-space
// trimming curves of trimmed surfaces apply to them directly.

import { NurbsCurve, Vector3 } from 'mc-curves';
import { ConeSurface, CylinderSurface, Frame3, NurbsSurface, ParametricSurface, PlaneSurface, SphereSurface, TorusSurface, type ISurface } from 'mc-surfaces';
import type { IgesDocument, IgesEntity, IgesValue } from './iges.js';

/** A curve as a function of its parameter over [t0, t1]. */
export interface Curve {
  t0: number;
  t1: number;
  at(t: number): Vector3;
  /** A suggested number of segments to draw it with. */
  segments: number;
}

/** A surface for trimming: its mc-surfaces form, and whether its parameters are IGES's own. */
export interface Surface {
  surface: ISurface;
  /** True if parameter-space curves on it can be used as they are. */
  igesParameters: boolean;
  /** Periods of closed parameter directions, for unwrapping projected loops. */
  periodU: number | null;
  periodV: number | null;
}

export class Transform {
  constructor(
    readonly r: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1],
    readonly t: number[] = [0, 0, 0],
  ) {}

  apply(p: Vector3): Vector3 {
    const r = this.r;
    return new Vector3(r[0]! * p.x + r[1]! * p.y + r[2]! * p.z + this.t[0]!, r[3]! * p.x + r[4]! * p.y + r[5]! * p.z + this.t[1]!, r[6]! * p.x + r[7]! * p.y + r[8]! * p.z + this.t[2]!);
  }

  /** Directions turn without moving. */
  applyDirection(p: Vector3): Vector3 {
    const r = this.r;
    return new Vector3(r[0]! * p.x + r[1]! * p.y + r[2]! * p.z, r[3]! * p.x + r[4]! * p.y + r[5]! * p.z, r[6]! * p.x + r[7]! * p.y + r[8]! * p.z);
  }

  /** This transform after `inner`. */
  compose(inner: Transform): Transform {
    const a = this.r;
    const b = inner.r;
    const r: number[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!);
    const t = this.apply(new Vector3(inner.t[0]!, inner.t[1]!, inner.t[2]!));
    return new Transform(r, [t.x, t.y, t.z]);
  }

  get isIdentity(): boolean {
    return this.r.every((v, i) => v === [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) && this.t.every((v) => v === 0);
  }
}

export class GeometryError extends Error {
  override name = 'GeometryError';
}

const n = (v: IgesValue | undefined, d = 0) => (typeof v === 'number' ? v : d);

/** Reads geometry from a document, caching curves and surfaces by DE. */
export class Geometry {
  private readonly transforms = new Map<number, Transform>();
  readonly warnings = new Set<string>();

  constructor(readonly doc: IgesDocument) {}

  entity(de: number): IgesEntity {
    const e = this.doc.entities.get(de);
    if (!e) throw new GeometryError(`Entity ${de} is referred to but not defined`);
    return e;
  }

  /** The transform of a 124 entity, including the 124s it refers to in turn. */
  matrix(de: number, depth = 0): Transform {
    if (!de || depth > 32) return new Transform();
    const cached = this.transforms.get(de);
    if (cached) return cached;
    const e = this.entity(de);
    if (e.type !== 124) return new Transform();
    const p = e.params.map((v) => n(v));
    const own = new Transform([p[0]!, p[1]!, p[2]!, p[4]!, p[5]!, p[6]!, p[8]!, p[9]!, p[10]!], [p[3]!, p[7]!, p[11]!]);
    const result = e.transform ? this.matrix(e.transform, depth + 1).compose(own) : own;
    this.transforms.set(de, result);
    return result;
  }

  /** An entity's transform, if any. */
  transformOf(e: IgesEntity): Transform | null {
    return e.transform ? this.matrix(e.transform) : null;
  }

  point(de: number): Vector3 {
    const e = this.entity(de);
    const p = new Vector3(n(e.params[0]), n(e.params[1]), n(e.params[2]));
    const t = this.transformOf(e);
    return t ? t.apply(p) : p;
  }

  direction(de: number): Vector3 {
    const e = this.entity(de);
    const p = new Vector3(n(e.params[0]), n(e.params[1]), n(e.params[2]));
    const t = this.transformOf(e);
    return (t ? t.applyDirection(p) : p).normalized();
  }

  /** A curve entity, with its transform applied. */
  curve(de: number, depth = 0): Curve {
    if (depth > 64) throw new GeometryError('Curves nest too deeply');
    const e = this.entity(de);
    const c = this.rawCurve(e, depth);
    const t = this.transformOf(e);
    if (!t || t.isIdentity) return c;
    return { ...c, at: (s) => t.apply(c.at(s)) };
  }

  private rawCurve(e: IgesEntity, depth: number): Curve {
    const p = e.params;
    switch (e.type) {
      case 110: {
        const a = new Vector3(n(p[0]), n(p[1]), n(p[2]));
        const b = new Vector3(n(p[3]), n(p[4]), n(p[5]));
        return { t0: 0, t1: 1, at: (t) => a.lerp(b, t), segments: 1 };
      }
      case 100: {
        const z = n(p[0]);
        const [cx, cy, sx, sy, ex, ey] = [n(p[1]), n(p[2]), n(p[3]), n(p[4]), n(p[5]), n(p[6])];
        const r = Math.hypot(sx - cx, sy - cy);
        const a0 = Math.atan2(sy - cy, sx - cx);
        let a1 = Math.atan2(ey - cy, ex - cx);
        while (a1 <= a0 + 1e-12) a1 += Math.PI * 2;
        return { t0: a0, t1: a1, at: (t) => new Vector3(cx + r * Math.cos(t), cy + r * Math.sin(t), z), segments: Math.max(4, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 64)) };
      }
      case 104:
        return this.conic(e);
      case 106: {
        const ip = n(p[0]);
        const count = n(p[1]);
        const pts: Vector3[] = [];
        if (ip === 1) {
          const z = n(p[2]);
          for (let i = 0; i < count; i++) pts.push(new Vector3(n(p[3 + 2 * i]), n(p[4 + 2 * i]), z));
        } else {
          const stride = ip === 3 ? 6 : 3;
          for (let i = 0; i < count; i++) pts.push(new Vector3(n(p[2 + stride * i]), n(p[3 + stride * i]), n(p[4 + stride * i])));
        }
        if (pts.length < 2) throw new GeometryError('A copious data entity has fewer than two points');
        return {
          t0: 0,
          t1: pts.length - 1,
          at: (t) => {
            const i = Math.min(pts.length - 2, Math.max(0, Math.floor(t)));
            return pts[i]!.lerp(pts[i + 1]!, t - i);
          },
          segments: pts.length - 1,
        };
      }
      case 112: {
        const nSeg = n(p[3]);
        const breaks = Array.from({ length: nSeg + 1 }, (_, i) => n(p[4 + i]));
        const coef = (seg: number, k: number) => n(p[5 + nSeg + seg * 12 + k]);
        return {
          t0: breaks[0]!,
          t1: breaks[nSeg]!,
          at: (t) => {
            let i = 0;
            while (i < nSeg - 1 && t > breaks[i + 1]!) i++;
            const s = t - breaks[i]!;
            const poly = (o: number) => coef(i, o) + coef(i, o + 1) * s + coef(i, o + 2) * s * s + coef(i, o + 3) * s * s * s;
            return new Vector3(poly(0), poly(4), poly(8));
          },
          segments: nSeg * 8,
        };
      }
      case 126: {
        const k = n(p[0]);
        const m = n(p[1]);
        const nKnots = k + m + 2;
        const knots = p.slice(6, 6 + nKnots).map((v) => n(v));
        const weights = p.slice(6 + nKnots, 6 + nKnots + k + 1).map((v) => n(v, 1));
        const base = 6 + nKnots + k + 1;
        const ctrl = Array.from({ length: k + 1 }, (_, i) => new Vector3(n(p[base + 3 * i]), n(p[base + 3 * i + 1]), n(p[base + 3 * i + 2])));
        const v0 = n(p[base + 3 * (k + 1)], knots[m]!);
        const v1 = n(p[base + 3 * (k + 1) + 1], knots[k + 1]!);
        const polynomial = n(p[4]) === 1 || weights.every((w) => w === weights[0]);
        const curve = new NurbsCurve(m, ctrl, knots, polynomial ? undefined : weights.map((w) => (w > 0 ? w : 1e-12)));
        const lo = Math.max(v0, curve.domain.start);
        const hi = Math.min(v1, curve.domain.end);
        return { t0: lo, t1: hi > lo ? hi : curve.domain.end, at: (t) => curve.pointAt(Math.min(curve.domain.end, Math.max(curve.domain.start, t))), segments: Math.max(8, (k + 1) * Math.max(2, m) * 2) };
      }
      case 102: {
        const count = n(p[0]);
        const parts = Array.from({ length: count }, (_, i) => {
          try {
            return this.curve(n(p[1 + i]), depth + 1);
          } catch (error) {
            this.warnings.add(`A composite curve part could not be read: ${(error as Error).message}`);
            return null;
          }
        }).filter((c): c is Curve => !!c);
        if (!parts.length) throw new GeometryError('A composite curve has no readable parts');
        return {
          t0: 0,
          t1: parts.length,
          at: (t) => {
            const i = Math.min(parts.length - 1, Math.max(0, Math.floor(t)));
            const c = parts[i]!;
            return c.at(c.t0 + (c.t1 - c.t0) * Math.min(1, t - i));
          },
          segments: parts.reduce((s, c) => s + c.segments, 0),
        };
      }
      case 142:
        // A curve on a surface, used as a curve: its model-space curve, or its parameter curve on the surface.
        if (n(p[3])) return this.curve(n(p[3]), depth + 1);
        return this.onSurface(n(p[1]), n(p[2]));
      default:
        throw new GeometryError(`Curve type ${e.type} is not supported`);
    }
  }

  /** Conic arcs: ellipses in standard position, and parabolas and hyperbolas by solving the equation. */
  private conic(e: IgesEntity): Curve {
    const p = e.params.map((v) => n(v));
    const [A, B, C, D, E, F, z, x1, y1, x2, y2] = p as [number, number, number, number, number, number, number, number, number, number, number];
    if (e.form === 1 || (A * C > 0 && Math.abs(B) < 1e-12)) {
      const a = Math.sqrt(Math.abs(F / A));
      const b = Math.sqrt(Math.abs(F / C));
      const t0 = Math.atan2(y1 / b, x1 / a);
      let t1 = Math.atan2(y2 / b, x2 / a);
      while (t1 <= t0 + 1e-12) t1 += Math.PI * 2;
      return { t0, t1, at: (t) => new Vector3(a * Math.cos(t), b * Math.sin(t), z), segments: 48 };
    }
    // Solve for the coordinate that varies less, sweeping the other.
    const sweepX = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    const solve = (s: number, guess: number) => {
      // Quadratic in the free coordinate w: a w^2 + b w + c = 0.
      const [qa, qb, qc] = sweepX ? [C, B * s + E, A * s * s + D * s + F] : [A, B * s + D, C * s * s + E * s + F];
      if (Math.abs(qa) < 1e-14) return Math.abs(qb) > 1e-14 ? -qc / qb : guess;
      const disc = Math.max(0, qb * qb - 4 * qa * qc);
      const r1 = (-qb + Math.sqrt(disc)) / (2 * qa);
      const r2 = (-qb - Math.sqrt(disc)) / (2 * qa);
      return Math.abs(r1 - guess) < Math.abs(r2 - guess) ? r1 : r2;
    };
    return {
      t0: 0,
      t1: 1,
      at: (t) => {
        const s = sweepX ? x1 + (x2 - x1) * t : y1 + (y2 - y1) * t;
        const guess = sweepX ? y1 + (y2 - y1) * t : x1 + (x2 - x1) * t;
        const w = solve(s, guess);
        return sweepX ? new Vector3(s, w, z) : new Vector3(w, s, z);
      },
      segments: 32,
    };
  }

  /** A parameter-space curve mapped onto its surface. */
  private onSurface(surfaceDe: number, curveDe: number): Curve {
    const s = this.surface(surfaceDe).surface;
    const c = this.curve(curveDe);
    return { ...c, at: (t) => {
      const uv = c.at(t);
      return s.pointAt(uv.x, uv.y);
    } };
  }

  /** A surface entity, with its transform applied. */
  surface(de: number): Surface {
    const e = this.entity(de);
    const raw = this.rawSurface(e);
    const t = this.transformOf(e);
    if (!t || t.isIdentity) return raw;
    const s = raw.surface;
    const moved = new ParametricSurface((u, v) => t.apply(s.pointAt(u, v)), s.domainU.start, s.domainU.end, s.domainV.start, s.domainV.end);
    return { ...raw, surface: moved };
  }

  private rawSurface(e: IgesEntity): Surface {
    const p = e.params;
    switch (e.type) {
      case 128: {
        const k1 = n(p[0]);
        const k2 = n(p[1]);
        const m1 = n(p[2]);
        const m2 = n(p[3]);
        let i = 9;
        const take = (count: number) => {
          const out = p.slice(i, i + count).map((v) => n(v));
          i += count;
          return out;
        };
        const ku = take(k1 + m1 + 2);
        const kv = take(k2 + m2 + 2);
        const w = take((k1 + 1) * (k2 + 1));
        const c = take(3 * (k1 + 1) * (k2 + 1));
        // Control points and weights run with u fastest.
        const ctrl = Array.from({ length: k1 + 1 }, (_, iu) => Array.from({ length: k2 + 1 }, (_, iv) => {
          const j = iv * (k1 + 1) + iu;
          return new Vector3(c[3 * j]!, c[3 * j + 1]!, c[3 * j + 2]!);
        }));
        const polynomial = n(p[6]) === 1 || w.every((x) => x === w[0]);
        const weights = polynomial ? undefined : Array.from({ length: k1 + 1 }, (_, iu) => Array.from({ length: k2 + 1 }, (_, iv) => Math.max(1e-12, w[iv * (k1 + 1) + iu]!)));
        const surface = new NurbsSurface(m1, m2, ctrl, ku, kv, weights);
        const closedU = n(p[4]) === 1 || n(p[7]) === 1;
        const closedV = n(p[5]) === 1 || n(p[8]) === 1;
        return {
          surface,
          igesParameters: true,
          periodU: closedU ? surface.domainU.end - surface.domainU.start : null,
          periodV: closedV ? surface.domainV.end - surface.domainV.start : null,
        };
      }
      case 120: {
        // Revolution of a generatrix about an axis line, from angle SA to TA.
        const axis = this.curve(n(p[0]));
        const gen = this.curve(n(p[1]));
        const sa = n(p[2]);
        const ta = n(p[3], Math.PI * 2);
        const o = axis.at(axis.t0);
        const d = axis.at(axis.t1).sub(o).normalized();
        const rotate = (q: Vector3, angle: number) => {
          const v = q.sub(o);
          const along = d.scale(v.dot(d));
          const radial = v.sub(along);
          return o.add(along).add(radial.scale(Math.cos(angle))).add(d.cross(radial).scale(Math.sin(angle)));
        };
        // IGES parameterizes a surface of revolution by the generatrix parameter, then the angle.
        const surface = new ParametricSurface((u, v) => rotate(gen.at(u), v), gen.t0, gen.t1, sa, ta);
        return { surface, igesParameters: true, periodU: null, periodV: Math.abs(ta - sa - Math.PI * 2) < 1e-6 ? Math.PI * 2 : null };
      }
      case 122: {
        const dir = this.curve(n(p[0]));
        const end = new Vector3(n(p[1]), n(p[2]), n(p[3]));
        const shift = end.sub(dir.at(dir.t0));
        const surface = new ParametricSurface((u, v) => dir.at(dir.t0 + (dir.t1 - dir.t0) * u).add(shift.scale(v)), 0, 1, 0, 1);
        return { surface, igesParameters: true, periodU: null, periodV: null };
      }
      case 118: {
        const c1 = this.curve(n(p[0]));
        const c2 = this.curve(n(p[1]));
        const reversed = n(p[2]) === 1;
        const surface = new ParametricSurface((u, v) => {
          const a = c1.at(c1.t0 + (c1.t1 - c1.t0) * u);
          const b = c2.at(reversed ? c2.t1 - (c2.t1 - c2.t0) * u : c2.t0 + (c2.t1 - c2.t0) * u);
          return a.lerp(b, v);
        }, 0, 1, 0, 1);
        return { surface, igesParameters: true, periodU: null, periodV: null };
      }
      case 108: {
        const normal = new Vector3(n(p[0]), n(p[1]), n(p[2]));
        const len = normal.length;
        if (!len) throw new GeometryError('A plane has no normal');
        const origin = normal.scale(n(p[3]) / (len * len));
        const big = 1e9;
        return { surface: new PlaneSurface(Frame3.fromNormal(origin, normal.normalized()), { u: [-big, big], v: [-big, big] }), igesParameters: false, periodU: null, periodV: null };
      }
      case 190: {
        const origin = this.point(n(p[0]));
        const normal = this.direction(n(p[1]));
        const ref = p[2] ? this.direction(n(p[2])) : undefined;
        const big = 1e9;
        return { surface: new PlaneSurface(Frame3.fromNormal(origin, normal, ref), { u: [-big, big], v: [-big, big] }), igesParameters: false, periodU: null, periodV: null };
      }
      case 192: {
        const origin = this.point(n(p[0]));
        const axis = this.direction(n(p[1]));
        const radius = n(p[2]);
        const ref = p[3] ? this.direction(n(p[3])) : undefined;
        const big = 1e6;
        return { surface: new CylinderSurface(Frame3.fromNormal(origin, axis, ref), radius, { v: [-big, big] }), igesParameters: false, periodU: Math.PI * 2, periodV: null };
      }
      case 194: {
        const origin = this.point(n(p[0]));
        const axis = this.direction(n(p[1]));
        const radius = n(p[2]);
        const angle = (n(p[3]) * Math.PI) / 180;
        const ref = p[4] ? this.direction(n(p[4])) : undefined;
        const big = 1e6;
        return { surface: new ConeSurface(Frame3.fromNormal(origin, axis, ref), radius, angle, { v: [-big, big] }), igesParameters: false, periodU: Math.PI * 2, periodV: null };
      }
      case 196: {
        const centre = this.point(n(p[0]));
        const radius = n(p[1]);
        const axis = p[2] ? this.direction(n(p[2])) : Vector3.Z;
        const ref = p[3] ? this.direction(n(p[3])) : undefined;
        return { surface: new SphereSurface(Frame3.fromNormal(centre, axis, ref), radius), igesParameters: false, periodU: Math.PI * 2, periodV: null };
      }
      case 198: {
        const centre = this.point(n(p[0]));
        const axis = this.direction(n(p[1]));
        const major = n(p[2]);
        const minor = n(p[3]);
        const ref = p[4] ? this.direction(n(p[4])) : undefined;
        return { surface: new TorusSurface(Frame3.fromNormal(centre, axis, ref), major, minor), igesParameters: false, periodU: Math.PI * 2, periodV: Math.PI * 2 };
      }
      default:
        throw new GeometryError(`Surface type ${e.type} is not supported`);
    }
  }
}
