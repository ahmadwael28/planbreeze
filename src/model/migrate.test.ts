/** Plans as older versions of the app saved them, brought up to date; each step once, and newer plans left be. */
import { describe, expect, it } from 'vitest'
import { isNewer, isProject, STEPS, upgrade } from './migrate'
import { newFloor, newProject, newRoom, newSymbol, rectPoints, SCHEMA_VERSION } from './project'
import { projectFromTemplate, TEMPLATES } from './templates'
import type { PlanSymbol, Project } from './types'

/** A plan as saved before plans had a version: a bathroom (400 × 300 cm) with what's changed since in it. */
function beforeVersions(): Project {
  const p = newProject('Old plan')
  // (Neither a version nor the mark that its switches are named after their rooms.)
  delete p.schemaVersion
  delete p.switchNames
  const f = p.floors[0]
  const bath = newRoom(f, rectPoints(0, 0, 400, 300), 10)
  bath.name = 'Bathroom'
  f.rooms.push(bath)
  const at = (type: string, x: number, y: number, more: Partial<PlanSymbol> = {}) => {
    const s = { ...newSymbol(type, x, y), ...more }
    f.symbols.push(s)
    return s
  }
  at('bath-vanity', 100, 40, { style: 'vessel' })
  at('bath-vanity', 250, 40, { style: 'integrated' })
  at('shower-bench', 350, 150, { style: 'floating' })
  // Two hidden lights of a kind in the room, and a switch working the second.
  const a = at('cove-light', 200, 150, { room: bath.id })
  const b = at('cove-light', 200, 150, { room: bath.id })
  at('switch', 380, 5, { label: 'Cove', controls: [b.id] })
  void a
  // An outlet 20 cm off the far wall, from before outlets were on walls.
  at('outlet', 200, 280)
  return p
}

const symbols = (p: Project, type: string) => p.floors[0].symbols.filter((s) => s.type === type)

describe('upgrade', () => {
  it('has a step for each version', () => {
    expect(STEPS).toHaveLength(SCHEMA_VERSION)
    expect(newProject().schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('brings a plan from before versions up to date', () => {
    const old = beforeVersions()
    const p = upgrade(old)
    expect(p.schemaVersion).toBe(SCHEMA_VERSION)

    const [vessel, integrated] = symbols(p, 'bath-vanity')
    expect(vessel.style).toBeUndefined()
    expect(vessel.basin).toBe('vessel')
    expect(integrated.style).toBeUndefined()
    expect(integrated.basin).toBeUndefined()

    const [bench] = symbols(p, 'shower-bench')
    expect(bench.style).toBeUndefined()
    expect(bench.floating).toBe(true)

    // One cove light, and the switch works it.
    const coves = symbols(p, 'cove-light')
    expect(coves).toHaveLength(1)
    const [sw] = symbols(p, 'switch')
    expect(sw.controls).toEqual([coves[0].id])
    expect(sw.label).toBe('Bathroom Cove')
    expect(p.switchNames).toBe('room')

    // The outlet's on the wall now, flush with it.
    const [outlet] = symbols(p, 'outlet')
    expect(outlet.y + outlet.depth / 2).toBeCloseTo(300)

    // The plan it was given is as it was.
    expect(old.schemaVersion).toBeUndefined()
    expect(symbols(old, 'cove-light')).toHaveLength(2)
  })

  it('has nothing to do to a plan made now, from scratch or from a template', () => {
    for (const p of [newProject(), ...TEMPLATES.map(projectFromTemplate)]) {
      expect(STEPS.reduce((q, step) => step(q), p), p.name).toEqual(p)
    }
    // Template switches named after their rooms, as new ones are.
    const example = projectFromTemplate(TEMPLATES.find((t) => t.id === 'example')!)
    const f = example.floors[0]
    const labels = f.symbols.filter((s) => s.type === 'switch').map((s) => s.label)
    expect(labels).toContain('Living room Curtains')
    expect(labels).toContain('Main bedroom Curtains')
    expect(labels).toContain('Bathroom S1')
  })

  it('leaves a plan saved now as it is (each step runs once)', () => {
    const p = newProject()
    const f = p.floors[0]
    f.rooms.push(newRoom(f, rectPoints(0, 0, 400, 300), 10))
    // An outlet off the wall in a plan saved now: put there, not moved.
    f.symbols.push(newSymbol('outlet', 200, 150))
    expect(upgrade(p)).toBe(p)
  })

  it('leaves a plan from a newer version at its version', () => {
    const p = { ...beforeVersions(), schemaVersion: SCHEMA_VERSION + 1 }
    expect(isNewer(p)).toBe(true)
    const out = upgrade(p)
    expect(out.schemaVersion).toBe(SCHEMA_VERSION + 1)
    expect(symbols(out, 'cove-light')).toHaveLength(2)
    expect(isNewer(newProject())).toBe(false)
  })

  it('puts sizes that are fixed back to their standard ones, at any version', () => {
    const p = newProject()
    const sym = newSymbol('switch', 100, 100)
    p.floors[0].symbols.push({ ...sym, width: sym.width + 20 }, { ...newSymbol('spot', 50, 50), width: 10, depth: 14 })
    const [sw, spot] = upgrade(p).floors[0].symbols
    expect(sw.width).toBe(sym.width)
    // Round: as deep as it's wide.
    expect(spot.depth).toBe(10)
  })
})

describe('isProject', () => {
  it('knows a plan from what is not one', () => {
    expect(isProject(newProject())).toBe(true)
    expect(isProject({ ...newProject(), floors: [] })).toBe(false)
    expect(isProject({ floors: [{ ...newFloor('A'), rooms: undefined }] })).toBe(false)
    for (const x of [null, 3, 'plan', [], {}]) expect(isProject(x)).toBe(false)
  })
})
