# Planbreeze: notes for Claude

## Surface takeoff: keep it complete

`src/model/takeoff.ts` measures every room's finished surfaces for buying materials:
- floors, less what's built on them;
- walls up to the ceiling, less openings, plus columns, niches, reveals and boxes;
- ceilings, with gypsum levels, bulkhead sides, coves, pockets, gaps, boxes and beams;
- stone (place `'stone'`): worktops, vanity and bench tops, niche sills, and the shelves on toilet boxes and half walls. Each piece is counted in its stone (a `WORKTOPS` id, or `SHELF_STONE`), with its front-edge length.

The Summary panel and each room's "Surfaces to finish" are built from it. It measures what the 3D view builds, from the same model helpers: `builtBox` and `halfWallBoxes` in `model/built.ts`, the `ceilingZones`/`bandEdge` functions in `model/lighting.ts`, and `wallBands`. When a 3D shape changes, the takeoff follows it.

**When you add or change anything that changes a surface, update the takeoff in the same change.** This covers anything built, clad in a finish, cut into a wall, standing on the floor or hanging from the ceiling:
- **A new library item** (a `type` in `SYMBOLS`): give it a rule in `RULES`, or list it in `UNTOUCHED` if it does nothing to the surfaces (plain furniture, lights). In development the app logs `takeoff: no rule for …` for any kind in neither.
  - Reuse the existing rules where they fit: `built`, `standing`, `reveals`, `niche`, `hanging`.
  - Something built against a wall and finished like it should go through `builtBox`, so the 3D view clads it and the takeoff counts it from one box.
- **A new ceiling style:** `CEILING_SIDES` is a `Record<CeilingStyle, …>`, so TypeScript asks for its upright faces. Check `ceilingParts` for its levels and the slab that shows.
- **A new room or wall feature** (like shadow gaps, curtain pockets or hidden-light gaps): check `wallTop` (how high walls show), `roomParts` and `ceilingParts`.
- **New item options that change its size or faces** (a style, a mount, a box height): handle them in its rule. Anything new made of stone gets a `stone(…)` part.

Test against hand-worked numbers, by importing `/src/model/takeoff.ts` in the browser and running `takeoff()` on a synthetic one-room floor. A plain 300×200 cm room with 250 cm walls gives 6 m² of floor and ceiling and 25 m² of walls.

## Properties panel: an inspector

Everything's properties are shown as an `Inspector` with `Panel`s (`src/components/Inspector.tsx`). The header holds the name, quick actions and a search through every setting. Each panel folds to a one-line `summary` of its values and remembers open or closed by its `id`.
- **Keep the same order for every item:** Size, then the item's own panels (e.g. `vanity-basin`, `shower-glass`), Options, Style and finish (`look`), Light (`light`), Position (`place`).
- **A new setting** goes in the panel it belongs to; a new group of settings gets its own panel. Either way, its current value goes into that panel's summary. Don't add loose sections.
- **Reuse panel ids across items** (`size`, `look`, `light`, `place`, `options`), so an open or closed panel stays that way from one item to the next.

## Repo habits

- **Line endings are mixed (LF and CRLF).** Python's text-mode writes on Windows turn LF into CRLF, so edit with the Edit tool or write in binary. Don't run Prettier: the code isn't Prettier-formatted.
- **Every string shown through `t()` needs Arabic**, in `src/i18n/ar/*.ts`.
