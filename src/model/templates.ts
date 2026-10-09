import { t } from '@/i18n'
import { CEILING_STYLES } from './lighting'
import { personDepth, personSupport } from './people'
import { newFloor, newProject, newSymbol, OUTDOOR, RAILING_THICKNESS, rectPoints, uid } from './project'
import type { CeilingStyle, Dimension, Floor, LightSettings, PlanSymbol, Project, Room } from './types'

const WALL = 10

/** Small DSL for describing a furnished floor. */
function builder() {
  const rooms: Room[] = []
  const symbols: PlanSymbol[] = []
  const dimensions: Dimension[] = []
  return {
    room(name: string, color: string, x: number, y: number, w: number, h: number) {
      const r: Room = { id: uid(), name: t(name), points: rectPoints(x, y, w, h), wallThickness: WALL, color }
      rooms.push(r)
      return r
    },
    /** Door/window in wall `edge` (0 top, 1 right, 2 bottom, 3 left for rectangles), `offset` cm from the edge start. */
    wall(type: string, room: Room, edge: number, offset: number, extra: Partial<PlanSymbol> = {}) {
      symbols.push({ ...newSymbol(type, 0, 0), depth: WALL, wall: { roomId: room.id, edge, offset }, ...extra })
    },
    item(type: string, x: number, y: number, extra: Partial<PlanSymbol> = {}) {
      const s = { ...newSymbol(type, x, y), ...extra }
      symbols.push(s)
      return s
    },
    ceiling(room: Room, style: CeilingStyle) {
      room.ceiling = { style, ...CEILING_STYLES[style].defaults }
    },
    /** Hidden LED strip around a room's ceiling. */
    cove(room: Room) {
      const s = { ...newSymbol('cove-light', 0, 0), room: room.id }
      symbols.push(s)
      return s
    },
    /** A wall switch at an inside wall face, wired to the given lights. */
    switch(label: string, x: number, y: number, rotation: number, lights: PlanSymbol[]) {
      const s = { ...newSymbol('switch', x, y), label, rotation, controls: lights.map((l) => l.id) }
      symbols.push(s)
      return s
    },
    /** A balcony or terrace drawn against the outside of the building. */
    outdoor(name: string, kind: 'balcony' | 'terrace', x: number, y: number, w: number, h: number) {
      const r: Room = { id: uid(), name: t(name), points: rectPoints(x, y, w, h), wallThickness: RAILING_THICKNESS, color: OUTDOOR[kind].color, kind, railing: { ...OUTDOOR[kind].railing } }
      rooms.push(r)
      return r
    },
    /** A room's own light: its hidden LED strip, the one in its curtain pockets or in its shadow gaps. */
    roomLight(type: 'cove-light' | 'pocket-light' | 'gap-light', room: Room, light?: LightSettings) {
      const s = { ...newSymbol(type, 0, 0), room: room.id, ...(light && { light }) }
      symbols.push(s)
      return s
    },
    dimension(a: { x: number; y: number }, b: { x: number; y: number }, offset: number) {
      dimensions.push({ id: uid(), a, b, offset })
    },
    floor(name = t('Ground floor')): Floor {
      // People sitting or lying down settle onto what's under them, as they do when placed by hand.
      for (const s of symbols) {
        if (s.type !== 'person') continue
        s.depth = personDepth(s.height, s.width, s.pose)
        const at = personSupport(s, symbols)
        if (at) Object.assign(s, { x: at.x, y: at.y, rotation: at.rotation })
      }
      return { ...newFloor(name), rooms, symbols, ...(dimensions.length && { dimensions }) }
    },
  }
}

const C = {
  living: '#fef3c7',
  kitchen: '#dcfce7',
  bath: '#e0f2fe',
  bed: '#ede9fe',
  bed2: '#fce7f3',
  hall: '#f1f5f9',
  work: '#dbeafe',
  storage: '#ffedd5',
}

function studio(): Floor {
  const b = builder()
  const main = b.room('Studio', C.living, 0, 0, 600, 480)
  const bath = b.room('Bathroom', C.bath, 610, 0, 240, 240)
  const entry = b.room('Entry', C.hall, 610, 250, 240, 230)
  b.wall('door', entry, 1, 115, { flipY: true })
  b.wall('opening', entry, 3, 115)
  b.wall('door', bath, 2, 120)
  b.wall('window', main, 0, 150)
  b.wall('window', main, 0, 450)
  b.wall('window', main, 3, 240)
  b.item('bed-double', 100, 130, { rotation: 270 })
  b.item('round-table', 330, 120)
  b.item('sofa', 540, 300, { rotation: 90 })
  b.item('coffee-table', 420, 300, { rotation: 90 })
  b.item('counter', 130, 450, { width: 200, rotation: 180 })
  b.item('stove', 260, 450, { rotation: 180 })
  b.item('fridge', 325, 445, { rotation: 180 })
  b.item('shower', 655, 45)
  b.item('toilet', 820, 35)
  b.item('washbasin', 820, 150, { rotation: 90 })
  return b.floor()
}

function oneBed(): Floor {
  const b = builder()
  const living = b.room('Living room', C.living, 0, 0, 500, 420)
  const kitchen = b.room('Kitchen', C.kitchen, 510, 0, 300, 250)
  const bath = b.room('Bathroom', C.bath, 510, 260, 300, 160)
  const bed = b.room('Bedroom', C.bed, 0, 430, 420, 350)
  b.wall('door', living, 3, 300, { flipY: true })
  b.wall('window-wide', living, 0, 250)
  b.wall('opening', kitchen, 3, 125)
  b.wall('window', kitchen, 0, 150)
  b.wall('door', bath, 3, 80)
  b.wall('door', bed, 0, 320, { flipX: true })
  b.wall('window', bed, 2, 210)
  b.item('sofa', 250, 360, { rotation: 180 })
  b.item('coffee-table', 250, 260)
  b.item('tv-unit', 250, 30)
  b.item('armchair', 70, 250, { rotation: 90 })
  b.item('plant', 460, 40)
  b.item('counter', 700, 30, { width: 200 })
  b.item('stove', 570, 30)
  b.item('kitchen-sink', 700, 30)
  b.item('fridge', 770, 215, { rotation: 180 })
  b.item('round-table', 630, 160)
  b.item('bathtub', 720, 380, { rotation: 180 })
  b.item('toilet', 780, 295)
  b.item('washbasin', 690, 285)
  b.item('bed-double', 170, 670, { rotation: 180 })
  b.item('nightstand', 60, 745)
  b.item('nightstand', 280, 745)
  b.item('wardrobe', 385, 620, { rotation: 90 })

  // Lighting design
  b.ceiling(living, 'cove')
  const cove = b.cove(living)
  const spots = [
    [125, 105],
    [375, 105],
    [125, 315],
    [375, 315],
  ].map(([x, y]) => b.item('spot', x, y))
  const track = b.item('track', 250, 30, { light: { color: 'white', brightness: 1 } })
  const profile = b.item('led-profile', 700, 75, { width: 190, light: { color: 'white', brightness: 1 } })
  const pendant = b.item('pendant', 630, 160)
  const bathSpots = [b.item('spot', 590, 330, { light: { color: 'cool', brightness: 1 } }), b.item('spot', 730, 330, { light: { color: 'cool', brightness: 1 } })]
  b.ceiling(bed, 'tray')
  const chandelier = b.item('chandelier', 210, 600)
  const sconces = [b.item('wall-light', 70, 772.5, { rotation: 180 }), b.item('wall-light', 270, 772.5, { rotation: 180 })]
  b.switch('Spots', 10, 195, -90, spots)
  b.switch('Mood', 10, 250, -90, [cove, track])
  b.switch('Kitchen', 520, 215, -90, [profile, pendant])
  b.switch('Bath', 520, 395, -90, bathSpots)
  b.switch('Bedroom', 250, 440, 0, [chandelier])
  b.switch('Bedside', 180, 440, 0, sconces)
  return b.floor()
}

function twoBed(): Floor {
  const b = builder()
  const living = b.room('Living room', C.living, 0, 0, 550, 450)
  const kitchen = b.room('Kitchen', C.kitchen, 560, 0, 300, 280)
  const bath = b.room('Bathroom', C.bath, 560, 290, 300, 160)
  const bed1 = b.room('Bedroom', C.bed, 0, 460, 400, 360)
  const bed2 = b.room('Kids room', C.bed2, 410, 460, 450, 360)
  b.wall('door', living, 3, 300, { flipY: true })
  b.wall('window-wide', living, 0, 275)
  b.wall('opening', kitchen, 3, 140)
  b.wall('window', kitchen, 0, 150)
  b.wall('door', bath, 3, 80)
  b.wall('window', bath, 1, 80, { width: 60 })
  b.wall('door', bed1, 0, 330, { flipX: true })
  b.wall('window', bed1, 2, 200)
  b.wall('door', bed2, 0, 70)
  b.wall('window', bed2, 2, 225)
  b.item('sofa', 275, 390, { rotation: 180 })
  b.item('coffee-table', 275, 290)
  b.item('tv-unit', 275, 30)
  b.item('armchair', 70, 290, { rotation: 90 })
  b.item('dining-table', 440, 110, { rotation: 90 })
  b.item('counter', 710, 30, { width: 180 })
  b.item('stove', 590, 30)
  b.item('kitchen-sink', 710, 30)
  b.item('fridge', 820, 240, { rotation: 180 })
  b.item('bathtub', 770, 410, { rotation: 180 })
  b.item('toilet', 835, 325)
  b.item('washbasin', 740, 315)
  b.item('bed-double', 200, 720, { rotation: 180 })
  b.item('nightstand', 95, 795)
  b.item('nightstand', 305, 795)
  b.item('wardrobe', 30, 560, { rotation: 90 })
  b.item('bed-single', 760, 720, { rotation: 180 })
  b.item('desk', 520, 780, { rotation: 180 })
  b.item('wardrobe', 830, 540, { rotation: 270 })
  return b.floor()
}

function house(): Floor {
  const b = builder()
  const living = b.room('Living room', C.living, 0, 0, 480, 450)
  const kitchen = b.room('Kitchen', C.kitchen, 490, 0, 270, 450)
  const storage = b.room('Storage', C.storage, 770, 0, 180, 190)
  const bath = b.room('Bathroom', C.bath, 770, 200, 180, 250)
  const hall = b.room('Hallway', C.hall, 0, 460, 950, 140)
  const bed1 = b.room('Main bedroom', C.bed, 0, 610, 320, 350)
  const bed2 = b.room('Bedroom 2', C.bed2, 330, 610, 290, 350)
  const bed3 = b.room('Bedroom 3', C.work, 630, 610, 320, 350)
  b.wall('door', hall, 3, 70, { flipY: true })
  b.wall('opening', living, 2, 240, { width: 120 })
  b.wall('opening', living, 1, 200, { width: 100 })
  b.wall('door', kitchen, 2, 135)
  b.wall('door', bath, 2, 90, { width: 80 })
  b.wall('door', storage, 3, 95, { width: 70 })
  b.wall('door', bed1, 0, 250, { flipX: true })
  b.wall('door', bed2, 0, 60)
  b.wall('door', bed3, 0, 70)
  b.wall('window-wide', living, 0, 150)
  b.wall('window', living, 3, 225)
  b.wall('window', kitchen, 0, 135)
  b.wall('window', bath, 1, 125, { width: 60 })
  b.wall('window', bed1, 2, 160)
  b.wall('window', bed2, 2, 145)
  b.wall('window', bed3, 2, 160)
  b.item('sofa', 240, 380, { rotation: 180 })
  b.item('coffee-table', 240, 280)
  b.item('tv-unit', 360, 30)
  b.item('armchair', 70, 280, { rotation: 90 })
  b.item('plant', 440, 40)
  b.item('counter', 655, 30, { width: 170 })
  b.item('stove', 540, 30)
  b.item('kitchen-sink', 680, 30)
  b.item('fridge', 725, 410, { rotation: 180 })
  b.item('dining-table', 625, 250)
  b.item('shower', 905, 245)
  b.item('toilet', 800, 240)
  b.item('washbasin', 805, 330, { rotation: 90 })
  b.item('bed-double', 160, 860, { rotation: 180 })
  b.item('nightstand', 55, 935)
  b.item('nightstand', 265, 935)
  b.item('wardrobe', 30, 680, { rotation: 90 })
  b.item('bed-single', 560, 860, { rotation: 180 })
  b.item('desk', 420, 930, { rotation: 180 })
  b.item('bed-double', 850, 860, { rotation: 180 })
  b.item('wardrobe', 660, 800, { rotation: 90 })
  return b.floor()
}

const WARM: LightSettings = { color: 'warm', brightness: 1 }
const COOL: LightSettings = { color: 'cool', brightness: 1 }

/**
 * The example apartment opened on a first visit: big enough to show most of what the app can do. Open-plan living,
 * kitchen and dining with an island, a main bedroom with a dressing room and an en-suite, a kids room, a bathroom and
 * a balcony; floor and wall finishes, gypsum ceilings with hidden lights, lights wired to switches, people for scale.
 */
function example(): Floor {
  const b = builder()
  const living = b.room('Living room', C.living, 0, 0, 560, 520)
  const kitchen = b.room('Kitchen & dining', C.kitchen, 570, 0, 580, 520)
  const hall = b.room('Hallway', C.hall, 0, 530, 1150, 140)
  const bed = b.room('Main bedroom', C.bed, 0, 680, 420, 420)
  const dress = b.room('Dressing room', C.storage, 430, 680, 200, 200)
  const ensuite = b.room('En-suite', C.bath, 430, 890, 200, 210)
  const kids = b.room('Kids room', C.bed2, 640, 680, 280, 420)
  const bath = b.room('Bathroom', C.bath, 930, 680, 220, 420)
  const balcony = b.outdoor('Balcony', 'balcony', 60, -170, 440, 160)

  // Finishes.
  const oak = { finish: 'hdf' as const, color: '#c9a27a' }
  living.floor = { finish: 'parquet', color: '#b88a5a', pattern: 'herringbone' }
  living.walls = { finish: 'paint', color: '#ebe4d6' }
  living.wallFinishes = [null, null, null, { finish: 'slats', color: '#6a4a32' }]
  kitchen.floor = { finish: 'porcelain', color: '#c6c5c1', size: [60, 120], pattern: 'offset' }
  kitchen.walls = { finish: 'paint', color: '#f3f1ec' }
  kitchen.wallFinishes = [{ finish: 'porcelain', color: '#ebe9e5', size: [7.5, 30], height: 150, above: '#f3f1ec' }]
  hall.floor = { finish: 'marble', color: '#f1f0ed', size: [60, 60] }
  hall.walls = { finish: 'paint', color: '#cfc5b6' }
  bed.floor = oak
  bed.walls = { finish: 'paint', color: '#ebe4d6' }
  bed.wallFinishes = [null, null, null, { finish: 'wallpaper', color: '#a9b49c', design: 'botanical' }]
  dress.floor = oak
  dress.walls = { finish: 'paint', color: '#ebe4d6' }
  ensuite.floor = { finish: 'marble', color: '#e8dbc1', size: [60, 60] }
  ensuite.walls = { finish: 'porcelain', color: '#9c958d', size: [60, 120] }
  kids.floor = { finish: 'carpet', color: '#d8c7a8' }
  kids.walls = { finish: 'paint', color: '#9db0bf' }
  kids.wallFinishes = [null, null, null, { finish: 'wallpaper', color: '#ece3cf', design: 'geometric' }]
  bath.floor = { finish: 'porcelain', color: '#4a4c4f', size: [60, 60] }
  bath.walls = { finish: 'ceramic', color: '#efece6', size: [10, 30], height: 120, above: '#9db0bf' }
  balcony.floor = { finish: 'porcelain', color: '#b48a62', size: [20, 120] }

  // Doors, windows and openings.
  b.wall('door', hall, 1, 70, { width: 100 })
  b.wall('door-alu-sliding', living, 0, 280, { width: 240 })
  b.wall('window', living, 3, 430, { width: 100 })
  b.wall('opening', living, 1, 270, { width: 300 })
  b.wall('door-double', living, 2, 280, { width: 140 })
  b.wall('window', kitchen, 0, 300, { width: 110 })
  b.wall('window-wide', kitchen, 1, 390, { width: 180 })
  b.wall('opening', hall, 0, 870, { width: 100 })
  b.wall('door', bed, 0, 360, { flipX: true })
  b.wall('window-wide', bed, 2, 210, { width: 180 })
  b.wall('door-barn', dress, 3, 100, { width: 80 })
  b.wall('door', ensuite, 3, 100, { width: 80 })
  b.wall('door', kids, 0, 60)
  b.wall('window', kids, 2, 100, { width: 120 })
  b.wall('door', bath, 0, 60, { width: 80 })
  b.wall('window', bath, 1, 240, { width: 80 })
  b.wall('shower-niche', ensuite, 1, 45, { width: 40, height: 50, elevation: 110, shelf: true, led: true, light: COOL })
  b.wall('shower-niche', bath, 2, 110, { width: 60, height: 30, elevation: 70 })

  // Living room: a corner sofa facing the TV on a slatted wall, a column built into the wall by the balcony.
  b.item('tv-unit', 22.5, 330, { rotation: 270, width: 200 })
  b.item('tv', 4, 330, { rotation: 270, width: 140, elevation: 105 })
  b.item('sofa-corner', 340, 330, { rotation: 90 })
  b.item('sofa-table', 460, 330, { rotation: 90 })
  b.item('coffee-table', 150, 330, { rotation: 90 })
  b.item('armchair', 90, 115, { rotation: 345 })
  b.item('plant', 520, 475)
  b.item('plant', 40, 480, { width: 40, depth: 40 })
  b.item('wall-post', 545, 10)
  b.item('curtain', 280, 7.5, { width: 300 })
  b.item('ac-split', 75, 11)
  b.item('person', 330, 300, { pose: 'sit', frame: '#b5543f' })

  // Kitchen & dining: tall units, a run under the window, an island with a hob and its hood, a table for six.
  b.item('fridge', 610, 35)
  b.item('oven-tower', 680, 30)
  b.item('counter', 770, 30)
  b.item('kitchen-sink', 870, 30)
  b.item('dishwasher', 940, 30)
  b.item('counter', 1060, 30, { width: 180 })
  const uppers = [
    b.item('wall-cabinet', 760, 17.5, { width: 100, led: true, light: WARM }),
    b.item('wall-cabinet', 990, 17.5, { width: 120, fronts: 'glass', led: true, light: WARM }),
    b.item('wall-cabinet', 1100, 17.5, { width: 100, led: true, light: WARM }),
  ]
  b.item('kitchen-island', 900, 250, { width: 220, islandTop: 'hob' })
  const hood = b.item('range-hood', 900, 235, { style: 'island', led: true, light: WARM })
  b.item('dining-table', 680, 380, { rotation: 90, width: 180 })
  b.item('coffee-corner', 1070, 495, { rotation: 180, style: 'modern', led: true, light: WARM })
  b.item('blind', 1146, 390, { rotation: 90, width: 190 })
  b.item('ac-cassette', 1060, 420)
  b.item('person', 900, 160, { frame: '#ecebe6' })
  b.item('person', 973, 300, { pose: 'sit', height: 165, width: 42 })

  // Hallway.
  b.item('sideboard', 600, 552.5, { width: 160 })
  b.item('plant', 40, 570, { width: 40, depth: 40 })

  // Main bedroom: the bed against a wallpapered wall, a TV between the doors to the dressing room and en-suite.
  b.item('bed-double', 105, 890, { rotation: 270, width: 180, depth: 210 })
  b.item('nightstand', 20, 770, { rotation: 270 })
  b.item('nightstand', 20, 1010, { rotation: 270 })
  b.item('tv', 416, 890, { rotation: 90, width: 110, elevation: 110 })
  b.item('armchair', 345, 1035, { rotation: 135, width: 75, depth: 75 })
  b.item('curtain', 210, 1092.5, { rotation: 180, width: 240 })
  b.item('ac-split', 150, 691)
  b.item('person', 105, 890, { pose: 'lie', frame: '#4f6f9c' })

  // Dressing room and en-suite.
  b.item('wardrobe', 530, 710, { width: 200, doors: 'sliding', glass: true })
  b.item('dressing-table', 607.5, 820, { rotation: 90, style: 'hollywood', led: true, light: WARM })
  b.item('person', 570, 820, { pose: 'sit', height: 168, width: 42 })
  b.item('shower', 585, 935)
  b.item('toilet', 600, 1067.5, { rotation: 180 })
  b.item('bath-vanity', 515, 1076, { rotation: 180, width: 100, led: true, light: COOL })
  b.item('towel-radiator', 480, 895)

  // Kids room.
  b.item('bed-single', 690, 900)
  b.item('desk', 820, 1070, { rotation: 180 })
  b.item('chair', 820, 1015)
  b.item('wardrobe', 890, 780, { rotation: 90 })
  b.item('bookshelf', 902.5, 930, { rotation: 90 })
  b.item('blind', 820, 1096, { rotation: 180, width: 130 })
  b.item('person', 800, 900, { height: 115, width: 30, frame: '#b5543f' })

  // Bathroom.
  b.item('bathtub', 1040, 1062.5, { rotation: 180 })
  b.item('toilet', 1117.5, 800, { rotation: 90 })
  b.item('bath-vanity', 954, 900, { rotation: 270, width: 120, sinks: 2, style: 'vessel' })
  b.item('towel-rail', 1145, 1000, { rotation: 90 })
  b.item('towel-radiator', 935, 1000, { rotation: 270 })

  // Balcony.
  b.item('round-table', 180, -90, { width: 70, depth: 70 })
  b.item('plant', 90, -135)
  b.item('ac-outdoor', 440, -26, { rotation: 180 })

  // Ceilings and lighting.
  b.ceiling(living, 'cove')
  living.curtainPockets = [0]
  const cove = b.roomLight('cove-light', living)
  const pocket = b.roomLight('pocket-light', living)
  const livingSpots = [
    [150, 170],
    [380, 170],
    [150, 420],
    [380, 420],
  ].map(([x, y]) => b.item('spot', x, y))
  const tvLights = [b.item('wall-light', 7.5, 190, { rotation: 270 }), b.item('wall-light', 7.5, 470, { rotation: 270 })]

  b.ceiling(kitchen, 'flat')
  kitchen.shadowGaps = [0, 1, 2, 3]
  const gap = b.roomLight('gap-light', kitchen)
  const kitchenSpots = [700, 820, 940, 1060].map((x) => b.item('spot', x, 100))
  const diningLight = b.item('linear-pendant', 680, 380, { rotation: 90, width: 140 })

  b.ceiling(hall, 'flat')
  const hallSpots = [150, 400, 650, 900].map((x) => b.item('spot', x, 600))
  const hallLight = b.item('wall-light', 600, 537.5, { elevation: 170 })

  b.ceiling(bed, 'tray')
  bed.curtainPockets = [2]
  const bedCove = b.roomLight('cove-light', bed)
  const bedPocket = b.roomLight('pocket-light', bed)
  const chandelier = b.item('chandelier', 210, 890, { style: 'led-rings' })
  const sconces = [b.item('wall-light', 7.5, 770, { rotation: 270, elevation: 140 }), b.item('wall-light', 7.5, 1010, { rotation: 270, elevation: 140 })]
  const dressSpots = [b.item('spot', 490, 800), b.item('spot', 570, 800)]

  b.ceiling(ensuite, 'flat')
  const ensuiteSpots = [b.item('spot', 480, 960, { light: COOL }), b.item('spot', 560, 1040, { light: COOL })]
  const kidsLight = b.item('pendant', 780, 890, { style: 'drum' })
  b.ceiling(bath, 'flat')
  const bathSpots = [b.item('spot', 1040, 800, { light: COOL }), b.item('spot', 1040, 960, { light: COOL })]

  b.switch('Spots', 375, 510, 180, livingSpots)
  b.switch('Mood', 395, 510, 180, [cove, ...tvLights])
  b.switch('Curtains', 415, 510, 180, [pocket])
  b.switch('Kitchen', 800, 510, 180, [...kitchenSpots, ...uppers, hood])
  b.switch('Dining', 780, 510, 180, [diningLight, gap])
  b.switch('Hall', 1140, 645, 90, [...hallSpots, hallLight])
  b.switch('Bedroom', 290, 690, 0, [chandelier, bedCove])
  b.switch('Curtains', 270, 690, 0, [bedPocket])
  b.switch('Bedside', 10, 735, 270, sconces)
  b.switch('Dressing', 440, 850, 270, dressSpots)
  b.switch('En-suite', 440, 945, 270, ensuiteSpots)
  b.switch('Kids', 770, 690, 0, [kidsLight])
  b.switch('Bath', 1045, 690, 0, bathSpots)

  // Overall size.
  b.dimension({ x: -10, y: 1110 }, { x: 1160, y: 1110 }, -60)
  b.dimension({ x: 1160, y: -10 }, { x: 1160, y: 1110 }, 60)
  return b.floor()
}

export interface Template {
  id: string
  name: string
  build: () => Floor
}

export const TEMPLATES: Template[] = [
  { id: 'example', name: 'Example apartment', build: example },
  { id: 'studio', name: 'Studio', build: studio },
  { id: 'one-bed', name: '1-bedroom flat', build: oneBed },
  { id: 'two-bed', name: '2-bedroom flat', build: twoBed },
  { id: 'house', name: 'Family house', build: house },
]

export function projectFromTemplate(tpl: Template): Project {
  const p = newProject(t(tpl.name))
  p.floors = [tpl.build()]
  return p
}
