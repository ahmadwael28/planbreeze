/**
 * Arabic for the app's text, keyed by the English (see i18n). `{name}`s are filled in, so they stay as they are. One
 * file per part of the app; a later one wins if the same English turns up in two.
 */
import shell from './ar/shell'
import items from './ar/items'
import panels from './ar/panels'
import props from './ar/props'
import dialogs from './ar/dialogs'
import model from './ar/model'

export const AR: Record<string, string> = {
  ...shell,
  ...items,
  ...panels,
  ...props,
  ...dialogs,
  ...model,
}
