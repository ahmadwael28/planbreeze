# Planbreeze: notes for Claude

## Surface takeoff: keep it complete

`src/model/takeoff.ts` measures every room's finished surfaces for buying materials:
- floors, less what's built on them;
- walls up to the ceiling, less openings, plus columns, niches, reveals and boxes;
- ceilings, with gypsum levels, bulkhead sides, coves, pockets, gaps, boxes and beams;
- stair openings (`stairOpenings`: stairs that reach the floor above), off the ceiling below and the floor above, with the gypsum faces round them; `takeoff(floor, below, above)` needs the floors round it;
- stone (place `'stone'`): worktops, vanity and bench tops, niche sills, and the shelves on toilet boxes and half walls. Each piece is counted in its stone (a `WORKTOPS` id, or `SHELF_STONE`), with its front-edge length.

The Summary panel and each room's "Surfaces to finish" are built from it. It measures what the 3D view builds, from the same model helpers: `builtBox` and `halfWallBoxes` in `model/built.ts`, the `ceilingZones`/`bandEdge` functions in `model/lighting.ts`, and `wallBands`. When a 3D shape changes, the takeoff follows it.

**When you add or change anything that changes a surface, update the takeoff in the same change.** This covers anything built, clad in a finish, cut into a wall, standing on the floor or hanging from the ceiling:
- **A new library item** (a `type` in `SYMBOLS`): give it a rule in `RULES`, or list it in `UNTOUCHED` if it does nothing to the surfaces (plain furniture, lights). In development the app logs `takeoff: no rule for …` for any kind in neither.
  - Reuse the existing rules where they fit: `built`, `standing`, `reveals`, `niche`, `hanging`.
  - Something built against a wall and finished like it should go through `builtBox`, so the 3D view clads it and the takeoff counts it from one box.
- **A new ceiling style:** `CEILING_SIDES` is a `Record<CeilingStyle, …>`, so TypeScript asks for its upright faces. Check `ceilingParts` for its levels and the slab that shows.
- **A new room or wall feature** (like shadow gaps, curtain pockets or hidden-light gaps): check `wallTop` (how high walls show), `roomParts` and `ceilingParts`.
- **New item options that change its size or faces** (a style, a mount, a box height): handle them in its rule. Anything new made of stone gets a `stone(…)` part.

Test against hand-worked numbers in `src/model/takeoff.test.ts`, with `takeoff()` on a synthetic floor. A plain 300×200 cm room with 250 cm walls gives 6 m² of floor and ceiling and 25 m² of walls. A new rule or surface gets a case there, worked out by hand rather than copied from what the code gives. The same file fails when a library kind has neither a rule nor a place in `UNTOUCHED`.

## Properties panel: an inspector

Everything's properties are shown as an `Inspector` with `Panel`s (`src/components/Inspector.tsx`). The header holds the name, quick actions and a search through every setting. Each panel folds to a one-line `summary` of its values and remembers open or closed by its `id`.
- **Keep the same order for every item:** Size, then the item's own panels (e.g. `vanity-basin`, `shower-glass`), Options, Style and finish (`look`), Light (`light`), Position (`place`).
- **A new setting** goes in the panel it belongs to; a new group of settings gets its own panel. Either way, its current value goes into that panel's summary. Don't add loose sections.
- **Reuse panel ids across items** (`size`, `look`, `light`, `place`, `options`), so an open or closed panel stays that way from one item to the next.

## Lengths and room shapes

- **Typed lengths** go through `parseLength(text, units, near)` (`src/model/units.ts`). It reads Arabic digits and units. A plain number is metres or centimetres, whichever is nearer `near`: the field's current value, or the length being drawn. A new length field uses `LengthInput` (which shows how the text reads as it's typed), not a number input.
- **A room's walls can't cross.** `commit` refuses a change that reshapes a room so its walls cross (`crossesItself`), and `healDrag` takes such a drag back. New rooms are checked where they're made: drawing (`finishPolygon`), dividing (`dividePoints`), importing. Check any new way of making rooms the same way.

## Plans in storage: never lose one

Plans live in localStorage through `src/store/storage.ts`; backups are in `src/store/backup.ts`.
- **Deleting a plan** goes through `trashProject` (kept in Recently deleted for 30 days), never by removing `fp.project.*` keys. `deleteProject` is only for leaving someone else's shared plan.
- **Storing a plan that isn't opened** (restoring, importing many) uses `storeProject`. **Opening a plan** goes through `useEditor.getState().loadProject`, which lets a plan deleted earlier in the session be saved again, and brings it up to date (`upgrade`).
- **Changing what's saved** (a field renamed or moved, a style that's become an option, items that now sit elsewhere) means older plans need a step. Add it to `STEPS` in `src/model/migrate.ts`, raise `SCHEMA_VERSION` in `model/project.ts` by one, and test it in `migrate.test.ts` with a plan as the older version saved it. Each step runs once per plan, whichever way the plan is opened. Don't add fix-ups to `loadProject` itself.
- **Writes that can fill the browser** go through `writeRoomy`. It drops the longest-deleted plans only when that's enough to make room, and puts them all back otherwise.
- **Parts of the UI** sit inside an `ErrorBoundary` (`src/components/ErrorBoundary.tsx`): the plan, the 3D view and the panel, each with a way on. Every dialog is wrapped in a `DialogGuard` in `App.tsx`. A new dialog gets one too.

## Tests and checks: nothing deploys without them

`npm test` runs the Vitest tests (`src/**/*.test.ts`, in Node). They cover the takeoff, lengths, plan upgrades, dividing and healing rooms through the editor, and the Arabic. Before every deploy, `.github/workflows/checks.yml` runs `npm run lint`, `npm run typecheck` and `npm test`; `deploy.yml` builds only once they pass, and pull requests run the same checks. Run all three before committing.
- **Model code stays testable in Node:** no `window`, `document` or `localStorage` when a module loads, only inside functions, and guarded.
- **The Arabic test** (`src/i18n/i18n.test.ts`) finds every string in a `t()` call. Names in the app's own lists that are shown through `t()` where they're used are found by the patterns in its `LISTS`; a new list of names like that gets a pattern there. Arabic must keep the English's `{names}`.

## Repo habits

- **Line endings are mixed (LF and CRLF).** Python's text-mode writes on Windows turn LF into CRLF, so edit with the Edit tool or write in binary. Don't run Prettier: the code isn't Prettier-formatted.
- **Every string shown through `t()` needs Arabic**, in `src/i18n/ar/*.ts`. `npm test` lists any that are missing.
