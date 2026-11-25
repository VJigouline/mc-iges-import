# API

## `loadIges(input, options?)`

Reads `.igs` or `.iges` and returns a `IgesLoadResult`.

`input` is the file's text or bytes, as a string, `ArrayBuffer` or `Uint8Array`.

It throws `IgesError` for input that isn't IGES (other errors in the file become warnings).

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `chordTolerance` | 1/2000 of the model size | Largest distance between a surface and its triangles, in model units. |
| `unitScale` | from the file | Metres per model unit. |
| `curves` | true | Draws curves that belong to no surface. |
| `blanked` | false | Adds blanked (hidden) entities, hidden. |

### `IgesLoadResult`

| Field | Type | Meaning |
| --- | --- | --- |
| `group` | `THREE.Group` | The model. |
| `global` | `IgesGlobal` | The global section: sending system, file name, units, author and so on. |
| `unitScale` | `number` | Metres per model unit. |
| `warnings` | `string[]` | Problems that didn't stop the import. |
| `stats` | object | Counts of meshes, triangles and the like. |

See the package's `index.d.ts` for every exported type and helper.
