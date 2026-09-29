# Planbreeze

Get a floor plan in minutes: import a sketch or photo, start from a template, or draw it yourself. Then furnish it and see it in 3D.

**Live app:** https://ahmadwael28.github.io/planbreeze/

Built with React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui (Radix), zustand + immer, and three.js.

## Features

**Quick start**
- Start screen: import a drawing, pick a furnished template (studio, 1-bed, 2-bed, family house), or start blank
- Import a photo, scan or hand sketch of a plan:
  - **Detect** (on-device, nothing uploaded): finds rooms and doorways and straightens walls; set the scale by dragging a line along a wall of known length
  - **AI** (optional, your own Anthropic API key): Claude reads handwritten room names and dimensions and places doors and windows, so sketches that aren't to scale come out right
  - **Trace**: puts the drawing behind the plan at the right scale so you can draw over it
- Empty floors show a prompt with the quickest next steps

**Lighting design**
- Plan / Lighting layers: the lighting layer is a ceiling plan with furniture faded
- Gypsum ceilings per room: flat drop, tray (bulkhead), cove with hidden LED, floating panel, double step, plus free gypsum boxes
- Fixtures: recessed spots, LED profiles, magnetic tracks with spot / linear / grille modules, cove & hidden LED strips, pendants, linear pendants, chandeliers, ceiling and wall lights
- Switches wired to lights with the wiring tool (`W`); each switch's wires get their own color
- 3D: real lights you can switch on and off (panel or click a wall switch), warm / white / cool color, day-to-night slider, walk-inside eye-level view with ceilings

**Drawings**
- Dimension lines (`D`) that snap to wall corners, plus automatic overall dimensions
- Print to scale: vector PDF at 1:N (or fit to page) on A4 / A3 / A2 / Letter / Tabloid, with title block and scale bar; floor plan or lighting plan, one page per floor

**Accounts & autosave**
- Every change is saved automatically in the browser; a status in the top bar shows the save state
- Optional sign-in with Google, GitHub or an email link (Supabase): plans then also autosave to the
  cloud and open on any device; changes made offline upload when you reconnect
- Edits made to the same plan on two devices are detected and you choose which version to keep
- Setup: see [docs/cloud-setup.md](docs/cloud-setup.md). Without it, the app runs offline-only.

**Editing**
- Rooms as polygons or rectangles with real wall thickness; edit corners and walls by dragging or by typing exact lengths
- Type a length while drawing (`3.5` + Enter) for precise walls; snapping to grid, 45° angles and other rooms
- Doors and windows that snap into walls and follow them when rooms change
- Symbol library: furniture, kitchen, bathroom, electrical, stairs, labels
- Multiple floors, with the floor below shown faintly while editing
- 3D view with openings cut into walls, floor stacking, orbit camera and click-to-select
- Automatic room, wall and level areas, perimeters and symbol counts
- Metric and imperial units
- Undo/redo, autosave to the browser, projects list
- Export to PNG, SVG and a JSON project file
- Light, dark and system themes

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. The dev server also listens on your local network; Vite prints the
`Network:` address to use from other devices (for example `http://192.168.1.17:5173`).

Production build:

```bash
npm run build
npm run preview
```

The preview server runs on port 4173 and is also reachable from the local network.

## Deploy

Every push to `main` builds the app and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). The build uses relative asset paths (`base: './'` in
`vite.config.ts`), so it works from the `/planbreeze/` sub-path or any other host.

Projects are stored in each visitor's browser (localStorage); nothing is sent to a server.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` / `P` / `R` / `H` | Select / draw room / rectangle room / pan |
| `D` | Dimension line |
| `W` | Connect switches to lights |
| `Ctrl+Z`, `Ctrl+Y` | Undo, redo |
| `Del` | Delete selection |
| `Ctrl+D` | Duplicate selection |
| `E` | Rotate selected symbol 90° |
| Arrows (+`Shift`) | Nudge selection 1 cm (10 cm) |
| `F`, `+`, `-` | Zoom to fit, zoom in, zoom out |
