import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useEditor } from '@/store/editor'
import { LibraryPanel } from './LibraryPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { SummaryPanel } from './SummaryPanel'

type Tab = 'properties' | 'library' | 'summary'

export function Sidebar({ open }: { open: boolean }) {
  const [tab, setTab] = useState<Tab>('properties')
  const selectionKey = useEditor((s) => (s.selection ? (s.selection.kind === 'multi' ? `multi:${s.selection.items.length}` : `${s.selection.kind}:${s.selection.id}`) : ''))

  // Jump to properties when something gets selected.
  const [lastKey, setLastKey] = useState(selectionKey)
  if (selectionKey !== lastKey) {
    setLastKey(selectionKey)
    if (selectionKey) setTab('properties')
  }

  return (
    <aside
      className={cn(
        'flex w-80 shrink-0 flex-col border-l bg-background',
        'max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-20 max-md:w-[min(340px,88vw)] max-md:shadow-xl',
        !open && 'hidden',
      )}
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b p-2">
          <TabsList className="w-full">
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="properties">
            <PropertiesPanel />
          </TabsContent>
          <TabsContent value="library">
            <LibraryPanel />
          </TabsContent>
          <TabsContent value="summary">
            <SummaryPanel />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  )
}
