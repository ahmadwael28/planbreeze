// All lengths are stored in centimeters. Y axis points down (screen convention).

export interface Point {
  x: number
  y: number
}

export type Units = 'metric' | 'imperial'

/** Gypsum board (drop) ceiling styles. */
export type CeilingStyle = 'flat' | 'tray' | 'cove' | 'floating' | 'stepped'

export type FloorFinish = 'ceramic' | 'porcelain' | 'marble' | 'hdf' | 'spc' | 'parquet' | 'carpet' | 'concrete'
export type WallFinish = 'paint' | 'wallpaper' | 'ceramic' | 'porcelain' | 'marble' | 'slats' | 'concrete'
export type Finish = FloorFinish | WallFinish
export type FloorPattern = 'straight' | 'offset' | 'diagonal' | 'herringbone' | 'chevron'

/** What a floor or wall is finished with (see model/finishes). */
export interface Surface {
  finish: Finish
  /** Its color (one of the finish's, or any). */
  color?: string
  /** A photo of the real thing (one of the project's `images`): one tile or plank, or a repeat of a wallpaper. */
  image?: string
  /** Tile sides, plank width × length, or the repeat of a wallpaper photo (cm). */
  size?: [number, number]
  pattern?: FloorPattern
  /** Turned a quarter: planks (or long tiles) run the other way. */
  turned?: boolean
  /** Wallpaper: its design. */
  design?: string
}

export interface RoomFloor extends Surface {
  finish: FloorFinish
}

export interface WallSurface extends Surface {
  finish: WallFinish
  /** Tiles or slats only up to this height (cm), painted above; to the ceiling if left out. */
  height?: number
  /** The paint above them. */
  above?: string
}

/** A photo the user added, to show a real tile, plank or wallpaper. */
export interface ProjectImage {
  id: string
  name: string
  /** Image data URL (scaled down). */
  src: string
  /** Its size in pixels. */
  w: number
  h: number
  /** Its average color, for the plan. */
  tone: string
}

export interface Ceiling {
  style: CeilingStyle
  /** How far the gypsum hangs below the structural ceiling. */
  drop: number
  /** Width of the bulkhead band along the walls (or the gap around a floating panel). */
  band: number
  /** A different band width on some walls (by wall index; null: the usual one), e.g. deeper over a wardrobe. */
  bands?: (number | null)[]
}

export interface Room {
  id: string
  name: string
  /** Interior outline of the room (straight walls only). */
  points: Point[]
  /** Walls are drawn outside the interior outline. */
  wallThickness: number
  color: string
  ceiling?: Ceiling
  /** Walls (edge indices) with a shadow gap: a recessed groove where the wall meets the ceiling. */
  shadowGaps?: number[]
  /** The floor's finish (tiles, planks…); without one, it's plain in the room's color. */
  floor?: RoomFloor
  /** The walls' finish (paint, wallpaper, tiles…) inside the room; without one, they're plain white. */
  walls?: WallSurface
  /** A different finish on some walls (by wall index; null: the room's), e.g. an accent wall or tiles behind a sink. */
  wallFinishes?: (WallSurface | null)[]
  /** At a column built into a wall, shadow gaps go around it (default) or stop at it. */
  gapsAtColumns?: 'wrap' | 'stop'
  /** Walls with a curtain pocket: the gypsum ceiling stops short of them, so curtain tracks hide up in the gap. */
  curtainPockets?: number[]
  /** How wide the curtain pockets are (cm). */
  pocketWidth?: number
  /**
   * Worked out by `ceilingRoom`, not saved: walls where the gypsum ceiling stops short of the wall for its hidden
   * light, and how far.
   */
  hiddenGaps?: number[]
  hiddenGapWidth?: number
  /** An outdoor space: a railing (or nothing) instead of walls, none where it meets the building, and no ceiling. */
  kind?: OutdoorKind
  railing?: Railing
  /** Items with the same group id are selected and moved together. */
  groupId?: string
}

export type OutdoorKind = 'balcony' | 'terrace'

export type RailingStyle = 'glass' | 'metal' | 'solid' | 'none'

export interface Railing {
  style: RailingStyle
  /** Height above the balcony floor. */
  height: number
}

/** Where a room's hidden LED strip runs. */
export interface CoveSettings {
  /** In a tray or stepped ceiling: along the walls (default) or on the inner edge of the band, lighting the raised middle. */
  at?: 'walls' | 'inner'
  /** Walls (edge indices) left without light. */
  off?: number[]
  /** At a column built into a wall: go around it (default) or stop at it. */
  columns?: 'wrap' | 'stop'
  /** Along the walls of a gypsum ceiling: how wide the gap between the gypsum and the wall it's in (cm). */
  gap?: number
}

export type LightColor = 'warm' | 'white' | 'cool'

export interface LightSettings {
  color: LightColor
  /** 0.1 – 1 */
  brightness: number
}

/** A module clipped into a magnetic track. */
export interface TrackModule {
  id: string
  kind: 'spot' | 'linear' | 'grille'
  /** Center position along the track, from its left end (cm). */
  offset: number
}

/** A user-placed dimension line between two points. */
export interface Dimension {
  id: string
  groupId?: string
  a: Point
  b: Point
  /** Distance of the dimension line from a–b, to the left of a→b (cm). */
  offset: number
}

/** Attachment of a door/window to a room wall. */
export interface WallAttachment {
  roomId: string
  /** Edge index: points[edge] -> points[edge + 1]. */
  edge: number
  /** Distance of the symbol center from the edge start, along the edge. */
  offset: number
}

export interface PlanSymbol {
  id: string
  type: string
  groupId?: string
  /** For a room's hidden LED strip: where it runs. */
  cove?: CoveSettings
  /** Center position (ignored while attached to a wall). */
  x: number
  y: number
  width: number
  depth: number
  height: number
  /** Degrees, clockwise. */
  rotation: number
  flipX: boolean
  flipY: boolean
  label?: string
  wall?: WallAttachment
  /** Height of the bottom of the symbol above the floor (e.g. window sill, pendant lamp). */
  elevation?: number
  /** Light fixtures: color and brightness. */
  light?: LightSettings
  /** Switches: ids of the lights they control. */
  controls?: string[]
  /** Cove / hidden lights: the room whose ceiling they run around. */
  room?: string
  /** Showers and wardrobes: hinged or sliding doors (each has its default). */
  doors?: 'hinged' | 'sliding'
  /** Wardrobes and cabinets: glass doors. */
  glass?: boolean
  /** Cabinets (display cabinet, sideboard, coffee corner): LED lighting inside, set like a light (`light`). */
  led?: boolean
  /** A style of an item that comes in several (pendant lights: see PENDANT_STYLES). */
  style?: string
  /** Curtains and blinds: the fabric (sheer, curtain or blackout; a blind's screen or blackout). */
  fabric?: 'sheer' | 'curtain' | 'blackout' | 'screen'
  /** Curtains: a sheer layer behind (older plans; now in `layers`). */
  sheer?: boolean
  /** Curtains: which layers hang on the track, any of sheer, blackout and curtain. */
  layers?: ('sheer' | 'curtain' | 'blackout')[]
  /** Curtains and blinds: how far open (0 closed … 1 drawn back, or a blind rolled up). */
  open?: number
  /** Curtains: which way they open, to both sides (two panels) or to one side (one panel across). */
  openSide?: 'both' | 'left' | 'right'
  /** Showers: the sides with glass (front, back, left, right); left out, the sides not against a wall. */
  screens?: ('front' | 'back' | 'left' | 'right')[]
  /** Frame / trim color (hex) for items that come in several finishes: spots, tracks, aluminium doors. */
  frame?: string
  /** Magnetic tracks: the modules clipped into them. */
  modules?: TrackModule[]
}

/** A reference drawing shown behind the plan for tracing (not exported). */
export interface Underlay {
  /** Image data URL. */
  src: string
  /** Top-left corner and size in cm. */
  x: number
  y: number
  width: number
  height: number
  opacity: number
  visible: boolean
  /** Degrees, clockwise about the image's center (squares up a photo taken at a slight angle). */
  rotation?: number
}

export interface Floor {
  id: string
  name: string
  /** Wall height, used for 3D. */
  height: number
  rooms: Room[]
  symbols: PlanSymbol[]
  dimensions?: Dimension[]
  underlay?: Underlay
  /** Camera spots saved in 3D. */
  views?: SavedView[]
}

/** A 3D camera spot saved by the user: plan position (cm) and height above this floor's level. */
export interface SavedView {
  id: string
  groupId?: string
  name: string
  eye: { x: number; y: number; h: number }
  /** A point the camera looks at. */
  look: { x: number; y: number; h: number }
}

export interface Project {
  id: string
  name: string
  units: Units
  defaultWallThickness: number
  floors: Floor[]
  /** Photos of real tiles and wallpapers, used as finishes. */
  images?: ProjectImage[]
  createdAt: number
  updatedAt: number
}

export interface Pose {
  x: number
  y: number
  rotation: number
}

export type Selection =
  | { kind: 'room'; id: string; vertex?: number }
  | { kind: 'symbol'; id: string }
  | { kind: 'dimension'; id: string }
  | { kind: 'view'; id: string }
  | { kind: 'multi'; items: ItemRef[] }

export type ItemKind = 'room' | 'symbol' | 'dimension' | 'view'

/** One thing on a floor, for selecting several at once. */
export interface ItemRef {
  kind: ItemKind
  id: string
}

export type Tool = 'select' | 'area' | 'room' | 'rect' | 'balcony' | 'terrace' | 'pan' | 'dimension' | 'wire'

/** What the 2D plan emphasizes: furniture layout, or the ceiling & lighting plan. */
export type PlanLayer = 'plan' | 'lighting'

export interface View {
  panX: number
  panY: number
  zoom: number
}
