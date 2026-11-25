// Reads the sections of an IGES file (ANSI Y14.26M, IGES 5.3): the global parameters, and the
// directory entry and parameter data of each entity. Lines are 80 columns; column 73 names the
// section (S, G, D, P, T) and columns 74 to 80 hold the line's sequence number.

export class IgesError extends Error {
  override name = 'IgesError';
}

export type IgesValue = number | string;

export interface IgesEntity {
  /** Directory entry sequence number (odd), which other entities point to. */
  de: number;
  type: number;
  form: number;
  /** Parameters after the entity type, in order: numbers, strings and pointers (positive DE numbers). */
  params: IgesValue[];
  /** DE of a 124 transformation matrix, or 0. */
  transform: number;
  /** Colour number 1 to 8, or a negative pointer to a 314 colour definition; 0 for none. */
  color: number;
  /** Level (layer) number, or a negative pointer to a 406 definition levels property. */
  level: number;
  lineFont: number;
  /** Status digits: blank (0 visible, 1 blanked), subordinate (0 independent, 1 physically dependent, 2 logically, 3 both), use (0 geometry...), hierarchy. */
  status: { blank: number; subordinate: number; use: number; hierarchy: number };
  /** The entity label, columns 57 to 64 of the second directory line. */
  label: string;
  subscript: number;
}

export interface IgesGlobal {
  parameterDelimiter: string;
  recordDelimiter: string;
  sendingProductId: string;
  fileName: string;
  nativeSystem: string;
  preprocessorVersion: string;
  receivingProductId: string;
  modelScale: number;
  /** Units flag: 1 inch, 2 mm, 3 named in unitsName, 4 foot, 5 mile, 6 metre, 7 km, 8 mil, 9 micron, 10 cm, 11 microinch. */
  unitsFlag: number;
  unitsName: string;
  date: string;
  resolution: number;
  author: string;
  organization: string;
  /** IGES version flag: 11 is 5.3. */
  version: number;
  draftingStandard: number;
}

export interface IgesDocument {
  start: string;
  global: IgesGlobal;
  entities: Map<number, IgesEntity>;
}

/** Metres per unit for each units flag. */
export const IGES_UNITS: Record<number, number> = { 1: 0.0254, 2: 0.001, 4: 0.3048, 5: 1609.344, 6: 1, 7: 1000, 8: 2.54e-5, 9: 1e-6, 10: 0.01, 11: 2.54e-8 };

/** Splits free-format parameter text into values, with Hollerith strings (nH...) kept whole. */
export function splitParams(text: string, delimiter: string, record: string): IgesValue[] {
  const out: IgesValue[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    // Skip spaces before a value.
    while (i < n && text[i] === ' ') i++;
    if (i >= n) break;
    if (text[i] === delimiter) {
      out.push('');
      i++;
      continue;
    }
    if (text[i] === record) break;
    // Hollerith string: digits, then H, then that many characters.
    const m = /^(\d+)H/i.exec(text.slice(i, i + 12));
    if (m) {
      const len = Number(m[1]);
      const start = i + m[0].length;
      out.push(text.slice(start, start + len));
      i = start + len;
    } else {
      let j = i;
      while (j < n && text[j] !== delimiter && text[j] !== record) j++;
      const raw = text.slice(i, j).trim();
      const num = Number(raw.replace(/[dD]/, 'E'));
      out.push(raw === '' ? '' : Number.isFinite(num) ? num : raw);
      i = j;
    }
    while (i < n && text[i] === ' ') i++;
    if (i < n && text[i] === record) break;
    if (i < n && text[i] === delimiter) i++;
  }
  return out;
}

/** Parses an IGES file's text. */
export function parseIges(text: string): IgesDocument {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  const sections: Record<string, string[]> = { S: [], G: [], D: [], P: [], T: [] };
  for (const line of lines) {
    const padded = line.padEnd(80);
    const code = padded[72]!;
    if (code === 'C' || code === 'B') throw new IgesError('Compressed and binary IGES files are not supported');
    if (!(code in sections)) {
      if (sections.S.length === 0 && sections.G.length === 0) throw new IgesError('Not an IGES file: column 73 of the first line is not a section letter');
      continue;
    }
    sections[code]!.push(padded);
  }
  if (!sections.G.length || !sections.D.length) throw new IgesError('Not an IGES file: it has no global or directory section');

  // Global section: the first two parameters may change the delimiters.
  const g = sections.G.map((l) => l.slice(0, 72)).join('');
  let delimiter = ',';
  let record = ';';
  const first = /^\s*1H(.)/.exec(g);
  if (first) delimiter = first[1]!;
  const second = new RegExp(`^\\s*(?:1H.|)\\s*\\${delimiter}\\s*1H(.)`).exec(g);
  if (second) record = second[1]!;
  const gp = splitParams(g, delimiter, record);
  const str = (i: number) => (typeof gp[i] === 'string' ? (gp[i] as string) : String(gp[i] ?? ''));
  const nums = (i: number, d: number) => (typeof gp[i] === 'number' ? (gp[i] as number) : d);
  const global: IgesGlobal = {
    parameterDelimiter: delimiter,
    recordDelimiter: record,
    sendingProductId: str(2),
    fileName: str(3),
    nativeSystem: str(4),
    preprocessorVersion: str(5),
    receivingProductId: str(11),
    modelScale: nums(12, 1) || 1,
    unitsFlag: nums(13, 1),
    unitsName: str(14),
    date: str(17),
    resolution: nums(18, 0),
    author: str(20),
    organization: str(21),
    version: nums(22, 0),
    draftingStandard: nums(23, 0),
  };

  // Directory entries: two lines each, ten fields of eight columns.
  const entities = new Map<number, IgesEntity>();
  const field = (l: string, k: number) => l.slice(k * 8, k * 8 + 8).trim();
  const int = (s: string) => {
    const v = parseInt(s, 10);
    return Number.isFinite(v) ? v : 0;
  };
  const pLines = sections.P;
  for (let i = 0; i + 1 < sections.D.length; i += 2) {
    const a = sections.D[i]!;
    const b = sections.D[i + 1]!;
    const de = int(a.slice(73, 80)) || i + 1;
    const type = int(field(a, 0));
    const pd = int(field(a, 1));
    const count = int(field(b, 3));
    const status = field(a, 8).padStart(8, '0');
    // Parameter data: columns 1 to 64 of its lines, after the entity type.
    const raw = pLines.slice(Math.max(0, pd - 1), Math.max(0, pd - 1) + Math.max(1, count)).map((l) => l.slice(0, 64)).join('');
    const values = splitParams(raw, delimiter, record);
    entities.set(de, {
      de,
      type,
      form: int(field(b, 4)),
      params: values.slice(1),
      transform: int(field(a, 6)),
      color: int(field(b, 2)),
      level: int(field(a, 4)),
      lineFont: int(field(a, 3)),
      status: { blank: int(status.slice(0, 2)), subordinate: int(status.slice(2, 4)), use: int(status.slice(4, 6)), hierarchy: int(status.slice(6, 8)) },
      label: b.slice(56, 64).trim(),
      subscript: int(field(b, 8)),
    });
  }
  return { start: sections.S.map((l) => l.slice(0, 72).trimEnd()).join('\n').trim(), global, entities };
}
