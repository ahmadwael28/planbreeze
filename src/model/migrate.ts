/**
 * Plans saved by older versions of the app, brought up to date as they're opened.
 *
 * Each plan carries the version of the format it was saved in (`Project.schemaVersion`; none before there were
 * versions, read as 0). However a plan's opened (this browser's, the account's, a shared link, a file, a backup, a
 * template), it goes through `upgrade` (see the editor's loadProject): the steps it hasn't had run on it, in order,
 * once each, and it's saved at SCHEMA_VERSION (model/project) from then on. A new plan's made at it.
 *
 * A change to what's saved that older plans need to follow (a field renamed, a style that's become an option, items
 * that now stand somewhere else): add the next step to STEPS, doing to an older plan just what makes it as one saved
 * now would be, and SCHEMA_VERSION goes up by one. A step is a plain function of the plan (it may assume every earlier
 * step has run), and it's tested in model/migrate.test.ts with a plan as the older version saved it.
 */
import { produce } from 'immer'
import { mergeRoomLights, ROOM_LIGHTS } from './lighting'
import { SCHEMA_VERSION, wallMountPose } from './project'
import { fixSizes } from './sizes'
import { nameSwitchesAfterRooms } from './switches'
import type { PlanSymbol, Project } from './types'

type Step = (p: Project) => Project

/** A plan's vanities' basins (once their style) chosen apart from their style. */
function vanityBasins(p: Project): Project {
  const old = (s: PlanSymbol) => s.type === 'bath-vanity' && (s.style === 'vessel' || s.style === 'integrated')
  if (!p.floors.some((f) => f.symbols.some(old))) return p
  return produce(p, (d) => {
    for (const f of d.floors) {
      for (const s of f.symbols) {
        if (!old(s)) continue
        if (s.style === 'vessel') s.basin = 'vessel'
        delete s.style
      }
    }
  })
}

/** Floating shower benches (once a style of their own): built-in ones that float. */
function floatingBenches(p: Project): Project {
  const old = (s: PlanSymbol) => s.type === 'shower-bench' && s.style === 'floating'
  if (!p.floors.some((f) => f.symbols.some(old))) return p
  return produce(p, (d) => {
    for (const f of d.floors) {
      for (const s of f.symbols) {
        if (!old(s)) continue
        delete s.style
        s.floating = true
      }
    }
  })
}

/** Switches named after their rooms (see nameSwitchesAfterRooms); a plan that's had it done says so in `switchNames`. */
function switchNames(p: Project): Project {
  if (p.switchNames) return p
  return produce(p, (d) => {
    for (const f of d.floors) nameSwitchesAfterRooms(f)
    d.switchNames = 'room'
  })
}

/** Outlets from before they were mounted on walls: onto the wall they're by (flush, facing into the room). */
function wallOutlets(p: Project): Project {
  const moves: { f: number; i: number; pose: { x: number; y: number; rotation: number } }[] = []
  p.floors.forEach((f, fi) =>
    f.symbols.forEach((s, i) => {
      if (s.type !== 'outlet' || s.wall || s.room) return
      const pose = wallMountPose(s, f.rooms, s.depth / 2 + 15, s.depth)
      if (pose && (Math.abs(pose.x - s.x) > 0.05 || Math.abs(pose.y - s.y) > 0.05 || Math.abs(pose.rotation - s.rotation) > 0.05)) moves.push({ f: fi, i, pose })
    }),
  )
  if (!moves.length) return p
  return produce(p, (d) => {
    for (const m of moves) Object.assign(d.floors[m.f].symbols[m.i], m.pose)
  })
}

/** A room's extra hidden lights of a kind merged into its first (see mergeRoomLights). */
function roomLights(p: Project): Project {
  if (!p.floors.some((f) => f.symbols.some((s) => s.room && ROOM_LIGHTS.includes(s.type)))) return p
  return produce(p, (d) => {
    for (const f of d.floors) mergeRoomLights(f)
  })
}

/**
 * The steps, in order: STEPS[n] brings a plan saved at n up to n + 1. Version 1 is the first with a number: what was
 * done to every plan as it opened until then (each part a no-op on a plan that doesn't need it).
 */
export const STEPS: Step[] = [(p) => wallOutlets(vanityBasins(floatingBenches(switchNames(roomLights(p)))))]

/** Saved by a newer version of the app than this one (opened by a page that hasn't reloaded since an update). */
export const isNewer = (p: Project) => (p.schemaVersion ?? 0) > SCHEMA_VERSION

/** Whether it looks like a plan: floors, each with its rooms and items. */
export function isProject(x: unknown): x is Project {
  const p = x as Project
  return (
    !!p &&
    typeof p === 'object' &&
    Array.isArray(p.floors) &&
    p.floors.length > 0 &&
    p.floors.every((f) => !!f && Array.isArray(f.rooms) && Array.isArray(f.symbols))
  )
}

/**
 * A plan brought up to date: its sizes as the library has them now (see fixSizes; every time, as the library can
 * change), then the steps it hasn't had (a step that fails stops there, to be tried again the next time it's opened).
 * A plan from a newer version is left at its version.
 */
export function upgrade(p: Project): Project {
  let out = fixSizes(p)
  for (let v = p.schemaVersion ?? 0; v < SCHEMA_VERSION; v++) {
    try {
      out = { ...STEPS[v](out), schemaVersion: v + 1 }
    } catch (e) {
      console.error(`Couldn't bring the plan from version ${v} to ${v + 1}`, e)
      break
    }
  }
  return out
}
