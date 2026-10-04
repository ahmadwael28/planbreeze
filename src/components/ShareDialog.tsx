import { useState } from 'react'
import type { FormEvent } from 'react'
import { Globe, Link2, Lock, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Loader } from '@/components/ui/loader'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Share, ShareRole } from '@/cloud/backend'
import { useCloud } from '@/cloud/store'
import { ensureInCloud, shareLink, sharingApi } from '@/cloud/sync'
import { useEditor } from '@/store/editor'
import { useUi } from '@/store/ui'

const ROLES: Record<ShareRole, string> = { viewer: 'Can view', editor: 'Can edit' }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A key for a plan's view link: 128 random bits, URL-safe. */
function newLinkKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function Initial({ email }: { email: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground uppercase">
      {email.slice(0, 1)}
    </span>
  )
}

/**
 * Share the open plan: with people by email, who can view or edit it once they sign in with that address, and with
 * anyone who has the link, to view.
 */
export function ShareDialog() {
  const open = useUi((s) => s.shareOpen)
  const setOpen = useUi((s) => s.openShare)
  const project = useEditor((s) => s.project)
  const user = useCloud((s) => s.user)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [problem, setProblem] = useState<string | null>(null)
  const [shares, setShares] = useState<Share[]>([])
  const [linkKey, setLinkKey] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ShareRole>('viewer')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setStatus('loading')
    setProblem(null)
    try {
      // It has to be in the account to be shared.
      await ensureInCloud()
      const api = sharingApi()
      const id = useEditor.getState().project.id
      const [list, key] = await Promise.all([api.list(id), api.linkKey(id)])
      setShares(list)
      setLinkKey(key)
      setStatus('ready')
    } catch (e) {
      setProblem((e as Error).message)
      setStatus('error')
    }
  }

  // Load who it's shared with each time the dialog opens (or another plan is opened).
  const key = `${open}:${project.id}:${user?.id ?? ''}`
  const [lastKey, setLastKey] = useState('')
  if (key !== lastKey) {
    setLastKey(key)
    if (open) void load()
  }

  /** Run a change, then show who has access now. */
  const change = async (what: () => Promise<void>, done?: string) => {
    setBusy(true)
    try {
      await what()
      const api = sharingApi()
      setShares(await api.list(project.id))
      if (done) toast.success(done)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const invite = (ev: FormEvent) => {
    ev.preventDefault()
    const address = email.trim().toLowerCase()
    if (!EMAIL.test(address)) return toast.error('Enter an email address, like name@example.com.')
    if (address === user?.email?.toLowerCase()) return toast.error("That's your own address: you already have this plan.")
    void change(async () => {
      await sharingApi().share(project.id, address, role)
      setEmail('')
    }, `Shared with ${address}. Send them the link so they can open it.`)
  }

  const setLink = (on: boolean) => {
    const next = on ? newLinkKey() : null
    setBusy(true)
    sharingApi()
      .setLinkKey(project.id, next)
      .then(() => setLinkKey(next))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setBusy(false))
  }

  const copyLink = async () => {
    const url = shareLink(project.id, linkKey)
    try {
      await navigator.clipboard.writeText(url)
      toast.success(linkKey ? 'Link copied. Anyone with it can view this plan.' : 'Link copied. It opens the plan for the people you added.')
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">Share “{project.name}”</DialogTitle>
          <DialogDescription>
            People you add open it by signing in with that email address. Planbreeze doesn't email them, so send them the link.
          </DialogDescription>
        </DialogHeader>

        {status === 'loading' ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader label="Loading" /> Getting the plan ready to share…
          </div>
        ) : status === 'error' ? (
          <div className="space-y-3">
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{problem}</p>
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <form onSubmit={invite} className="flex gap-2">
              <Input
                type="email"
                autoComplete="off"
                placeholder="Add people by email"
                aria-label="Email address to share with"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 min-w-0 flex-1"
              />
              <Select value={role} onValueChange={(v) => setRole(v as ShareRole)}>
                <SelectTrigger className="w-28" aria-label="Access for the new person">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">{ROLES.viewer}</SelectItem>
                  <SelectItem value="editor">{ROLES.editor}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={busy || !email.trim()} aria-label="Share">
                <UserPlus /> <span className="max-sm:hidden">Share</span>
              </Button>
            </form>

            <section className="space-y-2">
              <h4 className="text-sm font-medium">People with access</h4>
              <ul className="space-y-1">
                <li className="flex items-center gap-3 py-1">
                  <Initial email={user?.email ?? user?.name ?? '?'} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {user?.email ?? user?.name} <span className="text-muted-foreground">(you)</span>
                  </span>
                  <span className="pr-3 text-sm text-muted-foreground">Owner</span>
                </li>
                {shares.map((s) => (
                  <li key={s.email} className="flex items-center gap-3 py-1">
                    <Initial email={s.email} />
                    <span className="min-w-0 flex-1 truncate text-sm">{s.email}</span>
                    <Select
                      value={s.role}
                      disabled={busy}
                      onValueChange={(v) =>
                        void change(() => (v === 'remove' ? sharingApi().unshare(project.id, s.email) : sharingApi().share(project.id, s.email, v as ShareRole)))
                      }
                    >
                      <SelectTrigger size="sm" className="w-28 border-transparent shadow-none" aria-label={`Access for ${s.email}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="viewer">{ROLES.viewer}</SelectItem>
                        <SelectItem value="editor">{ROLES.editor}</SelectItem>
                        <SelectSeparator />
                        <SelectItem value="remove">Remove access</SelectItem>
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-medium">General access</h4>
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground [&>svg]:size-4">
                  {linkKey ? <Globe /> : <Lock />}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <Select value={linkKey ? 'link' : 'people'} disabled={busy} onValueChange={(v) => setLink(v === 'link')}>
                    <SelectTrigger size="sm" className="-ml-2.5 w-auto border-transparent font-medium shadow-none" aria-label="General access">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="people">Only people added</SelectItem>
                      <SelectItem value="link">Anyone with the link can view</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {linkKey
                      ? "Anyone who has the link can view this plan, without signing in. They can't change it."
                      : 'Only the people above can open it, after signing in.'}
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" disabled={status !== 'ready'} onClick={() => void copyLink()}>
            <Link2 /> Copy link
          </Button>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
