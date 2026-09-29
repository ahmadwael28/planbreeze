// All lengths are stored in centimeters. Y axis points down (screen convention).

export interface Point {
  x: number
  y: number
}

export type Units = 'metric' | 'imperial'

/** Gypsum board (drop) ceiling styles. */
export type CeilingStyle = 'flat' | 'tray' | 'cove' | 'floating' | 'stepped'

export interface Ceiling {
  style: CeilingStyle
  /** How far the gypsum hangs below the structural ceiling. */
  drop: number
  /** Width of the bulkhead band along the walls (or the gap around a floating panel). */
  band: number
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

export type Tool = 'select' | 'room' | 'rect' | 'pan' | 'dimension' | 'wire'

/** What the 2D plan emphasizes: furniture layout, or the ceiling & lighting plan. */
export type PlanLayer = 'plan' | 'lighting'

export interface View {
  panX: number
  panY: number
  zoom: number
}
