import { CEILING_STYLES } from './lighting'
import { newFloor, newProject, newSymbol, rectPoints, uid } from './project'
import type { CeilingStyle, Floor, PlanSymbol, Project, Room } from './types'

const WALL = 10

/** Small DSL for describing a furnished floor. */
function builder() {
  const rooms: Room[] = []
  const symbols: PlanSymbol[] = []
  return {
    room(name: string, color: string, x: number, y: number, w: number, h: number) {
      const r: Room = { id: uid(), name, points: rectPoints(x, y, w, h), wallThickness: WALL, color }
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
    floor(name = 'Ground floor'): Floor {
      return { ...newFloor(name), rooms, symbols }
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

export interface Template {
  id: string
  name: string
  build: () => Floor
}

export const TEMPLATES: Template[] = [
  { id: 'studio', name: 'Studio', build: studio },
  { id: 'one-bed', name: '1-bedroom flat', build: oneBed },
  { id: 'two-bed', name: '2-bedroom flat', build: twoBed },
  { id: 'house', name: 'Family house', build: house },
]

export function projectFromTemplate(t: Template): Project {
  const p = newProject(t.name)
  p.floors = [t.build()]
  return p
}
