import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { IgesError, loadIges, parseIges, splitParams } from '../src/index.js';
import { sample } from './files.js';

/** Writes an IGES file from entities given as [type, params, extra directory fields]. */
function iges(entities: { type: number; params: (number | string)[]; color?: number; level?: number; status?: string; form?: number }[], units = 2): string {
  const line = (text: string, section: string, n: number) => text.padEnd(72).slice(0, 72) + section + String(n).padStart(7);
  const out: string[] = [line('Test file', 'S', 1)];
  const global = `1H,,1H;,4Htest,8Htest.igs,4Htest,3H1.0,32,38,6,308,15,4Htest,1.,${units},2HMM,1,1.,13H260101.000000,1E-6,100.,1Ha,1Hb,11,0;`;
  for (let i = 0; i * 72 < global.length; i++) out.push(line(global.slice(i * 72, i * 72 + 72), 'G', i + 1));
  const d: string[] = [];
  const p: string[] = [];
  entities.forEach((e, i) => {
    const de = 2 * i + 1;
    const text = `${e.type},${e.params.join(',')};`;
    const start = p.length + 1;
    for (let k = 0; k * 64 < text.length; k++) p.push(text.slice(k * 64, k * 64 + 64).padEnd(64) + String(de).padStart(8) + 'P' + String(p.length + 1).padStart(7));
    const f = (v: number | string) => String(v).padStart(8);
    d.push(line([e.type, start, 0, 0, e.level ?? 0, 0, 0, 0].map(f).join('') + (e.status ?? '00000000'), 'D', de));
    d.push(line([e.type, 0, e.color ?? 0, p.length - start + 1, e.form ?? 0, '', '', ''].map(f).join(''), 'D', de + 1));
  });
  out.push(...d, ...p, line(`S${'1'.padStart(7)}G${'1'.padStart(7)}D${String(d.length).padStart(7)}P${String(p.length).padStart(7)}`, 'T', 1));
  return out.join('\n') + '\n';
}

const meshes = (g: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
  return out;
};

describe('parsing', () => {
  it('splits parameters with Hollerith strings and D exponents', () => {
    expect(splitParams('110,1.5D2,3H,;x,,-2;', ',', ';')).toEqual([110, 150, ',;x', '', -2]);
  });

  it('reads the global section and directory entries', () => {
    const doc = parseIges(iges([{ type: 110, params: [0, 0, 0, 10, 0, 0], color: 2, level: 5 }]));
    expect(doc.global.fileName).toBe('test.igs');
    expect(doc.global.unitsFlag).toBe(2);
    const line = doc.entities.get(1)!;
    expect(line).toMatchObject({ type: 110, color: 2, level: 5, params: [0, 0, 0, 10, 0, 0] });
  });

  it('refuses files that are not IGES', () => {
    expect(() => parseIges('hello\nworld\n')).toThrow(IgesError);
  });
});

describe('geometry', () => {
  it('draws free curves by level and colour, in metres and Y up', () => {
    const r = loadIges(iges([
      { type: 110, params: [0, 0, 0, 1000, 0, 0], color: 2, level: 1 },
      { type: 100, params: [0, 500, 0, 510, 0, 510, 0], level: 2 },
    ]));
    expect(r.unitScale).toBe(0.001);
    expect(r.stats.curves).toBe(2);
    expect(r.group.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(r.group.children[0]!.children.map((c) => c.name)).toEqual(['Level 1', 'Level 2']);
    const size = new THREE.Box3().setFromObject(r.group).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1);
  });

  it('tessellates an untrimmed NURBS surface', () => {
    // A bilinear patch of 10 x 10 units: degree 1 in both directions, 2 x 2 control points.
    const params = [1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0, 0, 1, 0, 1];
    const r = loadIges(iges([{ type: 128, params }]));
    expect(r.stats.faces).toBe(1);
    let area = 0;
    for (const m of meshes(r.group)) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 3) area += new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(p, i), new THREE.Vector3().fromBufferAttribute(p, i + 1), new THREE.Vector3().fromBufferAttribute(p, i + 2)).getArea();
    }
    expect(area).toBeCloseTo(100, 3);
  });

  it('trims a surface with a hole given by parameter curves', () => {
    const surface = [1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 0, 0, 1, 0, 1];
    // The hole: a square in parameter space from 0.25 to 0.75, as a closed copious data polyline.
    const hole = [2, 5, 0.25, 0.25, 0, 0.75, 0.25, 0, 0.75, 0.75, 0, 0.25, 0.75, 0, 0.25, 0.25, 0];
    const r = loadIges(iges([
      { type: 128, params: surface, status: '00010000' },
      { type: 106, params: hole, status: '00050000', form: 12 },
      { type: 142, params: [0, 1, 3, 0, 1], status: '00010000' },
      { type: 144, params: [1, 0, 1, 0, 5] },
    ]));
    expect(r.stats.faces).toBe(1);
    let area = 0;
    for (const m of meshes(r.group)) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 3) area += new THREE.Triangle(new THREE.Vector3().fromBufferAttribute(p, i), new THREE.Vector3().fromBufferAttribute(p, i + 1), new THREE.Vector3().fromBufferAttribute(p, i + 2)).getArea();
    }
    expect(area).toBeCloseTo(100 - 25, 3);
  });
});

describe('SolidWorks parts', () => {
  const parts: [string, number, number][] = [
    ['ROB-12344.IGS', 4, 0.0254],
    ['ROB-12101.IGS', 6, 0.0254],
    ['8449.IGS', 19, 0.001],
    ['11015.IGS', 25, 0.001],
    ['10213.IGS', 37, 0.001],
    ['9570.IGS', 47, 0.0254],
  ];
  for (const [name, faces, scale] of parts) {
    it(`tessellates every face of ${name}`, () => {
      const r = loadIges(sample(name).data);
      expect(r.global.nativeSystem).toBe('SolidWorks 2014');
      expect(r.unitScale).toBe(scale);
      expect(r.stats.faces).toBe(faces);
      expect(r.stats.failedFaces).toBe(0);
      for (const m of meshes(r.group)) expect(Array.from(m.geometry.getAttribute('position').array as Float32Array).every(Number.isFinite)).toBe(true);
    });
  }

  it('colours faces from colour definitions', () => {
    const colors = new Set(meshes(loadIges(sample('10213.IGS').data).group).map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString()));
    expect(colors.size).toBeGreaterThan(1);
  });
});
