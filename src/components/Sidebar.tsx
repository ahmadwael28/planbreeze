import { useState } from 'react'
import { Copy, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { makeOwnCopy } from '@/cloud/sync'
import { cn } from '@/lib/utils'
import { isViewOnly, useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'
import type { SidebarTab } from '@/store/ui'
import { LibraryPanel } from './LibraryPanel'
import { PropertiesPanel } from './PropertiesPanel'
import { SummaryPanel } from './SummaryPanel'

/** For a plan shared to view: why nothing can be changed, and the way to a copy that can. */
function ViewOnlyNote() {
  return (
    <div className="m-3 space-y-2 rounded-lg border bg-muted/50 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <Eye className="size-4" /> Shared with you to view
      </p>
      <p className="text-xs text-muted-foreground">You can look around, measure and walk through it in 3D. To change it, make your own copy.</p>
      <Button size="sm" variant="outline" onClick={makeOwnCopy}>
        <Copy /> Make a copy
      </Button>
    </div>
  )
}

export function Sidebar({ open }: { open: boolean }) {
  const tab = useUi((s) => s.sidebarTab)
  const setTab = useUi((s) => s.setSidebarTab)
  const viewOnly = useEditor((s) => isViewOnly(s.project))
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
      data-tour="sidebar"
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as SidebarTab)} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b p-2">
          <TabsList className="w-full">
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="properties">
            {viewOnly && <ViewOnlyNote />}
            {/* Shared to view: every field shows, none can be changed. */}
            <fieldset disabled={viewOnly} className="m-0 min-w-0 border-0 p-0">
              <PropertiesPanel />
            </fieldset>
          </TabsContent>
          <TabsContent value="library">{viewOnly ? <ViewOnlyNote /> : <LibraryPanel />}</TabsContent>
          <TabsContent value="summary">
            <SummaryPanel />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  )
}
