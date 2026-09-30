import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { CATEGORIES } from '@/model/symbols'
import { toggleFaded, useEditor } from '@/store/editor'

/** Plan categories that can be faded: the library's, plus dimensions and saved views. */
const ITEMS: { key: string; label: string }[] = [
  ...CATEGORIES.map((c) => ({ key: c, label: c === 'Lighting' ? 'Lights & switches' : c === 'Ceilings' ? 'Gypsum boxes' : c })),
  { key: 'Dimensions', label: 'Dimensions' },
  { key: 'Saved views', label: 'Saved 3D views' },
]

/** Fade whole categories on the plan (lights, furniture, …) to work around them. */
export function VisibilityMenu() {
  const faded = useEditor((s) => s.settings.faded)
  const setSettings = useEditor((s) => s.setSettings)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="bg-background/95 shadow-sm backdrop-blur" aria-label="Show or fade categories">
          {faded.length ? <EyeOff /> : <Eye />}
          <span className="max-sm:hidden">{faded.length ? `${faded.length} faded` : 'Show'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <p className="text-sm font-medium">Show on the plan</p>
        <p className="mb-2 text-xs text-muted-foreground">Faded items can't be clicked, so you can work around them.</p>
        <div className="space-y-1">
          {ITEMS.map((i) => (
            <label key={i.key} className="flex items-center justify-between gap-2 py-0.5 text-sm">
              <span className={faded.includes(i.key) ? 'text-muted-foreground' : undefined}>{i.label}</span>
              <Switch size="sm" checked={!faded.includes(i.key)} onCheckedChange={() => toggleFaded(i.key)} />
            </label>
          ))}
        </div>
        {faded.length > 0 && (
          <Button variant="link" size="sm" className="mt-1 h-auto px-0" onClick={() => setSettings({ faded: [] })}>
            Show everything
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
