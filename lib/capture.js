/**
 * End-of-session capture: turn a conversation into a handful of memories.
 *
 * The pipeline is deliberately boring, because "automatic" must not mean
 * "unaccountable":
 *
 *   session events → sentences → rule match (policy.js) → score
 *     → high confidence: saved now, marked source=capture with origin
 *     → low confidence: parked in the inbox, with the rule that proposed it
 *     → everything else: dropped, with a reason (shown in the UI counters)
 *
 * Nothing here calls a model. The rules are visible, testable and cheap, and the
 * inbox means a wrong call costs one click rather than one wrong memory.
 */
import { join } from 'node:path'
import { extractCandidates, THRESHOLDS } from './policy.js'
import { nowIso, readJson, stampOf, writeJson } from './jsonfile.js'
import { normalizeText } from './text.js'

// Recall is pull-based: nothing is injected into a session. These settings only
// govern capture — what gets remembered after a session, and how eagerly.
export const SETTING_DEFAULTS = {
  enabled: true,
  autoSave: true,
  debounceMs: 8000,
  maxPerTurn: 4,
}

export class SettingsStore {
  constructor(dir) {
    this.file = join(dir, 'settings.json')
    this.data = { ...SETTING_DEFAULTS }
    this.loaded = false
    this.stamp = 0
  }

  load() {
    const stamp = stampOf(this.file)
    if (this.loaded && stamp === this.stamp) return this
    this.loaded = true
    this.stamp = stamp
    const raw = readJson(this.file, null)
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(SETTING_DEFAULTS)) {
        if (raw[key] !== undefined) this.data[key] = typeof SETTING_DEFAULTS[key] === 'boolean' ? raw[key] === true : raw[key]
      }
      this.data.debounceMs = Math.max(1000, Math.min(120000, Number(this.data.debounceMs) || SETTING_DEFAULTS.debounceMs))
    }
    return this
  }

  get() {
    this.load()
    return { ...this.data }
  }

  update(patch = {}) {
    this.load()
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in SETTING_DEFAULTS)) continue
      this.data[key] = typeof SETTING_DEFAULTS[key] === 'boolean' ? value === true : value
    }
    this.data.debounceMs = Math.max(1000, Math.min(120000, Number(this.data.debounceMs) || SETTING_DEFAULTS.debounceMs))
    writeJson(this.file, this.data)
    this.stamp = stampOf(this.file)
    return this.get()
  }
}

/** Pull the plain text out of a harness message (`content: [{type:'text', text}]`). */
export function messageText(message) {
  if (!message || typeof message !== 'object') return ''
  if (typeof message.text === 'string') return message.text
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
  }
  return ''
}

/**
 * Normalize one logged session event into a turn, or return null when the event
 * is not conversational text. Shapes differ per event type, hence the probing.
 */
export function turnOf(event, index) {
  const type = event?.type ?? ''
  const data = event?.data ?? {}
  let message = null
  let role = ''
  if (type === 'user/message') {
    message = data.message ?? data
    role = 'user'
  } else if (type === 'assistant/message') {
    message = data.message ?? data
    role = 'assistant'
  } else {
    return null
  }
  if (!message || typeof message !== 'object') return null
  const sourceKind = message.source && typeof message.source.kind === 'string' ? message.source.kind : ''
  // Our own profile injection arrives as a user message; re-ingesting it would
  // teach the store its own summary.
  if (sourceKind.startsWith('plugin:') || sourceKind === 'system') return null
  const text = messageText(message).trim()
  if (text === '') return null
  return {
    role,
    text,
    turn: Number.isFinite(data.turn) ? data.turn : index,
    seq: index,
    at: typeof data.at === 'string' ? data.at : typeof event?.at === 'string' ? event.at : nowIso(),
  }
}

export class CaptureEngine {
  /**
   * @param {{store: object, profile: object, inbox: object, settings: SettingsStore, log?: Function}} deps
   */
  constructor(deps) {
    this.store = deps.store
    this.profile = deps.profile
    this.inbox = deps.inbox
    this.settings = deps.settings
    this.log = typeof deps.log === 'function' ? deps.log : () => {}
    /** @type {Map<string, {turns: Array<object>, timer: any, index: number, injected: boolean, lastAt: string}>} */
    this.sessions = new Map()
    this.lastReport = null
    this.lastSessionId = ''
  }

  bucket(sessionId) {
    const key = typeof sessionId === 'string' && sessionId !== '' ? sessionId : 'unknown'
    let entry = this.sessions.get(key)
    if (!entry) {
      entry = { turns: [], timer: null, index: 0, injected: false, lastAt: '' }
      this.sessions.set(key, entry)
    }
    return entry
  }

  observe(session, event) {
    try {
      const id = sessionIdOf(session)
      if (id === '') return
      const entry = this.bucket(id)
      const turn = turnOf(event, entry.index)
      if (!turn) return
      entry.index += 1
      entry.lastAt = nowIso()
      entry.turns.push(turn)
      // A very long session should not accumulate forever; the tail is what
      // matters and the cap keeps memory bounded.
      if (entry.turns.length > 240) entry.turns.splice(0, entry.turns.length - 240)
      this.lastSessionId = id
    } catch (error) {
      this.log('observe failed', error)
    }
  }

  /**
   * Called when a turn stops. A short debounce lets the disposal path or the
   * next turn coalesce, so a burst of turns yields one extraction pass.
   */
  schedule(sessionId) {
    if (!this.settings.get().enabled) return
    const id = sessionId || this.lastSessionId
    if (id === '') return
    const entry = this.bucket(id)
    if (entry.timer) clearTimeout(entry.timer)
    const delay = this.settings.get().debounceMs
    entry.timer = setTimeout(() => {
      entry.timer = null
      try {
        this.finalize(id, 'turn')
      } catch (error) {
        this.log('capture failed', error)
      }
    }, delay)
    if (typeof entry.timer.unref === 'function') entry.timer.unref()
  }

  /** Extract now, route by confidence, and remember what was dropped and why. */
  finalize(sessionId, reason = 'disposed') {
    const id = sessionId || this.lastSessionId
    const entry = this.sessions.get(id)
    if (!entry) return { scanned: 0, saved: 0, queued: 0, skipped: 0 }
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    if (!this.settings.get().enabled) {
      entry.turns = []
      return { scanned: 0, saved: 0, queued: 0, skipped: 0 }
    }
    const turns = entry.turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    entry.turns = []
    if (turns.length === 0) return { scanned: 0, saved: 0, queued: 0, skipped: 0 }

    const settings = this.settings.get()
    const existing = [
      ...this.store.list().map((item) => ({ title: item.title, content: item.content })),
      ...this.profile.facets().map((facet) => ({ title: facet.title, content: facet.text })),
    ]
    const { candidates, dropped, scanned } = extractCandidates(turns, {
      existing,
      maxPerBatch: Math.max(THRESHOLDS.maxPerBatch, settings.maxPerTurn * 2),
    })

    let saved = 0
    let queued = 0
    for (const candidate of candidates) {
      const origin = {
        sessionId: id,
        turn: candidate.turn,
        quote: candidate.quote,
        rule: candidate.rule,
        at: nowIso(),
      }
      const auto = settings.autoSave
      const threshold = candidate.target === 'profile' ? THRESHOLDS.autoSaveProfile : THRESHOLDS.autoSaveMemory
      try {
        if (auto && candidate.confidence >= threshold) {
          this.save(candidate, origin)
          saved += 1
        } else {
          this.inbox.add(candidate, origin)
          queued += 1
        }
      } catch (error) {
        queued += 1
        this.log('candidate dropped on write', error)
      }
    }

    const droppedSummary = summarizeDrops(dropped)
    this.lastReport = {
      sessionId: id,
      reason,
      at: nowIso(),
      scanned,
      found: candidates.length,
      saved,
      queued,
      dropped: droppedSummary,
    }
    this.log('capture report', this.lastReport)
    return this.lastReport
  }

  save(candidate, origin) {
    if (candidate.target === 'profile') {
      this.profile.addFacet({
        category: candidate.category || 'preference',
        title: candidate.title,
        text: candidate.content,
        tags: candidate.tags,
        confidence: candidate.confidence,
        source: 'capture',
        origin,
      })
      return
    }
    const created = this.store.create({
      title: candidate.title,
      content: candidate.content,
      tags: candidate.tags,
      kind: candidate.kind,
      importance: candidate.importance,
      scope: 'global',
      source: 'capture',
      origin,
    })
    return created
  }

  /** Accepting an inbox row reuses exactly the same write path as auto-save. */
  accept(item) {
    const origin = item.origin ?? { at: nowIso() }
    return this.save(
      {
        target: item.target,
        category: item.category,
        title: item.title,
        content: item.content,
        tags: item.tags,
        kind: item.kind,
        importance: item.importance,
        confidence: item.confidence,
      },
      origin,
    )
  }

  flushAll(reason = 'manual') {
    const reports = []
    for (const id of [...this.sessions.keys()]) reports.push(this.finalize(id, reason))
    return reports
  }


  stats() {
    return {
      sessions: this.sessions.size,
      buffered: [...this.sessions.values()].reduce((sum, entry) => sum + entry.turns.length, 0),
      lastReport: this.lastReport,
      settings: this.settings.get(),
    }
  }
}

function summarizeDrops(dropped) {
  const counts = {}
  for (const row of dropped) counts[row.reason] = (counts[row.reason] ?? 0) + 1
  return counts
}

function sessionIdOf(session) {
  const candidates = [session?.id, session?.sessionId, session?.header?.id]
  for (const value of candidates) if (typeof value === 'string' && value !== '') return value
  return ''
}

export function resolveSessionId(payload) {
  const agent = payload?.agent ?? payload
  const candidates = [agent?.session?.id, agent?.sessionId, payload?.session?.id, payload?.sessionId, agent?.id]
  for (const value of candidates) if (typeof value === 'string' && value !== '') return value
  return ''
}

/** A normalizer shared by the client detail pane and the profile tool. */
export function previewText(value, max = 120) {
  return normalizeText(value).slice(0, max)
}
