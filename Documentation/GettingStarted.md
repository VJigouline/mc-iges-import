# Getting started

## Install

```sh
npm install three github:VJigouline/mc-iges-import
```

## Open a file

`loadIges` takes the file's text or bytes, as a string, `ArrayBuffer` or `Uint8Array`. It returns the model at once.

```ts
import * as THREE from 'three';
import { loadIges } from 'mc-iges-import';

const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
input.addEventListener('change', async () => {
  const result = loadIges(await input.files![0]!.arrayBuffer());
  scene.add(result.group);
  for (const warning of result.warnings) console.warn(warning);
});
```

## What you get

- **`group`:** a `THREE.Group` holding the model, named after the file.
- **`stats`:** counts of what was read.
- **`warnings`:** anything that couldn't be read or was left out.

IGES models are Z up; the group turns them Y up and scales them to metres by the global section's units.

## Options

- **`chordTolerance`** (default 1/2000 of the model size): Largest distance between a surface and its triangles, in model units.
- **`unitScale`** (default from the file): Metres per model unit.
- **`curves`** (default true): Draws curves that belong to no surface.
- **`blanked`** (default false): Adds blanked (hidden) entities, hidden.

See the [API](API.md) for every field of the result.
