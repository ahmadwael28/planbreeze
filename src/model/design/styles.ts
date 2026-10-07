/** Design styles: the floors, walls, cabinets, curtains and light fittings that go together in each. */
import type { RoomFloor, WallSurface } from '../types'

export type StyleId = 'modern' | 'scandinavian' | 'japandi' | 'classic' | 'industrial'

export interface DesignStyle {
  id: StyleId
  name: string
  hint: string
  /** A few of its colors, to show it by. */
  swatches: string[]
  floors: {
    /** Living, dining and the hallway. */
    main: RoomFloor
    hall: RoomFloor
    bedroom: RoomFloor
    kids: RoomFloor
    kitchen: RoomFloor
    wet: RoomFloor
    outdoor: RoomFloor
  }
  paint: { main: string; bedroom: string; kids: string }
  /** The wall behind the TV, and behind the master bed. */
  tvWall: WallSurface
  bedWall: WallSurface
  bathWalls: WallSurface
  ensuiteWalls: WallSurface
  /** Behind the kitchen counters. */
  splash: WallSurface
  /** Kitchen and vanity cabinets (one of the vanity finishes). */
  cabinets: string
  curtain: string
  hood: string
  pendant: string
  chandelier: string
  dressing: string
  vanity: string
}

const WOOD_LOOK: RoomFloor = { finish: 'porcelain', color: '#b48a62', size: [20, 120] }

export const DESIGN_STYLES: DesignStyle[] = [
  {
    id: 'modern',
    name: 'Modern',
    hint: 'Large pale tiles, warm oak in the bedrooms, a walnut slatted TV wall',
    swatches: ['#c6c5c1', '#f3f1ec', '#c9a27a', '#6a4a32'],
    floors: {
      main: { finish: 'porcelain', color: '#c6c5c1', size: [60, 120], pattern: 'offset' },
      hall: { finish: 'porcelain', color: '#c6c5c1', size: [60, 120], pattern: 'offset' },
      bedroom: { finish: 'hdf', color: '#c9a27a' },
      kids: { finish: 'hdf', color: '#dcc09b' },
      kitchen: { finish: 'porcelain', color: '#c6c5c1', size: [60, 120], pattern: 'offset' },
      wet: { finish: 'porcelain', color: '#9c958d', size: [60, 60] },
      outdoor: WOOD_LOOK,
    },
    paint: { main: '#f3f1ec', bedroom: '#ebe4d6', kids: '#9db0bf' },
    tvWall: { finish: 'slats', color: '#6a4a32' },
    bedWall: { finish: 'wallpaper', color: '#9aa8b3', design: 'linen' },
    bathWalls: { finish: 'porcelain', color: '#c6c5c1', size: [60, 120] },
    ensuiteWalls: { finish: 'porcelain', color: '#9c958d', size: [60, 120] },
    splash: { finish: 'porcelain', color: '#ebe9e5', size: [7.5, 30], height: 150, above: '#f3f1ec' },
    cabinets: '#f4f3ef',
    curtain: '#d9cfbf',
    hood: 'pyramid',
    pendant: 'dome',
    chandelier: 'led-rings',
    dressing: 'round',
    vanity: 'integrated',
  },
  {
    id: 'scandinavian',
    name: 'Scandinavian',
    hint: 'White oak, soft whites and sage, light oak cabinets',
    swatches: ['#e2d5c2', '#f3f1ec', '#a7b39e', '#c19a6b'],
    floors: {
      main: { finish: 'hdf', color: '#e2d5c2' },
      hall: { finish: 'hdf', color: '#e2d5c2' },
      bedroom: { finish: 'hdf', color: '#e2d5c2' },
      kids: { finish: 'hdf', color: '#e2d5c2' },
      kitchen: { finish: 'porcelain', color: '#ebe9e5', size: [60, 60] },
      wet: { finish: 'ceramic', color: '#efece6', size: [30, 30] },
      outdoor: WOOD_LOOK,
    },
    paint: { main: '#f3f1ec', bedroom: '#ebe4d6', kids: '#dcb9ad' },
    tvWall: { finish: 'slats', color: '#d8bd96' },
    bedWall: { finish: 'paint', color: '#a7b39e' },
    bathWalls: { finish: 'ceramic', color: '#efece6', size: [10, 30], height: 120, above: '#f3f1ec' },
    ensuiteWalls: { finish: 'ceramic', color: '#9fae98', size: [10, 30], height: 120, above: '#f3f1ec' },
    splash: { finish: 'ceramic', color: '#efece6', size: [7.5, 15], height: 150, above: '#f3f1ec' },
    cabinets: '#c19a6b',
    curtain: '#efe9df',
    hood: 'box',
    pendant: 'globe',
    chandelier: 'sputnik',
    dressing: 'round',
    vanity: 'vessel',
  },
  {
    id: 'japandi',
    name: 'Japandi',
    hint: 'Natural oak, warm microcement, walnut cabinets, calm greige walls',
    swatches: ['#c9a27a', '#b8aa98', '#cfc5b6', '#6e4b33'],
    floors: {
      main: { finish: 'hdf', color: '#c9a27a' },
      hall: { finish: 'hdf', color: '#c9a27a' },
      bedroom: { finish: 'hdf', color: '#c9a27a' },
      kids: { finish: 'hdf', color: '#c9a27a' },
      kitchen: { finish: 'concrete', color: '#b8aa98' },
      wet: { finish: 'concrete', color: '#b8aa98' },
      outdoor: WOOD_LOOK,
    },
    paint: { main: '#ebe4d6', bedroom: '#cfc5b6', kids: '#a7b39e' },
    tvWall: { finish: 'slats', color: '#c09466' },
    bedWall: { finish: 'wallpaper', color: '#ece3cf', design: 'linen' },
    bathWalls: { finish: 'concrete', color: '#b8aa98' },
    ensuiteWalls: { finish: 'concrete', color: '#b8aa98' },
    splash: { finish: 'porcelain', color: '#e5dbca', size: [7.5, 30], height: 150, above: '#ebe4d6' },
    cabinets: '#6e4b33',
    curtain: '#d9cfbf',
    hood: 'box',
    pendant: 'drum',
    chandelier: 'led-rings',
    dressing: 'classic',
    vanity: 'vessel',
  },
  {
    id: 'classic',
    name: 'Classic',
    hint: 'Oak herringbone, marble, sage cabinets, crystal and lanterns',
    swatches: ['#b88a5a', '#f1f0ed', '#93a28a', '#cfc5b6'],
    floors: {
      main: { finish: 'parquet', color: '#b88a5a', pattern: 'herringbone' },
      hall: { finish: 'marble', color: '#e8dbc1', size: [60, 60] },
      bedroom: { finish: 'parquet', color: '#b88a5a', pattern: 'herringbone' },
      kids: { finish: 'carpet', color: '#cbbfad' },
      kitchen: { finish: 'marble', color: '#e1d0b2', size: [60, 60] },
      wet: { finish: 'marble', color: '#f1f0ed', size: [60, 60] },
      outdoor: WOOD_LOOK,
    },
    paint: { main: '#ebe4d6', bedroom: '#cfc5b6', kids: '#9db0bf' },
    tvWall: { finish: 'marble', color: '#f3eee5', size: [60, 120] },
    bedWall: { finish: 'wallpaper', color: '#a9b49c', design: 'botanical' },
    bathWalls: { finish: 'marble', color: '#f1f0ed', size: [30, 60] },
    ensuiteWalls: { finish: 'marble', color: '#e8dbc1', size: [60, 120] },
    splash: { finish: 'marble', color: '#f1f0ed', size: [30, 60], height: 150, above: '#ebe4d6' },
    cabinets: '#93a28a',
    curtain: '#c9b79c',
    hood: 'mantel',
    pendant: 'bell',
    chandelier: 'crystal',
    dressing: 'classic',
    vanity: 'integrated',
  },
  {
    id: 'industrial',
    name: 'Industrial',
    hint: 'Microcement, smoked oak, black cabinets and steel, dark accents',
    swatches: ['#c9c7c2', '#7e6a57', '#2c2c2e', '#48494b'],
    floors: {
      main: { finish: 'concrete', color: '#c9c7c2' },
      hall: { finish: 'concrete', color: '#c9c7c2' },
      bedroom: { finish: 'hdf', color: '#7e6a57' },
      kids: { finish: 'hdf', color: '#a39a8f' },
      kitchen: { finish: 'concrete', color: '#c9c7c2' },
      wet: { finish: 'porcelain', color: '#4a4c4f', size: [60, 60] },
      outdoor: WOOD_LOOK,
    },
    paint: { main: '#c8cacb', bedroom: '#c8cacb', kids: '#9db0bf' },
    tvWall: { finish: 'slats', color: '#2a2a2b' },
    bedWall: { finish: 'paint', color: '#48494b' },
    bathWalls: { finish: 'ceramic', color: '#a9a8a3', size: [10, 30], height: 120, above: '#c8cacb' },
    ensuiteWalls: { finish: 'porcelain', color: '#4a4c4f', size: [60, 120] },
    splash: { finish: 'ceramic', color: '#a9a8a3', size: [7.5, 15], height: 150, above: '#c8cacb' },
    cabinets: '#2c2c2e',
    curtain: '#4b5563',
    hood: 'box',
    pendant: 'cone',
    chandelier: 'sputnik',
    dressing: 'hollywood',
    vanity: 'vessel',
  },
]

export const styleById = (id: string | undefined) => DESIGN_STYLES.find((s) => s.id === id) ?? DESIGN_STYLES[0]
