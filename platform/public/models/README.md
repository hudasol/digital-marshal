# 3D asset kit

The GLB files here come from the **Encirra asset kit** (`assets/models` in the Encirra repository by
Team Kanban). They are original models generated procedurally by that project's own Blender scripts;
no third-party models, textures or HDRIs are used. `manifest.json` is a trimmed copy of the kit's
manifest that lists only the files Digital Marshal uses.

Conventions the renderer relies on (from the kit's documentation):

* Metres, +Y up, fronts face +Z, origins at the centre of the footprint on the ground.
* Glazing UVs encode the window grid: u = facade bay, v = storey. glTF stores v flipped, so the
  storey index is `1 - uv.y` (see `src/render/kit/batch.ts`).
* Vertex colours carry baked ambient occlusion; meshes are `EXT_meshopt_compression` compressed.
* Skyline nodes carry a suggested placement in their node transform, which the renderer ignores.

Used by `src/render/kit/kit.ts` (loading), `src/render/kit/batch.ts` (static batching) and
`src/render/city/*` (placement). If the files are missing or fail to load, the city falls back to
plain massing boxes.
