/**
 * The inbox: proposals that were not confident enough to save themselves.
 *
 * Every row keeps the rule that proposed it, the sentence it came from, and the
 * session it came from — because a review queue is only usable if you can judge
 * the proposal without re-reading the conversation.
 */
import { join } from 'node:path'
import { features, similarity } from './text.js'
import { nowIso, readJson, stampOf, writeJson } from './jsonfile.js'

const MAX_PENDING = 200
const DEDUPE = 0.78

export function emptyInbox() {
  return { version: 1, updatedAt: nowIso(), items: [] }
}

export class InboxStore {
  constructor(dir) {
    this.file = join(dir, 'inbox.json')
    this.data = emptyInbox()
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
    this.data = {
      version: 1,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
      items: (Array.isArray(raw.items) ? raw.items : []).filter((item) => item && typeof item === 'object'),
    }
    return this
  }

  persist() {
    this.data.updatedAt = nowIso()
    writeJson(this.file, this.data)
    this.stamp = stampOf(this.file)
  }

  list() {
    this.load()
    return this.data.items
  }

  count() {
    return this.list().length
  }

  get(id) {
    return this.list().find((item) => item.id === id)
  }

  add(candidate, origin) {
    this.load()
    const text = String(candidate.content ?? '')
    const vector = features(`${candidate.title ?? ''} ${text}`)
    const duplicate = this.data.items.some((item) => similarity(vector, features(`${item.title} ${item.content}`)) >= DEDUPE)
    if (duplicate) return null
    const item = {
      id: `inb_${Math.random().toString(16).slice(2, 10)}`,
      target: candidate.target === 'profile' ? 'profile' : 'memory',
      kind: candidate.kind ?? 'fact',
      category: candidate.category ?? '',
      title: String(candidate.title ?? '').slice(0, 160),
      content: text.slice(0, 20000),
      tags: Array.isArray(candidate.tags) ? candidate.tags.slice(0, 16) : [],
      importance: Number.isFinite(candidate.importance) ? candidate.importance : 3,
      confidence: Number.isFinite(candidate.confidence) ? candidate.confidence : 0.5,
      rule: String(candidate.rule ?? ''),
      label: String(candidate.label ?? ''),
      origin: origin && typeof origin === 'object' ? origin : { at: nowIso() },
      createdAt: nowIso(),
    }
    this.data.items.unshift(item)
    if (this.data.items.length > MAX_PENDING) {
      this.data.items.sort((a, b) => b.confidence - a.confidence)
      this.data.items = this.data.items.slice(0, MAX_PENDING)
    }
    this.persist()
    return item
  }

  remove(id) {
    this.load()
    const before = this.data.items.length
    this.data.items = this.data.items.filter((item) => item.id !== id)
    if (this.data.items.length === before) return false
    this.persist()
    return true
  }

  clear() {
    this.load()
    const removed = this.data.items.length
    this.data.items = []
    this.persist()
    return removed
  }
}
