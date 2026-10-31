/**
 * The profile: what the agent knows about *you*, kept apart from what it knows
 * about *the work*.
 *
 * This separation is the whole point of requirement three. Work memories are a
 * list you manage; the profile is a small, curated portrait — name, role,
 * tooling, preferences, constraints, goals — that an agent should carry into
 * every session without being asked. Mixing the two is what turns a memory store
 * into a junk drawer.
 */
import { join } from 'node:path'
import { features, normalizeText, similarity, toTag, toTitle } from './text.js'
import { nowIso, readJson, stampOf, writeJson } from './jsonfile.js'

export const CATEGORIES = ['identity', 'work', 'tooling', 'preference', 'constraint', 'goal', 'style']

export const CATEGORY_LABELS = {
  identity: '身份',
  work: '工作',
  tooling: '工具与环境',
  preference: '偏好',
  constraint: '限制',
  goal: '目标',
  style: '风格',
}

const IDENTITY_FIELDS = ['name', 'role', 'location', 'language', 'timezone']

const MAX_FACETS = 400
const DEDUPE = 0.72

export function normalizeFacet(raw = {}) {
  const body = normalizeText(raw.text ?? raw.content ?? '')
  const category = CATEGORIES.includes(raw.category) ? raw.category : 'preference'
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `pf_${Math.random().toString(16).slice(2, 10)}`,
    category,
    title: typeof raw.title === 'string' && raw.title !== '' ? raw.title.slice(0, 80) : toTitle(body, 40),
    text: body.slice(0, 2000),
    tags: Array.isArray(raw.tags)
      ? [...new Set(raw.tags.map((tag) => toTag(String(tag))).filter((tag) => tag !== ''))]
      : String(raw.tags ?? '')
          .split(',')
          .map((tag) => toTag(tag))
          .filter((tag) => tag !== ''),
    confidence: clamp01(raw.confidence ?? 1),
    source: ['manual', 'capture', 'agent', 'profile'].includes(raw.source) ? raw.source : 'manual',
    origin: raw.origin && typeof raw.origin === 'object' ? raw.origin : undefined,
    hits: Number.isFinite(raw.hits) ? Math.max(0, Math.round(raw.hits)) : 0,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt !== '' ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt !== '' ? raw.updatedAt : nowIso(),
  }
}

function clamp01(value) {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(n)) return 1
  return Math.max(0, Math.min(1, n))
}

export function emptyProfile() {
  return {
    version: 1,
    updatedAt: nowIso(),
    identity: { name: '', role: '', location: '', language: '', timezone: '' },
    facets: [],
    summary: '',
  }
}

export class ProfileStore {
  constructor(dir) {
    this.dir = dir
    this.file = join(dir, 'profile.json')
    this.data = emptyProfile()
    this.loaded = false
    this.stamp = 0
  }

  load() {
    const stamp = stampOf(this.file)
    if (this.loaded && stamp === this.stamp) return this
    this.loaded = true
    this.stamp = stamp
    const raw = readJson(this.file, null)
    if (!raw || typeof raw !== 'object') return this
    const identity = raw.identity && typeof raw.identity === 'object' ? raw.identity : {}
    this.data = {
      version: 1,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
      identity: Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, String(identity[field] ?? '').slice(0, 200)])),
      facets: (Array.isArray(raw.facets) ? raw.facets : []).map(normalizeFacet).slice(0, MAX_FACETS),
      summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 4000) : '',
    }
    return this
  }

  persist() {
    this.data.updatedAt = nowIso()
    writeJson(this.file, this.data)
    this.stamp = stampOf(this.file)
  }

  get() {
    this.load()
    return this.data
  }

  facets() {
    return this.get().facets
  }

  count() {
    return this.facets().length
  }

  setIdentity(patch = {}) {
    this.load()
    for (const field of IDENTITY_FIELDS) {
      if (typeof patch[field] === 'string') this.data.identity[field] = patch[field].trim().slice(0, 200)
    }
    this.persist()
    return this.data.identity
  }

  /**
   * Add a facet, or refresh the closest existing one. "Closest" is lexical
   * overlap, which is crude but predictable — and it means the profile merges
   * "我用 Windows" and "我平时用 Windows 做开发" instead of collecting both.
   */
  addFacet(raw = {}) {
    this.load()
    const facet = normalizeFacet(raw)
    if (facet.text === '') throw new Error('facet text is required')
    const vector = features(facet.text)
    let best = null
    let bestScore = 0
    for (const existing of this.data.facets) {
      if (existing.category !== facet.category) continue
      const score = similarity(vector, features(existing.text))
      if (score > bestScore) {
        bestScore = score
        best = existing
      }
    }
    if (best && bestScore >= DEDUPE) {
      best.text = facet.text
      best.title = facet.title
      best.confidence = Math.max(best.confidence, facet.confidence)
      best.updatedAt = nowIso()
      best.tags = [...new Set([...best.tags, ...facet.tags])]
      if (facet.source !== 'manual') best.source = best.source === 'manual' ? best.source : facet.source
      this.persist()
      return { facet: best, created: false }
    }
    if (this.data.facets.length >= MAX_FACETS) {
      // Drop the weakest, least recently touched facet rather than refusing the
      // write: a full profile should forget, not freeze.
      const victim = [...this.data.facets].sort((a, b) => a.confidence - b.confidence || a.updatedAt.localeCompare(b.updatedAt))[0]
      this.data.facets = this.data.facets.filter((entry) => entry !== victim)
    }
    this.data.facets.push(facet)
    this.persist()
    return { facet, created: true }
  }

  updateFacet(id, patch = {}) {
    this.load()
    const facet = this.data.facets.find((entry) => entry.id === id)
    if (!facet) return undefined
    if (typeof patch.text === 'string' && patch.text.trim() !== '') facet.text = normalizeText(patch.text).slice(0, 2000)
    if (typeof patch.title === 'string' && patch.title.trim() !== '') facet.title = patch.title.trim().slice(0, 80)
    if (CATEGORIES.includes(patch.category)) facet.category = patch.category
    if (Array.isArray(patch.tags) || typeof patch.tags === 'string') {
      const tags = Array.isArray(patch.tags) ? patch.tags : patch.tags.split(',')
      facet.tags = [...new Set(tags.map((tag) => toTag(String(tag))).filter((tag) => tag !== ''))]
    }
    if (patch.confidence !== undefined) facet.confidence = clamp01(patch.confidence)
    facet.updatedAt = nowIso()
    this.persist()
    return facet
  }

  removeFacet(id) {
    this.load()
    const before = this.data.facets.length
    this.data.facets = this.data.facets.filter((entry) => entry.id !== id)
    if (this.data.facets.length === before) return false
    this.persist()
    return true
  }

  /** Delete every facet matching a substring — "forget that I prefer terse answers". */
  forget(query) {
    this.load()
    const q = String(query ?? '').toLowerCase().trim()
    if (q === '') return []
    const hits = this.data.facets.filter((entry) => `${entry.title} ${entry.text} ${entry.tags.join(' ')}`.toLowerCase().includes(q))
    this.data.facets = this.data.facets.filter((entry) => !hits.includes(entry))
    if (hits.length > 0) this.persist()
    return hits
  }

  /**
   * The text an agent gets at session start. Budgeted: a profile that fills the
   * context defeats the purpose of remembering cheaply.
   */
  renderSummary(maxChars = 700) {
    const { identity, facets } = this.get()
    const lines = []
    const idParts = IDENTITY_FIELDS.filter((field) => identity[field] !== '').map((field) => `${IDENTITY_FIELD_LABELS[field]}：${identity[field]}`)
    if (idParts.length > 0) lines.push(idParts.join('　'))
    const ordered = [...facets].sort((a, b) => b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt))
    const byCategory = new Map()
    for (const facet of ordered) {
      const bucket = byCategory.get(facet.category) ?? []
      bucket.push(facet.text)
      byCategory.set(facet.category, bucket)
    }
    for (const category of CATEGORIES) {
      const bucket = byCategory.get(category)
      if (!bucket || bucket.length === 0) continue
      lines.push(`${CATEGORY_LABELS[category]}：${bucket.slice(0, 4).join('；')}`)
    }
    if (lines.length === 0) return ''
    let out = ''
    for (const line of lines) {
      if (out.length + line.length + 1 > maxChars) break
      out += (out === '' ? '' : '\n') + line
    }
    return out
  }
}

const IDENTITY_FIELD_LABELS = {
  name: '称呼',
  role: '身份',
  location: '所在地',
  language: '语言',
  timezone: '时区',
}
