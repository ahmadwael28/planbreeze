/** Starting the guided tour (see GuidedTour), and offering it once on a first visit. */
import { toast } from 'sonner'
import { useUi } from '@/store/ui'

const TOUR_KEY = 'planbreeze.tour'

/** Start the tour (closing the start dialog if it's open). */
export function startTour() {
  useUi.getState().openStart(false)
  useUi.getState().setTourStep(0)
  try {
    localStorage.setItem(TOUR_KEY, 'taken')
  } catch {
    // Private browsing: it's only a reminder.
  }
}

/** Offer the tour once, on a first visit (after the start dialog), unless something else is open. */
export function offerTour() {
  try {
    if (localStorage.getItem(TOUR_KEY)) return
    localStorage.setItem(TOUR_KEY, 'offered')
  } catch {
    return
  }
  if (useUi.getState().importTarget) return
  toast('New to Planbreeze?', {
    description: 'Take a one-minute tour of where everything is.',
    duration: 15000,
    action: { label: 'Take the tour', onClick: startTour },
  })
}
