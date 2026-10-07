/**
 * The interior design suggestions (see model/design): the options last used (kept between visits), the wizard's state,
 * and designing a single room straight away from its properties.
 */
import { create } from 'zustand'
import { applyDesigns, designRoom, guessUses, isFurnished, upgradeOptions } from '@/model/design'
import type { DesignOptions } from '@/model/design'
import type { RoomUse } from '@/model/types'
import { currentFloor, draftFloor, useEditor } from './editor'

const KEY = 'planbreeze.design'

function saved(): DesignOptions {
  try {
    return upgradeOptions(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return upgradeOptions({})
  }
}

/** A room in the wizard: whether it's designed, and what it's for. */
export interface RoomChoice {
  on: boolean
  use: RoomUse
}

interface DesignState {
  opts: DesignOptions
  open: boolean
  rooms: Record<string, RoomChoice>
  /** Which idea each room is on (another idea is the next). */
  variants: Record<string, number>
  setOpts: (patch: Partial<DesignOptions>) => void
  setRoom: (id: string, patch: Partial<RoomChoice>) => void
  close: () => void
}

export const useDesign = create<DesignState>((set, get) => ({
  opts: saved(),
  open: false,
  rooms: {},
  variants: {},
  setOpts: (patch) => {
    const opts = { ...get().opts, ...patch }
    try {
      localStorage.setItem(KEY, JSON.stringify(opts))
    } catch {
      // Private browsing: they're only remembered for now.
    }
    set({ opts })
  },
  setRoom: (id, patch) => set((s) => ({ rooms: { ...s.rooms, [id]: { ...s.rooms[id], ...patch } } })),
  close: () => set({ open: false }),
}))

/**
 * Open the wizard on the current floor: each room with its use (as set, or a guess) and designed unless it's
 * furnished already (all of them, if every one is).
 */
export function openDesign() {
  const floor = currentFloor(useEditor.getState())
  const uses = guessUses(floor)
  const rooms = floor.rooms.filter((r) => r.points.length >= 3 && uses.has(r.id))
  const empty = rooms.filter((r) => !isFurnished(floor, r))
  const pick = empty.length ? new Set(empty.map((r) => r.id)) : new Set(rooms.map((r) => r.id))
  useDesign.setState({
    open: true,
    variants: {},
    rooms: Object.fromEntries(rooms.map((r) => [r.id, { on: pick.has(r.id), use: uses.get(r.id)! }])),
  })
}

/** Design one room now, as one undo step: the next idea for it each time. */
export function redesignRoom(roomId: string) {
  const st = useEditor.getState()
  const floor = currentFloor(st)
  const room = floor.rooms.find((r) => r.id === roomId)
  if (!room) return
  const uses = guessUses(floor)
  const use = uses.get(room.id)
  if (!use) return
  const { opts, variants } = useDesign.getState()
  const variant = roomId in variants ? variants[roomId] + 1 : 0
  const design = designRoom(floor, room, use, uses, opts, variant)
  st.commit((d) => applyDesigns(draftFloor(d), [design]))
  useDesign.setState({ variants: { ...variants, [roomId]: variant } })
}
