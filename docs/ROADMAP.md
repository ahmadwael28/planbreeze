# Planbreeze: what's missing, and the plan to a complete app

As of 31 Oct 2026 (`main` at `b97b360`).

**How this was made**
- Four readers mapped the code area by area: drawing, library, 3D and platform.
- Two researchers surveyed about 40 competitors, consumer and professional (sources at the end).
- A strategist wrote the gap analysis and a critic checked it.
- The critic's corrections are merged in, and the riskiest claims about the code were checked by hand.

**Legend**
- **Effort** (one developer working with Claude): S is up to a week, M is 1-3 weeks, L is 3-8 weeks, XL is more than 2 months.
- **Type:** TS = table-stakes (users expect it), D = differentiator, N = nice-to-have.

---

## 1. Where Planbreeze stands

### What it already does better than most

| Strength | What exists | Against the market |
|---|---|---|
| **Ceilings and lighting, wired** | 5 gypsum ceiling styles with bands per wall; coves, shadow gaps, curtain pockets, hidden-light gaps and beams. Spots, tracks, profiles, pendants and chandeliers. Switches wired to lights, colour temperature per switch, a ceiling-plan layer and a lighting PDF. | Consumer apps have light objects but no gypsum ceilings or wiring. Wiring and circuits come from Chief Architect ($1,995/yr). |
| **Surface takeoff** | Floors, walls and ceilings measured net of what's built, cut in or hung. Stone with edge lengths. Tiles, paint, wallpaper, boards and skirting to buy. | Few consumer apps measure finished surfaces. magicplan sells quantities at $89.99/mo, and Houzz Pro in its $199/mo tier. RoomSketcher, Cedreo and Foyr have no takeoff. |
| **Tile layout at true scale** | Herringbone, chevron and diagonal; where the cuts fall; mixed tiles; tiles up to a height with paint above; tile counts. | Competitors swap materials but don't lay out cuts or count tiles. |
| **Bathroom and kitchen detail that suits regional fit-outs** | Vanities, showers with half walls and glass, wall-hung toilet boxes, niches with stone sills, continuous worktops in 13 stones, I/L/U kitchens. | Only catalogue-driven pro tools go deeper, and only on cabinets. |
| **Arabic, right to left, throughout** | Full translation and right-to-left layout, a bundled Arabic font, room uses guessed from Arabic names. | Some competitors may translate their interface, but none is built around Arabic finishing work. A translation is easy to copy; regional content and channels are not. |
| **Realistic render on the device** | Path tracing up to 4K with depth of field and a custom denoiser, with no server or AI. | Competitors meter renders: Floorplanner $1.63 per 4K credit, RoomSketcher $4 a render on Free, Cedreo cut free renders to 0 in Jun 2026. Sweet Home 3D and Live Home 3D also render on the device, but they are desktop apps; Planbreeze does it in the browser. |
| **Plan detection on the device** | Printed plans and sketches, scale line, eraser, optional AI. | RoomSketcher gives 1 free AI conversion, then $20 a floor. |
| **Full editing on a phone** | Bottom bar, selection bar, touch stick and sheets. | RoomSketcher doesn't edit on phones; Floorplanner is desktop-first. |
| **Free design suggestions** | 15 room uses and 5 styles: furniture, kitchens, ceilings, wired lights, AC and curtains. | Coohom and Homestyler charge AI credits for the same. |
| **Open-plan spaces** | Divide, join, open and close walls; one ceiling across open rooms. | Uncommon. |
| **No account needed** | Plans save locally; cloud sync is optional. It keeps working offline in an open tab, but a reload offline fails because there's no service worker yet. | Most web leaders need a connection. |

### Who to win first

**Primary segment:** Arabic-speaking homeowners finishing or renovating an apartment, and the small businesses that serve them: gypsum and lighting installers, tilers, finishing contractors and independent interior designers. Start in Egypt and the GCC.

**Why this segment fits:**
- **The app already does their job.** Apartments there get gypsum ceilings, spots and cove LEDs, porcelain or marble and split AC, and owners need a list of what to buy.
- **They work in Arabic, on Android phones.** The incumbents are English-first and desktop-first.
- **Free renders and suggestions cost nothing to serve,** so Planbreeze can give away what others charge for.
- **The quoting chain is unfinished across the market.** Plan → quantities → prices → branded quote → client approval is the gap plan-first tools leave open.

**Positioning lines**
- Homeowner: "Plan, light and measure your home's finishing, in Arabic, on your phone. Free."
- Contractor: "Turn a site visit into a lighting plan, a quantity list and a priced quote your client approves."

**Not now:** real-estate marketing plans (scanning wins there), shoppable retail catalogues, insurance and restoration, BIM, and new-build exteriors.

**Check before building quotes:**
- Interview 10-15 finishing contractors and gypsum installers about how they quote today: WhatsApp photos, paper or Excel.
- Look at the local incumbents: Arabic finishing and quantity calculators on Google Play, and the online estimators of Egyptian finishing companies.

---

## 2. Missing features (not built at all)

### 2.1 Drawing and modelling

| Feature | Why | Type | Effort |
|---|---|---|---|
| Typed width × height while dragging a rectangle; length at an angle; a live angle readout; a corner-angle field | Drawing from tape measurements (Floor Plan Creator is built on typed input) | TS | S |
| Snapping to wall edges, midpoints, intersections, perpendiculars and the floor below; settable grid and angle step | Accurate redraws (Floorplanner, Sweet Home 3D, Chief) | TS | M |
| A temporary tape measure, and an area and perimeter measure, that leave nothing on the plan | On a phone, "Measure" leaves permanent dimension lines today | TS | S |
| Dimensions tied to walls; horizontal and vertical modes; automatic dimension chains per room and per opening | Contractors print dimensioned plans | TS | M-L |
| Annotations: multi-line text, size and colour, leaders, north arrow, legend | Printed plans | TS | M |
| More doors and windows: pocket, bi-fold, French, front and security, garage, casement, fixed, corner, bay, skylights, arches | In every competitor's library | TS | M |
| User layers with hide and lock; locking items; draw order | Pros working over an underlay | TS for pros | M |
| Align by edges, mirror a selection or a room, nested groups (line up, space evenly and centre already exist in `model/arrange.ts`) | Standard editor behaviour | TS | S |
| System clipboard, paste in place, Alt-drag to copy, array copy (rows of spots) | Speed; arrays suit lighting layouts | N | S |
| Save a room, a kitchen run or a whole plan as a template ("my blocks") | Floor Plan Creator, Floorplanner, Homestyler | TS | M |
| Shared walls with thickness per wall and proper joints (a wall graph) | Every wall-first tool; fixes gaps and overlaps between rooms | TS for pros | XL+ |
| Curved walls | Homestyler, Sweet Home 3D, RoomSketcher | N (D for villas) | L, after the wall graph |
| Ceiling height per room, sloped and vaulted ceilings, roofs | Villas and top floors | D for villas | L-XL |
| L, U and spiral stairs with landings; floor reordering, basements, floor levels and slab thickness | Multi-floor homes | TS for villas | L |

### 2.2 Getting a plan in

| Feature | Why | Type | Effort |
|---|---|---|---|
| **PDF plan import** (pdf.js page to image, then the existing detection and underlay) | Developers and architects send PDFs; Planner 5D, Cedreo, Homestyler and Chief accept them | TS | M |
| AI import through a server, with credits, instead of the user's own API key | Ordinary users won't paste API keys | TS | M |
| Reading room names on the device (Arabic and English) | Detection finds rooms but not their names | D | M |
| Bluetooth laser meter (Web Bluetooth, Chrome on Android) | Contractors on site (magicplan, Floor Plan Creator). Each brand's protocol needs registration and hardware to test. | D | M per brand |
| Room capture on Android (WebXR: tap the corners) | Planner 5D Home Scan; an Android-friendly alternative to a native LiDAR app | D | M spike |
| Site-visit photos and notes pinned to the plan | magicplan; supports "turn a site visit into a quote" | D | M |
| DXF import (DWG later, through a server) | Contractors receiving CAD | D | L |
| HEIC photos (iPhone's picker usually converts them already) | Low priority | N | S |
| LiDAR scanning | Needs a native app | D | XL, defer |

### 2.3 Library and content

The library has **89 kinds**. About 35 are loose furniture, 12 lights, 12 doors and windows and 8 AC units. Decor is a single plant. Competitors advertise 10,000 to over 100,000 items.

| Feature | Why | Type | Effort |
|---|---|---|---|
| **Catalogue refactor:** one module per item (definition, plan glyph, 3D, size rule, takeoff rule, inspector), definitions as data, material slots | Today each item is hand-coded in about 6 places across 3,000-line files. Do this *before* adding items. | Enabler | L |
| glTF/GLB model pipeline, and user model upload | The only way to grow past ~100 items. Keep procedural models for built-ins that stretch (kitchens, wardrobes, sofas). | TS / D | L + M |
| **A content plan:** who models assets, free sources (e.g. Poly Haven), budget | Content is a running cost, not a one-off build | TS | ongoing |
| Colour and material on every item: fabric, wood, wardrobe fronts, base kitchen units, door leaves, window frames | Material swapping is table-stakes | TS | M |
| Search with Arabic and colloquial synonyms (كنبة/انتريه, ثلاجة/تلاجة), fuzzy matching, favourites and recent | 45 items have English keywords only | TS | S |
| Decor: rugs, wall art, mirrors, lamps, vases, shelves, TV wall panels | Renders and suggestions look bare | TS | M |
| Furniture: dresser, side tables, bar stools, office chair, bunk bed, cot, console, shoe cabinet, majlis seating, buffet | Regional homes | TS | M |
| Bathroom: freestanding and corner tubs, bidet and shattaf, accessories, grab bars, water heater, extractor fan | Regional bathrooms | TS | S-M |
| Kitchen: door and handle styles, drawer stacks, pantry, range, microwave, sink bowls, fridge types | Kitchen planners (HomeByMe, Coohom) | TS | M |
| **Electrical points:** double, USB, data, TV/SAT, floor box, waterproof, cooker and AC power, distribution board, detectors, intercom, CCTV; mounting heights; legend and schedule | Contractors' rough-in (تأسيس) drawings; priced per point | TS for target pros | M |
| Plumbing points: hot and cold supply and drains with heights, floor and linear drains; schedule | Set out before tiling; nobody ties them to tile layouts | D | M |
| AC: sizing per room (BTU/HP from area and use), drain and power points, duct runs (vents already exist) | Homeowner hook; ducted AC in the GCC | D | S + M |
| Photometrics: lumens, watts, beam angle, aimable spots, lux heatmap | Lighting designers | D | L |
| Notes, supplier, link, SKU and price fields on each item | Needed for quotes | TS for pros | S |
| A personal material library reused across projects | Photos live inside each project today | TS | M |
| Outdoor: ground, trees, fences, pools, pergolas, parking | Villas | N | L |
| Regional brand catalogues with prices | B2B revenue | D | XL (partnerships) |
| Compound and developer unit-plan library ("open my exact flat") | Units repeat across Egyptian compounds and GCC developments: the strongest easy-start lever in the region | D | partnerships |

### 2.4 3D and presentation

| Feature | Why | Type | Effort |
|---|---|---|---|
| Environment lighting (reflections) in live 3D and the render | Metal, chrome and glass look flat | TS | S |
| Real sun: location, north, date and time; a sky in the render | Sweet Home 3D, Live Home 3D. Also stops the sun moving when the plan grows. | D | M |
| 360° panoramas with a shareable viewer | RoomSketcher, Planner 5D, HomeByMe, Homestyler | D | M |
| Walkthrough video from saved views | Live Home 3D; others sell video by the second | D | M |
| Batch renders of saved views, a render gallery kept with the project | Designers deliver image sets | D | M |
| Saved views that keep daylight, lights on, lens and a thumbnail | Reproducing a shot | TS | S |
| Kitchen and bath interior elevations with dimensions and tiles (unfolded walls already exist in `model/developed.ts`) | Carpenters and tilers | TS for pros | M |
| Sections; orthographic and isometric views; cutaway walls | Chief, Cedreo, SketchUp | TS for pros | L |
| Editing in 3D (drag, rotate, drop from the library) | Planner 5D, Homestyler, HomeByMe | TS | L |
| glTF and USDZ export, then AR viewing | Live Home 3D, Roomle, IKEA Kreativ | D | S-M + M |
| A public, embeddable, view-only 3D viewer | Floorplanner, RoomSketcher, Matterport | TS | M |
| AI restyle or render enhancement, on credits | Becoming common in 2026 | D | M |
| VR through WebXR | Planner 5D, Homestyler | N | S-M |

### 2.5 Quantities, prices and documents (where Planbreeze can win)

| Feature | Why | Type | Effort |
|---|---|---|---|
| Takeoff for the whole project (all floors), per floor and per room | Duplexes and villas | TS | S |
| Editable waste, coverage, board, roll and pack sizes per finish (now fixed at ×1.1, ×1.15) | Real buying lists | TS | S-M |
| **Linear metres:** gypsum bulkheads, coves, shadow gaps, curtain pockets, skirting, LED strip | Priced per metre in the region; the takeoff already computes these edges | TS (region) | S |
| **Lighting bill of materials:** spots by type, colour temperature and frame; LED strip metres; track and modules; drivers by watts; switch gangs | The gypsum and lighting installer's actual quote | D | S-M |
| Stone the takeoff misses: door thresholds, window sills, stair treads and risers | Marble thresholds and sills are standard | TS (region) | S each |
| Waterproofing, screed and plaster lines from the measured surfaces | Wet areas | D | S |
| Area report PDF: net, gross, balconies | Homeowners check the area developers sell | TS | S |
| Export the takeoff and item counts to CSV/XLSX and PDF | Floor Plan Creator, Sweet Home 3D, magicplan | TS | S |
| Price lists (per m², metre, point, piece; labour), currency, markup, VAT, totals | magicplan Estimate, Houzz Pro | D | M-L |
| A branded quote PDF in Arabic and English, with versions | magicplan, Houzz Pro, Hover | D | M |
| Client approval on a share link (name, date, version); e-signature later | Houzz Pro, Hover, DesignFiles | D | M |
| Ceiling-plan annotations for installers: level heights, band and cove sizes, spot spacing, a section per style | Serves the primary segment directly | D | S-M |
| Tile-layout sheets per wall and floor in the PDF (the layouts live only in a dialog) | Tilers need paper | D | S-M |
| Schedules: finishes per room, lighting and switch schedule, doors and windows, points, furniture | Chief schedules | D | M |
| A drawing set: cover, a sheet per trade, title block with logo, revisions | Chief, SketchUp LayOut, Cedreo | TS for pros | L |
| Layered DXF export (DWG and IFC later) | Floor Plan Creator, Cedreo, magicplan, Planner 5D Professional | TS for pros | M |
| A quick estimate by finishing grade (economy, standard, lux, super-lux) per m² | A free calculator that brings people in | D (marketing) | S |

### 2.6 Accounts, sharing and platform

| Feature | Why | Type | Effort |
|---|---|---|---|
| Installable app (PWA): manifest, service worker, offline reload | Job sites; needed for Google Play | TS | S-M |
| Account page: profile, change email, **delete account, export data**, settings synced to the account | Legal requirement and a Google Play rule | TS | M |
| Projects: thumbnails, search and sort, duplicate, folders, client, address and status fields | Contractors juggle many jobs | TS | S-M |
| Edit links, email invitations with acceptance, ownership transfer | Every sharing product | TS | M |
| Version history and a cloud trash | Expected of cloud products | TS | M |
| Comments and pins on plans and renders, with notifications | Homestyler, Planner 5D, Houzz Pro | D | M |
| Share links and PDFs to WhatsApp with Arabic text (exported files already go to the phone's share sheet) | How clients and contractors talk in the region | D | S |
| Help centre, shortcut sheet, feedback, changelog | Everyone | TS | S-M |
| Team workspaces: shared price lists, libraries, templates; roles; seats | RoomSketcher Team, Coohom Elite | TS for teams | L |
| Real-time co-editing | Planner 5D, SketchUp | D | XL |
| An assistant that edits the plan from chat; image-to-3D for missing furniture; public API or MCP server | AI frontier in the market | D | M each |

---

## 3. Incomplete features (built, but partial)

| Feature | What's lacking | Fix | Effort |
|---|---|---|---|
| **Wall thickness** | One per room; the neighbour's overlapping wall doesn't follow; import uses one thickness for every room | Detect overlapping walls and change both; allow a thickness per wall; detect thickness per wall on import. Long term, the wall graph. | M |
| **Wall tool (free-standing walls)** | No doors or windows in them; no chained segments or typed length; furniture isn't pulled against them | Include their faces in opening snaps, magnet and guides; typed length and chains | M |
| **Corner and wall editing** | Neighbouring rooms don't follow a moved corner; arrow keys move the whole room when a corner or wall is picked; no angle field; no rotate or mirror for one room | Nudge the picked corner or wall; move matching corners of neighbours together; angle field; rotate and mirror | M |
| **Dimensions** | Fixed points that go stale when rooms move; auto-dimension adds only overall width and depth | Anchor ends to room corners; automatic chains per room | M-L |
| **Length input** | A plain number means metres, so "350" makes a 350 m wall; Arabic digits (٠-٩) and ٫ are rejected | Accept Arabic digits; an entry-unit setting (cm by default for Arabic); warn on huge values; show the value read | S |
| **Stairs** | Straight only; default height 280 cm instead of floor height plus slab; no hole cut in the slab above | Fix the default and cut the slab now; L and U shapes later | S + L |
| **Floors** | Added on top only; slab fixed at 15 cm; no reordering | Reorder, insert below, level and slab per floor | M |
| **Templates** | 5 single-floor plans | Regional types (Egyptian 3-bed with reception, GCC villa) and "save as template" | M |
| **Import wizard** | Images only; one wall thickness; some buttons untranslated | PDF input, thickness per wall, translations | M |
| **Underlay** | Can't be moved, scaled, rotated or recalibrated after import; stored inside the project | Handles and a recalibrate line; stored as a file in the browser database | S-M |
| **Labels** | One line; fixed hit box; default text "Label" not translated | Multi-line, sized hit box, styles, translation | S-M |
| **Layers** | Can only fade things | Real hide and lock | M |
| **Touch editing** | No equivalents for Shift, Ctrl and Alt; typed walls only go 4 ways; no magnifier or long-press menu; pinch-zooming while drawing leaves a stray point | Toggle chips (free angle, no snap, from centre); angle field; magnifier; long-press menu; drop the point on a second finger | M |
| **Touch navigation in 3D** | No sideways or up/down moves; no gyroscope; no tap-to-go | Strafe control, look-around with the gyroscope, tap to go | M |
| **Furniture colours** | Style and finish shows only for items with styles or palettes; base kitchen units always white; outlets float (not wall-mounted); door leaves and window frames have fixed colours | Material slots on every model; colour base units and let suggestions set them; mount outlets like switches; palettes for doors and windows | S-M |
| **Library search** | Substring match; English keywords for 45 items only | Fuzzy search over English and Arabic names plus a synonym table | S |
| **Design suggestions** | One style for the whole floor; no decor or outlets; balconies get the indoor dining set | A style per room; decor and outlet pass; outdoor sets; regional styles (e.g. neo-classic) | M |
| **Finishes** | Ceilings plain only; no skirting choice; no exterior finishes | Ceiling paint colours and wood slats; skirting material and height (counted); local paint decks later | M |
| **Walking in 3D** | Walks through furniture; daylight overridden indoors when above 0.3; fixed eye height; no orthographic view | Collide with furniture; keep the user's daylight; eye-height setting; orthographic top view | M |
| **Viewpoints and lens** | Current floor only; saved views keep only eye and target; ultra-wide leans walls | Full view state; tour across floors; two-point perspective | S-M |
| **Live lighting** | Pool lights cast no shadows, so light leaks through walls; spots point straight down | Mask lights by room; shadows for the nearest spots; aimable spots | M-L |
| **Day and night** | One slider; sun pinned to the plan's bounds | Sun from north and time; sky from an HDRI | M |
| **Materials in 3D** | No normal or roughness maps; no environment map | Procedural grout and grain normals; an environment map | M |
| **Snapshots** | Size follows the window; no transparency or gallery | Size presets, transparent background, gallery | S |
| **Realistic render** | Caps the number of lights but the dialog says "every light that's on"; gradient sky; current view only; first compile 1-2.5 min | Fix the copy or rank lights by importance; HDRI sky; batch views; compile in the background | M |
| **Takeoff** | One floor; fixed factors; no export, linear metres, pack sizes or labour; thresholds, sills and stair stone not counted; the "no rule" check runs only in development | See 2.5; make the check a test | S-M |
| **Item counts** | Per type only, no export | Group by type, style, finish and size; export | S |
| **Cloud sync** | Pulls when a project opens and when the connection returns, but not on focus or a timer; two tabs overwrite each other; client clock; uploads the whole project with images; conflicts are all-or-nothing | Pull on focus; a lock per project across tabs; server timestamps; images in Storage; compressed saves; "keep both" | M |
| **Sharing** | View-only links; no invitations; the client can set `owner_email`; the owner's id is in the URL | Edit links, invitations, `owner_email` set by the database, link expiry, opaque share ids | M |
| **Accounts** | No profile, deletion or export; sign-out leaves the API key and settings behind; sign-in strings in English | Account page, full wipe on sign-out, translations | M |
| **Export and print** | **Arabic comes out garbled in the PDF** (every font is replaced with Helvetica); English title block; no legend, north arrow, schedules or logo | Embed the Arabic font with shaping, or print through the browser, or draw text as outlines; translated title block; automatic legend; logo | M |
| **Opening a .json project** | Only checks that the lists exist | Schema version, migrations and validation | S-M |
| **Translation** | About 40 strings bypass `t()` (sync, canvas toasts, AI, print, share and conflict dialogs); numbers formatted with `toFixed`; legal pages English-only | Sweep and a CI check; localised number formatting; Arabic legal pages | S-M |
| **Onboarding and docs** | No checklist or video; the README says "nothing is sent to a server" and its shortcut table is out of date | Activation checklist; rewrite; in-app shortcut sheet | S |
| **Settings** | Spread across menus; no defaults for paper, company, logo or currency; not synced | One settings dialog, synced | M |

---

## 4. Risks to fix before growing

**P0** = before any marketing; **P1** = before charging money.

| Risk | Evidence | Fix | Pri. | Effort |
|---|---|---|---|---|
| **A white screen with no way out** | No error boundary anywhere; the last project reopens on every boot without checks; after each deploy, an open tab that loads 3D, PDF or render fetches old files that no longer exist (no `vite:preloadError` handler) | Error boundaries offering reload, another plan, or download as JSON; a safe-mode boot; reload when a deploy changes the files | P0 | S |
| **No file version** | Old files rely on fix-up code forever | `schemaVersion` and migrations on every load path; a light structural check (a full schema later) | P0 | S-M |
| **Plans only in localStorage** | About 5 MB, shared with every page on `ahmadwael28.github.io`; images stored inline; saving stops when full; Safari can clear sites unused for 7 days | IndexedDB with images as files, `navigator.storage.persist()`, a storage meter | P0 | M |
| **Lost edits on phones** | The local save runs only on `beforeunload`, which phones often skip | Also save on `pagehide` and `visibilitychange` | P0 | S |
| **Deleting a plan is permanent** | No trash, no "download all my plans" | A local trash and a bulk backup and restore | P0 | S |
| **Settings crash when storage is full** | `setSettings` doesn't catch errors | try/catch | P0 | S |
| **Hosting and origin** | Other pages on `ahmadwael28.github.io` can read the session and the API key; GitHub Pages can't send security headers (CSP `frame-ancestors`, HSTS), and GitHub's terms don't allow Pages for commercial SaaS | Move to a custom domain on Cloudflare Pages or Netlify with real headers; carry local plans over with the bulk backup or a bridge page (a custom domain on the same repo redirects the old URL, so the bridge needs its own path) | P0 | M |
| **Supabase** | The client can write its own `owner_email`; shares need no acceptance; editors can save any JSON, including outside image URLs; no quotas; free tier pauses after 7 days and has no backups | `owner_email` set by a trigger; pending shares; reject outside images; quotas; paid tier with backups | P1 | S-M |
| **API key in the browser** | The Anthropic key is stored and used in the browser | A server proxy with metering; remove the key field | P1 | M |
| **Sign-out leaves secrets** | API key and settings stay on shared computers | Clear them | P0 | S |
| **Wrong numbers** | "350" is a 350 m wall; self-intersecting rooms are accepted and break areas; nudging an open room builds its wall back | Fix length input; check polygons on save; nudge open rooms together | P0 | S |
| **No tests, no gates** | CI only builds and deploys `main` straight to users; no test script; version 0.0.0 | Vitest on the core maths (takeoff golden test 300×200 cm → 6, 6 and 25 m²; length input; divide; sync), a test that every library kind has a takeoff rule, and one that every string has Arabic; lint and typecheck on every push; Dependabot; Playwright later | P0 | M |
| **No error reporting** | Users see raw error messages; nobody hears about crashes | Sentry or GlitchTip with consent; friendly messages; update the privacy page | P0 | S |
| **Slow on phones** | The whole 3D scene rebuilds on every edit; boot JavaScript is about 1.4 MB plus a 166 KB font, and the 130 KB Arabic dictionary loads for everyone; the same 2048 shadow map on phones; takeoff recomputes during drags; caches that never empty | Rebuild only what changed; quality tiers by device; load the Arabic dictionary only for Arabic; compute the takeoff on commit; clear caches on project switch; handle WebGL context loss | P1 | M-L |
| **Accessibility** | The plan can't be focused; nothing is announced; equal and unequal guides differ only by colour | Keyboard focus on items, live announcements, shapes as well as colour | P1 | M |

---

## 5. Business essentials

### Making money
- **Charge for what costs money to serve:** cloud storage, AI and future server renders.
- **Don't meter the render:** it runs on the user's own GPU. "Unlimited renders, free" is a direct answer to Floorplanner, RoomSketcher and Cedreo.
- **Charge pros for what they value:** branding, prices and quotes, client approval, DXF, drawing sets, schedules and teams.

| Tier | For | Price (to test in interviews) | Includes |
|---|---|---|---|
| **Free** | Homeowners | 0 | Unlimited local plans, 3 cloud plans, all drawing and design tools, renders up to Full HD, takeoff on screen, PDF with a small footer, view links |
| **Home** | A homeowner with one renovation | ~$9-15 per project, or ~$3-5/mo yearly | Unlimited cloud plans, 4K renders, panoramas and video, takeoff export, version history, no footer, AI imports |
| **Pro** | Contractors, installers, designers | ~$12-19/mo yearly (RoomSketcher Pro $12, magicplan Report $39.99, Houzz Pro $99) | Price lists, branded Arabic and English quotes, approval links, drawing sets, DXF, logo, project fields, AI credits |
| **Team** | Small firms | ~$10-15 per seat per month | Shared price lists, libraries and templates; roles |
| **Later** | Suppliers and brands | Sales-led | Brand catalogues, sponsored materials, a lead marketplace |

- **Payments:** a merchant of record (Paddle or Lemon Squeezy) for cards and VAT. In Egypt, card use is low, so add Paymob or Fawry, InstaPay and Vodafone Cash. In the GCC, Moyasar, HyperPay or Tap.
- **Start by billing the first 10-20 pros by hand,** before building any billing.
- **Google Play:** an app there that sells subscriptions must use Google Play Billing, and it must let users delete their account in the app and on the web. Decide on billing before listing.

### Legal
- Today the privacy and terms pages are English-only, say "free to use", and account deletion means opening a GitHub issue.
- **Needed:**
  - a named legal entity and governing law;
  - a list of subprocessors (Supabase, the AI provider, payments, error reporting, analytics, email);
  - self-service deletion and export;
  - Arabic versions;
  - billing, refund and cancellation terms;
  - an upload and copyright policy;
  - an "estimates only" disclaimer on quantities and quotes.
- Review Egypt's data-protection law (151/2020), Saudi and UAE PDPL and GDPR with a lawyer.

### Analytics
- **Tools:** cookieless page analytics (Plausible or Umami), plus product events with opt-in.
- **Events:** start choice, import done, room drawn, item placed, lighting used, 3D opened, render done (size, seconds, device), takeoff viewed or exported, PDF exported, share made, sign-in, and day-7 return.
- **North-star metric:** a plan with lighting or finishes that was exported or shared.

### Support and marketing
- **Support:** in-app help (bilingual, searchable), "Report a problem", WhatsApp Business, a changelog, short Arabic videos.
- **Site:** a landing page on the custom domain with the app at `/app`, in Arabic and English, with social preview tags.
- **Search:** Arabic calculators that rank and lead into the app, such as tile quantity ("حساب كمية السيراميك"), paint quantity, gypsum ceiling designs, and cost by finishing grade. Start early: search takes months to rank.
- A public gallery of sample plans and renders; partnerships with gypsum and lighting installers.

### App stores
- **PWA first.**
- **Google Play** as a Trusted Web Activity (cheap, and the market is mostly Android), once account deletion exists and billing is decided.
- **iOS:** Add to Home Screen for now. A native wrapper only when scanning or Bluetooth needs one.

---

## 6. The plan

This is honest about time. Adding up the efforts, the whole plan is roughly **1.5-2.5 years** for one developer at full scope. The way through is to ship in the order below and cut scope at each phase boundary using what interviews and analytics show.

### Phase 0: Make it safe (about 6-8 weeks)
Goal: nothing a user makes can be lost, the app never dead-ends, Arabic is right from start to finish, and the core maths is under test.

1. Error boundaries, safe-mode boot, reload after a deploy, save on `pagehide`, try/catch on settings (S)
2. `schemaVersion` with migrations on every load path; a light structural check (S-M)
3. Local trash and "download all my plans" backup and restore (S)
4. IndexedDB storage with images as files, `persist()`, storage meter (M)
5. Custom domain on a host with real headers (CSP, `frame-ancestors`, HSTS); move local plans across (M)
6. Supabase hardening; full wipe on sign-out (S-M)
7. Length input: Arabic digits, entry unit, warnings (S)
8. Correctness fixes (S-M):
   - nudging open rooms and picked corners or walls;
   - the pinch stray point;
   - outlets mounted on walls;
   - base kitchen colours;
   - the stair default height and the slab hole;
   - the render's "every light" copy;
   - the self-intersecting room check.
9. Translation sweep and a CI check (S)
10. Arabic PDF, with browser print as the fallback (M)
11. Vitest and CI gates: takeoff golden tests, a takeoff-rule test for every library kind, Arabic coverage, units, divide, sync; lint and typecheck; Dependabot (M)
12. Error reporting with consent; privacy page update (S)
13. README rewrite and a shortcut sheet (S)

**Done when:**
- No known path to losing data remains.
- The app is served from the custom domain with headers.
- CI blocks a push that fails lint, typecheck or tests.
- An Arabic PDF prints room names correctly.
- Crash reports arrive.

### Phase 1: Win the core job (about 4-6 months)
Goal: a homeowner or a fit-out contractor can go from a plan to a quantity list and a simple priced quote on a phone, in Arabic. Run the interviews and analytics alongside.

**A. Quantities and Quote v0** (the first thing pros will pay for)
1. Takeoff v2: project-wide; editable factors and pack sizes; linear metres; thresholds, sills and stair stone; waterproofing lines; CSV/XLSX/PDF export; counts by style and finish (M)
2. Lighting bill of materials (S-M)
3. Electrical points library with a per-point schedule; AC drain and power points; AC sizing (M)
4. Notes, supplier, SKU and price fields per item (S)
5. Area report PDF (S)
6. **Quote v0:**
   - a unit price per line (m², metre, point, piece) and a currency;
   - a branded Arabic and English PDF;
   - sharing to WhatsApp;
   - manual billing for the first pros.
   Effort: M.

**B. Drawing and the phone**
7. Typed sizes and angles, angle readout, tape measure, snapping to edges, midpoints and perpendiculars (M)
8. Touch: modifier chips, magnifier, long-press menu, angle field; sideways moves in 3D (M)
9. A spike on a *derived*, read-only wall graph from the room polygons. Use it for:
   - dimensions tied to walls and auto chains;
   - openings in free-standing walls;
   - neighbouring corners following a move.
   Effort: M-L.
10. Ceiling-plan annotations for installers; tile-layout sheets in the PDF; multi-line labels, north arrow, legend (M)

**C. Library**
11. **Catalogue refactor first** (one module per item, data definitions, material slots) (L)
12. Then:
    - colours and materials on all furniture;
    - more door and window types;
    - Arabic fuzzy search and favourites;
    - a decor pack;
    - missing furniture and bathroom items (shattaf, water heater).
    Effort: M.
13. Regional templates and "save as template" (M)

**D. Platform**
14. PWA with offline reload (S-M)
15. PDF plan import; move, scale, rotate and recalibrate the underlay (M + S)
16. AI import through a metered server proxy (M)
17. Sync v2: pull on focus, lock across tabs, server timestamps, images in Storage, compression, "keep both" (M)
18. Projects dialog: thumbnails, search, duplicate, client fields. Account page with deletion and export. (S-M + M)
19. Performance: rebuild only what changed in 3D, device quality tiers, Arabic dictionary loaded on demand, takeoff on commit, leak fixes, context loss; Playwright smoke tests (English and Arabic, desktop and phone) and preview deploys (M-L)
20. Environment map, saved views with full state, snapshot sizes (S)
21. Activation checklist, help v1, feedback, analytics with consent (S-M)
22. Arabic legal pages; landing site and the first Arabic calculators for search (M)

**Done when:**
- A contractor can import a PDF plan, fix it, light it, and send the client a priced Arabic quote over WhatsApp.
- A homeowner can export a buying list to Excel.
- The app installs and reopens offline.
- At least 10 pros are billed by hand, which shows whether they will pay.
- The family-house template rebuilds in 3D in under 100 ms after an edit on a mid-range Android phone.

### Phase 2: Differentiators and paid Pro (about 6-9 months)
1. Billing and entitlements; launch Pro (M)
2. Full quotes: price lists, markup and VAT, versions, a client approval link (M-L)
3. Plumbing points and schedule; AC duct runs (M)
4. Kitchen and bath interior elevations, building on `developed.ts` (M); sections, orthographic and isometric views (L)
5. Drawing set: a sheet per trade, title block with logo, revisions (L)
6. Render v2 (L):
   - HDRI sky and real sun;
   - lights ranked by importance;
   - batch renders of saved views;
   - a gallery;
   - 360° panoramas with a share viewer;
   - walkthrough video.
7. Live lighting v2: no leaks between rooms, shadowed spots, aimable spots, lumens and a lux view (L)
8. Design suggestions v2: a style per room, decor and outlets, outdoor sets, regional styles (M)
9. glTF pipeline, user model upload, and a content programme (L, then ongoing)
10. Comments and pins; site-visit photos and notes on the plan (M)
11. Version history and cloud trash; edit links and invitations; embeddable viewer (M)
12. Layered DXF export; glTF and USDZ export with AR (M + M)
13. Bluetooth laser meter (first brand); Android room-capture spike (M each)
14. Google Play listing, once billing and account deletion are settled (S)
15. Floor management and L/U stairs, if villas are in scope by now (L)

**Done when:**
- A contractor turns a site visit into a priced, branded quote and a drawing set that the client approves through a link.
- Panoramas can be shared.
- Light no longer leaks between rooms.
- New items are added as data and model files.
- Pro has paying users.

### Phase 3: Teams, villas and ecosystem (12 months and more)
- **Teams and pricing:** team workspaces; the Home tier, project passes and credit packs.
- **Wall graph:** editable shared walls with thickness per wall, and curved walls. This needs the golden tests in place first.
- **Villas:** ceiling height per room, sloped ceilings, roofs and outdoor.
- **Partnerships:** regional brand catalogues with prices; a library of compound and developer unit plans; a lead marketplace where homeowners share a plan and takeoff and local contractors quote.
- **AI on credits:** render restyle, room-name reading, plans from a brief, an assistant that edits the plan, and image-to-3D.
- **More:** real-time co-editing; DWG and IFC through a server; a public API or MCP server; a native wrapper, only if scanning justifies it.

---

## 7. Milestones: the plan in small steps

Each milestone is about one to two weeks of work. It ships and deploys on its own, and leaves the app better than before. Run the contractor and homeowner interviews alongside from the start.

### Phase 0: Make it safe

**M1. Never dead-end, never lose work** ✓ shipped 31 Oct 2026
- Error screens, around the whole app and around 3D and the dialogs, offering: reload, open another plan, or download this plan.
- A safe-mode start that skips the last plan.
- A reload when a deploy has replaced the app's files.
- Saving on `pagehide` and `visibilitychange`; try/catch when settings are saved.
- A trash for deleted plans, with restore.
- "Download all my plans" and restore from that file.
- Sign-out clears the AI key and settings.
- *Done when:* a crash shows a way out; a deleted plan comes back from the trash; a backup file restores every plan.

**M2. Right numbers, right Arabic** ✓ shipped 1 Nov 2026
- **Length input:**
  - Arabic digits (٠-٩) and ٫ accepted;
  - an entry unit (cm by default in Arabic);
  - a warning on huge values;
  - the value read shown as you type.
- **Bugs:**
  - nudging open rooms and a picked corner or wall;
  - pinch-zoom leaving a point while drawing;
  - outlets mounted on walls;
  - base kitchen unit colours;
  - stairs as high as the floor plus its slab, with a hole cut in the slab above;
  - the render's "every light" text;
  - rooms whose sides cross.
- **Translation sweep:** the ~40 untranslated strings.
- *Done when:* "350" makes a 3.5 m wall in Arabic and English, and every bug above is fixed.

**M3. A safety net** ✓ shipped 1 Nov 2026
- Vitest with golden tests:
  - the takeoff (300×200 cm room, 250 cm walls → 6, 6 and 25 m²);
  - every library kind has a takeoff rule;
  - every string has Arabic;
  - length input;
  - divide and heal.
- A version number in project files, with migrations, run on every way a plan is opened.
- CI runs lint, typecheck and tests, and only deploys when they pass. Dependabot.
- *Done when:* a failing test stops a deploy.

**M4. Room to grow: storage**
- Plans and images move from localStorage to IndexedDB; images are stored once as files, not inside each plan.
- `navigator.storage.persist()` and a storage meter.
- Existing plans move across by themselves.
- *Done when:* a plan with many photos saves, and old plans open as before.

**M5. Arabic on paper**
- The Arabic font embedded in the PDF, with shaping (browser print as the fallback).
- A translated title block and an automatic legend.
- *Done when:* a printed Arabic plan shows room names and labels correctly.

**M6. A home of its own** *(needs your decisions: a domain name and a host)*
- A custom domain on Cloudflare Pages or Netlify, with security headers (CSP, `frame-ancestors`, HSTS).
- Local plans carried across from the old address, through M1's backup or a bridge page.
- **Supabase:** `owner_email` set by the database, shares that must be accepted, no outside image links, quotas, a paid tier with backups.
- Crash reporting with consent; an updated privacy page.
- *Done when:* the app runs on its own domain and old users' plans arrive with them.

### Phase 1: Win the core job

**M7. Quantities v2**
- Takeoff across all floors, per floor and per room.
- Editable waste factors, coverage and pack sizes.
- Linear metres: bulkheads, coves, shadow gaps, curtain pockets, skirting.
- Marble door thresholds, window sills and stair stone.
- Waterproofing lines.
- Export to Excel/CSV and PDF; an area report (net, gross, balconies).
- *Done when:* a homeowner exports a buying list to Excel.

**M8. The lighting and electrical trade**
- A lighting bill of materials: spots by type and colour temperature, LED-strip metres, tracks, drivers, switch gangs.
- An electrical points library with mounting heights and a per-point schedule.
- AC drain and power points, and AC sizing per room.
- *Done when:* an installer can read their full bill and point count off the app.

**M9. Quote v0**
- Notes, supplier, SKU and price on each item.
- A unit price per line (m², metre, point, piece) and a currency.
- A branded quote PDF in Arabic and English, shared to WhatsApp.
- *Done when:* the first contractors send real quotes from it, and are billed by hand.

**M10. Draw faster, on any screen**
- Typed width × height and length at an angle; an angle readout; a tape measure that leaves nothing behind.
- Snapping to wall edges, midpoints and perpendiculars.
- On touch: chips for free angle, no snap and from-centre; a magnifier; a long-press menu.

**M11. Plans that hold together**
- A read-only wall graph worked out from the rooms, used for:
  - dimensions that follow the walls, with automatic chains per room;
  - doors and windows in free-standing walls;
  - neighbouring corners that move together.
- Ceiling-plan annotations for installers; tile-layout sheets in the PDF; multi-line labels, north arrow.

**M12. A library that can grow**
- One module per item (definition, glyph, 3D, size, takeoff rule, inspector), with definitions as data and material slots.
- Little changes on screen, but every later item becomes cheaper to add.

**M13. A bigger, friendlier library**
- Colours and materials on all furniture; more door and window types.
- Arabic fuzzy search with colloquial synonyms; favourites and recent.
- A decor pack; missing furniture and bathroom items (shattaf, water heater).
- Regional templates and "save as template".

**M14. Install it, import anything**
- An installable app (PWA) that reopens offline.
- PDF plan import.
- Move, scale, rotate and recalibrate the underlay.
- AI import through a metered server, not the user's own key.

**M15. Cloud v2**
- Sync picks up changes on focus, locks a plan across tabs, uses server time, keeps images in Storage, and offers "keep both" on a conflict.
- The projects dialog gets thumbnails, search, duplicate and client fields.
- An account page with deletion and export.

**M16. Fast on phones**
- 3D rebuilds only what changed; quality tiers by device.
- The Arabic dictionary loads only for Arabic; the takeoff runs on commit.
- Cache leaks fixed; WebGL context loss handled.
- Playwright smoke tests in both languages, on desktop and phone.

**M17. Launch kit**
- Onboarding checklist, help, feedback, analytics with consent.
- Arabic legal pages.
- A landing site, and the first Arabic calculators for search.
- Reflections in 3D, saved views that keep their settings, snapshot sizes.

### Phase 2: Differentiators and paid Pro
- **M18.** Billing and Pro launch, plus full quotes (price lists, markup, VAT, versions, client approval link)
- **M19.** Plumbing points, AC ducts, kitchen and bath elevations
- **M20.** Drawing set (a sheet per trade, title block with logo, revisions), sections and orthographic views
- **M21.** Render v2 (HDRI sky, real sun, batch renders, gallery), 360° panoramas, walkthrough video
- **M22.** Live lighting v2 (no leaks between rooms, shadows, aimable spots, lux)
- **M23.** glTF models, user model upload, design suggestions v2
- **M24.** Comments and pins, site photos, version history, edit links and invitations, embeddable viewer
- **M25.** DXF export, glTF/USDZ and AR, laser meter, Android capture spike, Google Play

### Phase 3
Teams, the editable wall graph, villas, brand catalogues, the unit-plan library, AI on credits and co-editing, each split into milestones when Phase 2 ends, using what users have shown by then.

---

## Sources

The market research (about 40 products, 148 sources) is summarised above. It covers:
- **Consumer apps:** Floor Plan Creator, RoomSketcher, Planner 5D, Floorplanner, HomeByMe, Homestyler, Sweet Home 3D, Live Home 3D, Roomle, Coohom, Kazaplan, IKEA Kreativ, and AI tools (Interior AI, RoomGPT, Planner 5D AI Studio, REimagine Home, Spacely, Maket).
- **Professional and scanning tools:** magicplan, Cedreo, SmartDraw, Chief Architect, SketchUp, Foyr Neo, Houzz Pro, DesignFiles, Polycam, CubiCasa, Matterport, Hover, RoomScan Pro, Xactimate and Handoff.

Most prices come from the vendors' pricing pages. Some come from trackers such as PricingSaaS and Capterra, so treat those as approximate.
