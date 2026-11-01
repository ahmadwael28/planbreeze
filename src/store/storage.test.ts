import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newProject } from '@/model/project'
import type { Project, ProjectImage } from '@/model/types'
import type { TrashedMeta } from './storage'

/** localStorage as browsers have it, with a limit (about 5 MB in most). */
class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  private limit: number
  constructor(limit = Infinity) {
    this.limit = limit
  }
  get length() {
    return this.items.size
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.items.get(k) ?? null
  }
  setItem(k: string, v: string) {
    let size = k.length + String(v).length
    for (const [a, b] of this.items) if (a !== k) size += a.length + b.length
    if (size > this.limit) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    this.items.set(k, String(v))
  }
  removeItem(k: string) {
    this.items.delete(k)
  }
  clear() {
    this.items.clear()
  }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError')

/**
 * The browser full: a new image is refused unless the same transaction deleted `room` deleted plans (Infinity: always
 * refused). Returns a way to make room again.
 */
function fillUp(room: number) {
  const dropped = new WeakMap<IDBTransaction, number>()
  const put = IDBObjectStore.prototype.put
  const del = IDBObjectStore.prototype.delete
  let need = room
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
    if (this.name === 'trash') dropped.set(this.transaction, (dropped.get(this.transaction) ?? 0) + 1)
    return del.call(this, key)
  })
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    if (this.name === 'images' && (dropped.get(this.transaction) ?? 0) < need) throw quotaError()
    return put.call(this, value, key)
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => void (need = 0)
}

/** localStorage written to by someone else (a tab of an older version) the moment a plan is put in IndexedDB. */
function meanwhile(id: string, key: string, value: string) {
  const put = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) {
    if (this.name === 'plans' && k === id) localStorage.setItem(key, value)
    return put.call(this, v, k)
  })
}

/** The storage as the app opens it (afresh: as if the page was loaded again). */
const fresh = () => import('./storage')

/** A JPEG-ish data URL of `n` bytes, different for each seed. */
function photo(n: number, seed: number): string {
  let x = seed * 2654435761
  let bin = ''
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0
    bin += String.fromCharCode(x >>> 24)
  }
  return `data:image/jpeg;base64,${btoa(bin)}`
}

const img = (id: string, src: string): ProjectImage => ({ id, name: id, src, w: 10, h: 10, tone: '#808080' })

let clock = 1_000_000

function plan(name: string, opts: { images?: ProjectImage[]; underlay?: string } = {}): Project {
  const p = newProject(name)
  p.updatedAt = clock += 1000
  if (opts.images) p.images = opts.images
  if (opts.underlay) p.floors[0].underlay = { src: opts.underlay, x: 0, y: 0, width: 500, height: 400, opacity: 0.5, visible: true }
  return p
}

const later = (p: Project, change: Partial<Project> = {}): Project => ({ ...p, ...change, updatedAt: (clock += 1000) })

/** How many records a store of the database has. */
async function count(store: string): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('planbreeze')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
  try {
    return await new Promise<number>((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).count()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  } finally {
    db.close()
  }
}

/** Plans kept as versions before IndexedDB kept them, in localStorage. */
function keptTheOldWay(plans: Project[], trashed: { p: Project; deletedAt: number; cloud?: boolean }[] = [], last?: string) {
  localStorage.setItem('fp.projects', JSON.stringify(plans.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))))
  for (const p of plans) localStorage.setItem(`fp.project.${p.id}`, JSON.stringify(p))
  localStorage.setItem('fp.trash', JSON.stringify(trashed.map(({ p, deletedAt, cloud }) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, deletedAt, cloud }))))
  for (const { p } of trashed) localStorage.setItem(`fp.trash.${p.id}`, JSON.stringify(p))
  if (last) localStorage.setItem('fp.lastProject', JSON.stringify(last))
}

const lsKeys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).sort()

/** A note of a plan as the page was left, made from the stored copy changed at `base` (as saveOnLeave writes it). */
const note = (plan: Project, base?: number) => JSON.stringify({ plan, base })
const ids = (list: { id: string }[]) => list.map((m) => m.id).sort()

describe('plans kept in localStorage move across', () => {
  it('moves every plan and deleted plan, each image stored once, and nothing is lost', async () => {
    const tile = photo(3000, 1)
    const a = plan('A', { images: [img('t', tile)], underlay: photo(5000, 2) })
    const b = plan('B', { images: [img('t', tile)] })
    const c = plan('C', { images: [img('t', tile), img('c', photo(2000, 3))] })
    keptTheOldWay([a, b], [{ p: c, deletedAt: 123, cloud: true }], a.id)

    const s = await fresh()
    expect(ids(await s.listProjects())).toEqual(ids([a, b]))
    expect(await s.loadProject(a.id)).toEqual(a)
    expect(await s.loadProject(b.id)).toEqual(b)
    expect(await s.listTrash()).toEqual([{ id: c.id, name: 'C', updatedAt: c.updatedAt, deletedAt: 123, cloud: true }])
    expect(s.lastProjectId()).toBe(a.id)
    expect(s.storageKind()).toBe('idb')
    // Out of localStorage (but the plan last open), and the tile stored once for three plans.
    expect(lsKeys()).toEqual(['fp.lastProject', 'fp.storage'])
    expect(await count('images')).toBe(3)
    expect(await s.restoreProject(c.id)).toEqual(c)
  })

  it('leaves a plan it can’t read where it was', async () => {
    const a = plan('A')
    keptTheOldWay([a])
    localStorage.setItem('fp.project.broken', '{"not json')
    const s = await fresh()
    expect(ids(await s.listProjects())).toEqual([a.id])
    expect(localStorage.getItem('fp.project.broken')).toBe('{"not json')
  })

  it('takes a newer copy left by a tab of an older version, and not an older one', async () => {
    const a = plan('A')
    const b = plan('B')
    let s = await fresh()
    await s.saveProject(a)
    await s.saveProject(b)
    // A tab still open on the version before saves to localStorage: A changed there, B as it was before.
    const a2 = later(a, { name: 'A changed in the old tab' })
    keptTheOldWay([a2, { ...b, name: 'B, older', updatedAt: b.updatedAt - 500 }])
    vi.resetModules()
    s = await fresh()
    expect((await s.loadProject(a.id))?.name).toBe('A changed in the old tab')
    expect((await s.loadProject(b.id))?.name).toBe('B')
    expect(lsKeys()).toEqual(['fp.lastProject', 'fp.storage'])
  })

  it('leaves a newer copy saved in localStorage while it was moving the plan across', async () => {
    const a = plan('A')
    keptTheOldWay([a])
    const a2 = later(a, { name: 'A, saved by the old tab meanwhile' })
    meanwhile(a.id, `fp.project.${a.id}`, JSON.stringify(a2))
    let s = await fresh()
    expect((await s.loadProject(a.id))?.name).toBe('A')
    expect(localStorage.getItem(`fp.project.${a.id}`)).not.toBeNull()
    vi.restoreAllMocks()
    vi.resetModules()
    s = await fresh()
    expect((await s.loadProject(a.id))?.name).toBe('A, saved by the old tab meanwhile')
    // The copy it replaced is kept to put back, in case it had changes this one doesn't.
    expect(await s.listTrash()).toMatchObject([{ name: 'A', other: true }])
  })

  it('keeps a copy in IndexedDB that a newer one from localStorage replaces, in Recently deleted', async () => {
    const a = plan('A', { images: [img('t', photo(900, 28))] })
    let s = await fresh()
    await s.saveProject(a)
    // Changes made elsewhere (in localStorage, while IndexedDB couldn't be opened), newer.
    const there = later(a, { name: 'A, changed elsewhere', images: [] })
    keptTheOldWay([there])
    vi.resetModules()
    s = await fresh()
    expect(await s.loadProject(a.id)).toEqual(there)
    const [kept] = await s.listTrash()
    expect(kept).toMatchObject({ name: 'A', updatedAt: a.updatedAt, other: true })
    expect(await s.restoreProject(kept.id)).toEqual({ ...a, id: kept.id })
    // Deleting the plan later doesn't touch the version kept beside it.
    await s.saveProject(there)
    await s.trashProject(a.id)
    expect((await s.listTrash()).map((m) => m.name).sort()).toEqual(['A, changed elsewhere'])
    expect(ids(await s.listProjects())).toEqual([kept.id])
  })

  it('keeps a copy from localStorage that’s older than the one here and different, in Recently deleted', async () => {
    const a = plan('A')
    const left = later(a, { name: 'A, left in localStorage', images: [img('y', photo(900, 30))] })
    const s0 = await fresh()
    await s0.saveProject(a)
    // Left there (the browser was full); then the copy here was changed, so it's newer.
    keptTheOldWay([left])
    await s0.saveProject(later(a, { name: 'A, changed here' }))
    vi.resetModules()
    const s = await fresh()
    expect((await s.loadProject(a.id))?.name).toBe('A, changed here')
    const [kept] = await s.listTrash()
    expect(kept).toMatchObject({ name: 'A, left in localStorage', other: true })
    expect(await s.restoreProject(kept.id)).toEqual({ ...left, id: kept.id })
    expect(lsKeys()).toEqual(['fp.lastProject', 'fp.storage'])
  })

  it('keeps another version of a plan shared with the user as their own', async () => {
    const a = { ...plan('Shared'), access: { owner: 'someone', role: 'editor' as const } }
    let s = await fresh()
    await s.saveProject(a)
    keptTheOldWay([later(a, { name: 'Shared, changed in an old tab' })])
    vi.resetModules()
    s = await fresh()
    await s.openStorage()
    expect(s.versionsKeptApart()).toBe(1)
    const [kept] = await s.listTrash()
    const back = await s.restoreProject(kept.id)
    expect(back?.access).toBeUndefined()
    expect((await s.listProjects()).find((m) => m.id === kept.id)?.shared).toBeUndefined()
  })

  it('doesn’t bring back a plan deleted after the copy left in localStorage', async () => {
    const a = plan('A')
    let s = await fresh()
    await s.saveProject(a)
    keptTheOldWay([a])
    await s.trashProject(a.id)
    vi.resetModules()
    s = await fresh()
    expect(await s.listProjects()).toEqual([])
    expect(ids(await s.listTrash())).toEqual([a.id])
  })

  it('keeps plans in localStorage where IndexedDB can’t be opened, as before', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Blocked', 'SecurityError') } })
    const a = plan('A', { images: [img('t', photo(1000, 4))] })
    keptTheOldWay([a])
    const s = await fresh()
    expect(await s.loadProject(a.id)).toEqual(a)
    expect(s.storageKind()).toBe('local')
    expect(s.plansOutOfReach()).toBe(false)
    const b = plan('B')
    expect(await s.saveProject(b)).toBe(true)
    expect(JSON.parse(localStorage.getItem(`fp.project.${b.id}`)!)).toEqual(b)
  })

  it('says the plans are out of reach when they were moved to IndexedDB and it can’t be opened now', async () => {
    let s = await fresh()
    await s.saveProject(plan('A'))
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Lost', 'UnknownError') } })
    vi.resetModules()
    s = await fresh()
    await s.openStorage()
    expect(s.plansOutOfReach()).toBe(true)
  })
})

describe('plans in IndexedDB', () => {
  it('saves a plan with many photos, that localStorage couldn’t take', async () => {
    const p = plan('Many photos', { images: Array.from({ length: 40 }, (_, i) => img(`p${i}`, photo(150_000, 10 + i))), underlay: photo(400_000, 99) })
    vi.stubGlobal('localStorage', new MemoryStorage(5_000_000))
    const { localBackend } = await import('./storage-local')
    expect(await localBackend().put(p)).toBe(false)

    const s = await fresh()
    expect(await s.saveProject(p)).toBe(true)
    expect(await s.loadProject(p.id)).toEqual(p)
    expect(await count('images')).toBe(41)
    // Saved again, the photos aren't stored again.
    expect(await s.saveProject(later(p))).toBe(true)
    expect(await count('images')).toBe(41)
  })

  it('stores an image once, however many plans and deleted plans use it, and lets it go when none do', async () => {
    const tile = photo(2000, 5)
    const a = plan('A', { images: [img('t', tile)] })
    const b = plan('B', { images: [img('t2', tile)] })
    const s = await fresh()
    await s.saveProject(a)
    await s.saveProject(b)
    expect(await count('images')).toBe(1)
    await s.trashProject(a.id)
    await s.deleteProject(b.id)
    // A in the trash still uses it.
    expect(await count('images')).toBe(1)
    await s.purgeTrashed(a.id)
    expect(await count('images')).toBe(0)
  })

  it('lets go of a photo no plan uses any more, at the second start that finds it unused', async () => {
    const a = plan('A', { images: [img('t', photo(2000, 6))] })
    let s = await fresh()
    await s.saveProject(a)
    await s.saveProject(later(a, { images: [] }))
    expect(await count('images')).toBe(1)
    // (A note of the plan, made as another tab closed, may still bring it back.)
    vi.resetModules()
    s = await fresh()
    await s.openStorage()
    expect(await count('images')).toBe(1)
    vi.resetModules()
    s = await fresh()
    await s.openStorage()
    expect(await count('images')).toBe(0)
    expect(localStorage.getItem('fp.unusedImages')).toBeNull()
  })

  it('keeps an image that isn’t a base64 data URL inside the plan', async () => {
    const a = plan('A', { images: [img('svg', 'data:image/svg+xml;utf8,<svg/>'), img('web', 'https://example.com/tile.jpg')] })
    const s = await fresh()
    await s.saveProject(a)
    expect(await s.loadProject(a.id)).toEqual(a)
    expect(await count('images')).toBe(0)
  })

  it('does one thing at a time, in the order asked', async () => {
    const a = plan('A')
    const s = await fresh()
    await s.saveProject(a)
    void s.saveProject(later(a, { name: 'A, changed' }))
    const deleted = s.trashProject(a.id)
    // A save still on its way after the delete doesn't bring it back.
    void s.saveProject(later(a, { name: 'A, saved as it closed' }))
    expect(await deleted).toBe(true)
    expect((await s.listTrash()).map((m) => m.name)).toEqual(['A, changed'])
    expect(await s.listProjects()).toEqual([])
    // Opened again (put back, or from the account): saved as usual.
    s.opened(a.id)
    await s.saveProject(a)
    expect(ids(await s.listProjects())).toEqual([a.id])
  })
})

describe('recently deleted', () => {
  it('keeps the newest copy, from the account or this browser', async () => {
    const a = plan('A')
    const s = await fresh()
    await s.saveProject(a)
    const there = later(a, { name: 'A, as in the account' })
    expect(await s.trashProject(a.id, there, true)).toBe(true)
    expect(await s.listTrash()).toMatchObject([{ id: a.id, name: 'A, as in the account', cloud: true }])
    // Deleted again (from a backup put back), the newer copy in the trash stays.
    s.opened(a.id)
    await s.saveProject(a)
    await s.trashProject(a.id)
    expect((await s.listTrash()).map((m) => m.name)).toEqual(['A, as in the account'])
  })

  it('puts a plan back, as a copy beside one with its id', async () => {
    const a = plan('A', { images: [img('t', photo(1000, 7))] })
    const s = await fresh()
    await s.saveProject(a)
    await s.trashProject(a.id)
    expect(s.isGone(a.id)).toBe(true)
    expect(await s.restoreProject(a.id)).toEqual(a)
    expect(s.isGone(a.id)).toBe(false)
    await s.trashProject(a.id)
    await s.storeProject(a)
    const copy = await s.restoreProject(a.id)
    expect(copy).toEqual({ ...a, id: copy!.id })
    expect(copy!.id).not.toBe(a.id)
    expect(ids(await s.listProjects())).toEqual(ids([a, copy!]))
    expect(await s.listTrash()).toEqual([])
    expect(await s.restoreProject('nothing')).toBeNull()
  })

  it('removes a plan only from the list when there’s nothing of it to keep', async () => {
    const s = await fresh()
    expect(await s.trashProject('only-in-the-account')).toBe(true)
    expect(await s.listTrash()).toEqual([])
  })

  it('lets go of plans deleted longer ago than it keeps them', async () => {
    const a = plan('A', { images: [img('t', photo(1000, 8))] })
    const s = await fresh()
    await s.saveProject(a)
    await s.trashProject(a.id)
    await s.purgeOldTrash(Date.now() + 29 * 24 * 3600 * 1000)
    expect(ids(await s.listTrash())).toEqual([a.id])
    await s.purgeOldTrash(Date.now() + 31 * 24 * 3600 * 1000)
    expect(await s.listTrash()).toEqual([])
    expect(await count('images')).toBe(0)
  })

  it('clears every plan from the browser (signing out on a shared computer)', async () => {
    const s = await fresh()
    const a = plan('A', { images: [img('t', photo(1000, 9))] })
    await s.saveProject(a)
    await s.saveProject(plan('B'))
    await s.trashProject(a.id)
    await s.clearPlans()
    expect(await s.listProjects()).toEqual([])
    expect(await s.listTrash()).toEqual([])
    expect(await count('images')).toBe(0)
    expect(s.lastProjectId()).toBeNull()
  })

})

describe('a full browser', () => {
  /** Three deleted plans, deleted in turn (each with a photo of its own), and a new plan with a new photo. */
  async function threeDeleted() {
    const s = await fresh()
    const old = [plan('Oldest', { images: [img('1', photo(900, 21))] }), plan('Older', { images: [img('2', photo(900, 22))] }), plan('Recent', { images: [img('3', photo(900, 23))] })]
    for (const p of old) {
      await s.saveProject(p)
      await s.trashProject(p.id)
      await new Promise((r) => setTimeout(r, 2))
    }
    return { s, old, fresh: plan('New', { images: [img('n', photo(900, 24))] }) }
  }

  it('makes room by deleting for good the plans deleted longest ago, only as many as it takes', async () => {
    const { s, old, fresh: p } = await threeDeleted()
    fillUp(2)
    expect(await s.saveProject(p)).toBe(true)
    expect((await s.listTrash()).map((m) => m.name)).toEqual(['Recent'])
    vi.restoreAllMocks()
    expect(await s.loadProject(p.id)).toEqual(p)
    expect(await s.restoreProject(old[2].id)).toEqual(old[2])
    // The photos only those two used went with them.
    expect(await count('images')).toBe(2)
  })

  it('keeps every deleted plan when even all of them wouldn’t make room', async () => {
    const { s, old, fresh: p } = await threeDeleted()
    fillUp(Infinity)
    expect(await s.saveProject(p)).toBe(false)
    vi.restoreAllMocks()
    expect(ids(await s.listTrash())).toEqual(ids(old))
    for (const o of old) expect(await s.restoreProject(o.id)).toEqual(o)
    expect(ids(await s.listProjects())).toEqual(ids(old))
    expect(await count('images')).toBe(3)
  })

  it('never drops the plan it’s putting back', async () => {
    const { s, old } = await threeDeleted()
    fillUp(1)
    // Its own photo is stored already: putting it back needs no room. A plan with a new photo does.
    expect(await s.restoreProject(old[0].id)).toEqual(old[0])
    expect(ids(await s.listTrash())).toEqual(ids(old.slice(1)))
  })

  it('still opens the plans stored when a change noted as the page closed can’t be brought in', async () => {
    const a = plan('A', { images: [img('t', photo(900, 25))] })
    let s = await fresh()
    await s.saveProject(a)
    const a2 = later(a, { name: 'A, changed', images: [img('t', photo(900, 25)), img('new', photo(900, 26))] })
    localStorage.setItem(`fp.unsaved.${a.id}`, note(a2, a.updatedAt))
    vi.resetModules()
    const room = fillUp(Infinity)
    s = await fresh()
    await s.openStorage()
    expect(s.storageKind()).toBe('idb')
    expect(s.plansLeftBehind()).toBe(1)
    expect((await s.loadProject(a.id))?.name).toBe('A')
    // Kept for when there's room.
    expect(localStorage.getItem(`fp.unsaved.${a.id}`)).not.toBeNull()
    room()
    vi.resetModules()
    s = await fresh()
    await s.openStorage()
    expect(s.plansLeftBehind()).toBe(0)
    expect(await s.loadProject(a.id)).toEqual(a2)
    expect(localStorage.getItem(`fp.unsaved.${a.id}`)).toBeNull()
  })

  it('leaves a plan in localStorage that can’t be moved across yet, and moves it later', async () => {
    const a = plan('A', { images: [img('t', photo(900, 27))] })
    const b = plan('B')
    keptTheOldWay([a, b])
    const room = fillUp(Infinity)
    let s = await fresh()
    expect(ids(await s.listProjects())).toEqual([b.id])
    expect(s.plansLeftBehind()).toBe(1)
    expect(localStorage.getItem(`fp.project.${a.id}`)).not.toBeNull()
    expect(localStorage.getItem('fp.projects')).not.toBeNull()
    room()
    vi.resetModules()
    s = await fresh()
    expect(await s.loadProject(a.id)).toEqual(a)
    expect(lsKeys()).toEqual(['fp.storage'])
  })
})

describe('a note of the plan as the page is left', () => {
  it('is saved at the next start, when the page closed before the save was made', async () => {
    const tile = photo(1000, 13)
    const a = plan('A', { images: [img('t', tile)] })
    let s = await fresh()
    await s.saveProject(a)
    const a2 = later(a, { name: 'A, changed as it closed', images: [img('t', tile), img('new', photo(800, 14))] })
    const saving = s.saveOnLeave(a2)
    const note = localStorage.getItem(`fp.unsaved.${a.id}`)!
    // The photo stored already by reference; the new one inside it.
    expect(note).toContain('"ref:')
    expect(note).toContain(photo(800, 14))
    expect(note).not.toContain(tile)
    expect(await saving).toBe(true)
    expect(localStorage.getItem(`fp.unsaved.${a.id}`)).toBeNull()

    // As if the save never got there.
    await s.storeProject(a)
    localStorage.setItem(`fp.unsaved.${a.id}`, note)
    vi.resetModules()
    s = await fresh()
    expect(await s.loadProject(a.id)).toEqual(a2)
    expect(lsKeys()).toEqual(['fp.lastProject', 'fp.storage'])
    // Made from the copy stored: it takes its place, with nothing kept beside it.
    expect(await s.listTrash()).toEqual([])
  })

  it('is cleared when its save is made, but not if another tab has noted the plan since', async () => {
    const a = plan('A')
    const s = await fresh()
    await s.saveProject(a)
    const saving = s.saveOnLeave(later(a, { name: 'A, here' }))
    const theirs = note(later(a, { name: 'A, in another tab' }))
    localStorage.setItem(`fp.unsaved.${a.id}`, theirs)
    await saving
    expect(localStorage.getItem(`fp.unsaved.${a.id}`)).toBe(theirs)
  })

  it('keeps the copies it and others replace when they were made apart', async () => {
    const a1 = plan('A')
    let s = await fresh()
    await s.saveProject(a1)
    // A tab of the older version saved A2; this version's tab, from A1, noted A3 as it closed.
    const a2 = later(a1, { name: 'A2, from the old tab' })
    const a3 = later(a1, { name: 'A3, noted' })
    keptTheOldWay([a2])
    localStorage.setItem(`fp.unsaved.${a1.id}`, note(a3, a1.updatedAt))
    vi.resetModules()
    s = await fresh()
    expect((await s.loadProject(a1.id))?.name).toBe('A3, noted')
    expect((await s.listTrash()).map((m) => m.name).sort()).toEqual(['A', 'A2, from the old tab'])
  })

  it('takes the place of the copy it was made from, even an older one (after an undo)', async () => {
    const a1 = plan('A')
    const a2 = later(a1, { name: 'A, with a room deleted' })
    let s = await fresh()
    await s.saveProject(a1)
    await s.saveProject(a2)
    // Undone, and the page closed before the save of it was made.
    localStorage.setItem(`fp.unsaved.${a1.id}`, note(a1, a2.updatedAt))
    vi.resetModules()
    s = await fresh()
    expect(await s.loadProject(a1.id)).toEqual(a1)
    expect(await s.listTrash()).toEqual([])
  })

  it('is kept beside a plan deleted since, when it has other changes', async () => {
    const a1 = plan('A')
    let s = await fresh()
    await s.saveProject(a1)
    // Noted in one tab as it closed; deleted in another.
    localStorage.setItem(`fp.unsaved.${a1.id}`, note(later(a1, { name: 'A, changed as it closed' }), a1.updatedAt))
    await s.trashProject(a1.id)
    vi.resetModules()
    s = await fresh()
    expect(await s.listProjects()).toEqual([])
    expect(Object.fromEntries((await s.listTrash()).map((m) => [m.name, !!m.other]))).toEqual({ A: false, 'A, changed as it closed': true })
    expect(s.versionsKeptApart()).toBe(1)
  })

  it('keeps a note another tab makes while this one is starting', async () => {
    const a = plan('A')
    const b = plan('B')
    let s = await fresh()
    await s.saveProject(a)
    await s.saveProject(b)
    localStorage.setItem(`fp.unsaved.${a.id}`, note(later(a, { name: 'A, noted' }), a.updatedAt))
    const b2 = later(b, { name: 'B, noted by another tab meanwhile' })
    meanwhile(a.id, `fp.unsaved.${b.id}`, note(b2, b.updatedAt))
    vi.resetModules()
    s = await fresh()
    await s.openStorage()
    vi.restoreAllMocks()
    expect((await s.loadProject(a.id))?.name).toBe('A, noted')
    expect(localStorage.getItem(`fp.unsaved.${b.id}`)).not.toBeNull()
    vi.resetModules()
    s = await fresh()
    expect((await s.loadProject(b.id))?.name).toBe('B, noted by another tab meanwhile')
  })

  it('keeps inside it a photo the plan’s stored copy doesn’t use (one put back by undo)', async () => {
    const x = photo(900, 29)
    const a = plan('A', { images: [img('x', x)] })
    const s = await fresh()
    await s.saveProject(a)
    await s.saveProject(later(a, { images: [] }))
    // Another tab starting now could clear the photo away; the note mustn't count on it being stored.
    void s.saveOnLeave(later(a, { images: [img('x', x)] }))
    expect(localStorage.getItem(`fp.unsaved.${a.id}`)).toContain(x)
  })

  it('is kept beside a newer copy stored since, and dropped for a plan deleted since', async () => {
    const a = plan('A')
    const b = plan('B')
    const c = plan('C')
    let s = await fresh()
    await s.saveProject(a)
    await s.saveProject(b)
    await s.saveProject(c)
    localStorage.setItem(`fp.unsaved.${a.id}`, note({ ...a, name: 'A, noted', updatedAt: a.updatedAt - 1 }))
    localStorage.setItem(`fp.unsaved.${b.id}`, note({ ...b, name: 'B, noted' }, b.updatedAt))
    localStorage.setItem(`fp.unsaved.${c.id}`, note({ ...c, name: 'C, the same save' }, c.updatedAt))
    await s.trashProject(b.id)
    vi.resetModules()
    s = await fresh()
    expect((await s.loadProject(a.id))?.name).toBe('A')
    expect((await s.loadProject(c.id))?.name).toBe('C')
    expect(await s.loadProject(b.id)).toBeNull()
    expect((await s.listTrash()).map((m) => m.name).sort()).toEqual(['A, noted', 'B'])
    // (C was the plan last open.)
    expect(lsKeys()).toEqual(['fp.lastProject', 'fp.storage'])
  })
})

describe('backups and the account', () => {
  it('backs up the plans that couldn’t be moved across yet, too', async () => {
    const a = plan('A', { images: [img('t', photo(900, 31))] })
    const b = plan('B')
    keptTheOldWay([a, b])
    fillUp(Infinity)
    const s = await fresh()
    await s.openStorage()
    expect(s.plansLeftBehind()).toBe(1)
    vi.restoreAllMocks()
    const { fullBackup } = await import('./backup')
    const { backup } = await fullBackup()
    expect(backup.projects.find((p) => p.id === a.id)).toEqual(a)
    expect(backup.projects.map((p) => p.id)).toContain(b.id)
  })

  it('makes no backup, rather than one that looks whole, while the plans are out of reach', async () => {
    let s = await fresh()
    await s.saveProject(plan('A'))
    vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('Lost', 'UnknownError') } })
    vi.resetModules()
    s = await fresh()
    await s.openStorage()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { fullBackup, localBackup } = await import('./backup')
    await expect(fullBackup()).rejects.toThrow(/can't be opened just now/)
    // The error screen's still has the plan open.
    expect((await localBackup()).projects).toHaveLength(1)
  })

  it('renaming a plan whose copy here is older than the account’s keeps the copy here', async () => {
    const s = await fresh()
    const sync = await import('@/cloud/sync')
    const { useEditor } = await import('./editor')
    const mem = sync.connectMemoryCloudForTesting()
    await new Promise((r) => setTimeout(r, 20))
    const x1 = plan('X')
    await s.storeProject(x1)
    await sync.uploadLocal([x1.id], true)
    // Changed and saved to the account; then undone here, so the copy here is older than what was synced.
    useEditor.getState().loadProject(later(x1, { name: 'X, with a room deleted' }))
    await sync.saveNow()
    expect(mem.rows.get(x1.id)?.data.name).toBe('X, with a room deleted')
    await s.storeProject(x1)
    useEditor.getState().loadProject(plan('Another plan'))
    await sync.renameCloudProject(x1.id, 'X renamed')
    expect(await s.loadProject(x1.id)).toEqual({ ...x1, name: 'X renamed' })
    expect(mem.rows.get(x1.id)?.data).toMatchObject({ name: 'X renamed' })
  })
})

describe('making room', () => {
  const trashOf = (...ids: string[]): TrashedMeta[] => ids.map((id, i) => ({ id, name: id, updatedAt: 0, deletedAt: i + 1 }))

  it('drops the plans deleted longest ago, one more each try, never the one kept', async () => {
    const { makeRoom } = await import('./storage-idb')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tries: string[][] = []
    const result = await makeRoom(
      async (drop) => {
        tries.push(drop)
        if (drop.length < 2) throw quotaError()
        return 'saved'
      },
      'oldest',
      async () => trashOf('recent', 'oldest', 'old').map((m) => ({ ...m, deletedAt: { oldest: 1, old: 2, recent: 3 }[m.id]! })),
    )
    expect(result).toBe('saved')
    expect(tries).toEqual([[], ['old'], ['old', 'recent']])
  })

  it('never drops a version kept apart (nobody deleted it)', async () => {
    const { makeRoom } = await import('./storage-idb')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tries: string[][] = []
    await makeRoom(
      async (drop) => {
        tries.push(drop)
        throw quotaError()
      },
      undefined,
      async () => [...trashOf('a', 'b'), { id: 'kept', name: 'kept', updatedAt: 0, deletedAt: 0, other: true }],
    )
    expect(tries).toEqual([[], ['a'], ['a', 'b']])
  })

  it('gives up when even all of them wouldn’t make room', async () => {
    const { makeRoom } = await import('./storage-idb')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tries: string[][] = []
    const result = await makeRoom(
      async (drop) => {
        tries.push(drop)
        throw quotaError()
      },
      undefined,
      async () => trashOf('a', 'b'),
    )
    expect(result).toBe(false)
    expect(tries).toEqual([[], ['a'], ['a', 'b']])
  })

  it('drops nothing for a failure that isn’t a full browser', async () => {
    const { makeRoom } = await import('./storage-idb')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const tries: string[][] = []
    const result = await makeRoom(
      async (drop) => {
        tries.push(drop)
        throw new Error('Something else')
      },
      undefined,
      async () => trashOf('a'),
    )
    expect(result).toBe(false)
    expect(tries).toEqual([[]])
  })
})
