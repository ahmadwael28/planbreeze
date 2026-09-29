import { projectFromTemplate, TEMPLATES } from './templates'
import type { Project } from './types'

/** A small furnished apartment used on first launch so the editor isn't empty. */
export function sampleProject(): Project {
  const p = projectFromTemplate(TEMPLATES.find((t) => t.id === 'one-bed')!)
  p.name = 'Sample apartment'
  return p
}
