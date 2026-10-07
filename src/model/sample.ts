import { projectFromTemplate, TEMPLATES } from './templates'
import type { Project } from './types'

/** The furnished example apartment opened on a first visit, to show what the app can do. */
export function sampleProject(): Project {
  return projectFromTemplate(TEMPLATES.find((t) => t.id === 'example')!)
}
