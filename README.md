# mc-iges-import

An IGES importer for [three.js](https://threejs.org/), written in TypeScript. It reads IGES CAD files (to IGES 5.3) and tessellates their trimmed NURBS and analytic surfaces and B-rep solids, with free curves, colours, levels and units, in metres and Y up. It builds on the MeerCAD geometry libraries [mc-curves](https://github.com/VJigouline/mc-curves), [mc-surfaces](https://github.com/VJigouline/mc-surfaces) and [mc-solids](https://github.com/VJigouline/mc-solids). It was made for [SceneEditor](https://github.com/VJigouline/SceneEditor), and works in any three.js application.

```ts
import { loadIges } from 'mc-iges-import';

const result = loadIges(await file.arrayBuffer());
scene.add(result.group);
console.log(result.warnings);       // anything that couldn't be read
```

## What it reads

- Trimmed surfaces (144) and bounded surfaces (143), with their outer boundaries and holes.
- Manifold solid B-reps (186) with their shells, faces, loops and edges (514, 510, 508, 504, 502).
- Surfaces: rational B-spline (128), revolution (120), tabulated cylinder (122), ruled (118), planes (108, 190), and the analytic cylinder, cone, sphere and torus (192 to 198).
- Curves: lines (110), arcs (100), conic arcs (104), copious data (106), parametric splines (112), rational B-splines (126), composites (102), and curves on surfaces (142).
- Transformation matrices (124), nested, and subfigure instances (308, 408).
- Colours (standard numbers and 314 definitions), levels as groups, blanked and subordinate status, and the units of the global section.

Annotations, dimensions, offset curves and surfaces (130, 140) and parametric spline surfaces (114) are not read; each type left out gets a warning. Compressed and binary IGES files are refused. Faces of neighbouring surfaces are tessellated separately, so small gaps can show along shared edges. See [Formats and support](Documentation/Support.md) for the details.

## Install

The package is not on the npm registry. Install it from GitHub:

```sh
npm install github:VJigouline/mc-iges-import
```

`three` (r160 or later) is a peer dependency. The package builds itself on install.

## Documentation

- [Getting started](Documentation/GettingStarted.md)
- [API](Documentation/API.md)
- [Formats and support](Documentation/Support.md)
- [Using it in SceneEditor](Documentation/SceneEditor.md)

## Development

```sh
npm install
npm test           # unit tests, with Vitest
npm run typecheck
npm run build      # dist/
```

The tests load real IGES files, kept in [`tests/samples`](tests/samples/README.md) with their licences. It needs Node.js 22 or later.

## Licence

[MIT](LICENSE)
