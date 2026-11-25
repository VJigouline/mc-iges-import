# Formats and support

mc-iges-import reads IGES with its own IGES reader, with mc-curves, mc-surfaces and mc-solids for the geometry.

## What is read

- Trimmed surfaces (144) and bounded surfaces (143), with their outer boundaries and holes.
- Manifold solid B-reps (186) with their shells, faces, loops and edges (514, 510, 508, 504, 502).
- Surfaces: rational B-spline (128), revolution (120), tabulated cylinder (122), ruled (118), planes (108, 190), and the analytic cylinder, cone, sphere and torus (192 to 198).
- Curves: lines (110), arcs (100), conic arcs (104), copious data (106), parametric splines (112), rational B-splines (126), composites (102), and curves on surfaces (142).
- Transformation matrices (124), nested, and subfigure instances (308, 408).
- Colours (standard numbers and 314 definitions), levels as groups, blanked and subordinate status, and the units of the global section.

## Orientation and units

IGES models are Z up; the group turns them Y up and scales them to metres by the global section's units.

## Limits

Annotations, dimensions, offset curves and surfaces (130, 140) and parametric spline surfaces (114) are not read; each type left out gets a warning. Compressed and binary IGES files are refused. Faces of neighbouring surfaces are tessellated separately, so small gaps can show along shared edges.
