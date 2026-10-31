/**
 * dsh-memory-studio — server half.
 *
 * A small, self-contained memory store for DeepSeek Harness. It owns one JSON
 * file on disk, serves it to the browser half over exact webServer routes, and
 * publishes a handful of tools so an Agent can read and write the same store.
 *
 * The store is deliberately dependency-free and synchronous: the file is small,
 * every mutation is atomic (tmp + rename), and a corrupt file never takes the
 * plugin down — it is moved aside and an empty store opens in its place.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildGraph, buildProfileGraph, relatedOf, GRAPH_WEIGHTS, PROFILE_GRAPH_WEIGHTS } from './graph.js'
import { ProfileStore, CATEGORIES, CATEGORY_LABELS } from './profile.js'
import { InboxStore } from './inbox.js'
import { CaptureEngine, SettingsStore, resolveSessionId } from './capture.js'
import { buildIndex, rank, EMBEDDING } from './retrieval.js'
import { buildProfileTree, buildTree, TREE } from './tree.js'
import { stampOf } from './jsonfile.js'

export const name = 'dsh-memory-studio'

/** Route prefix. The page fetches these same-origin, so it is also the client's only contract. */
const API = '/dsh-memory-studio/api'
const MAX_BODY = 1024 * 1024
const MAX_ITEMS = 5000

export const KINDS = ['fact', 'preference', 'decision', 'insight', 'todo', 'entity']
export const SCOPES = ['global', 'workspace']

const LIMIT = {
  title: 160,
  content: 20000,
  tag: 40,
  tags: 16,
  id: 64,
}

function nowIso() {
  return new Date().toISOString()
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Tags arrive as an array from the API and as a comma string from a tool call. */
export function normalizeTags(input) {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,，\n]/)
      : []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const tag = text(String(raw), LIMIT.tag).replace(/^#+/, '')
    if (tag === '') continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= LIMIT.tags) break
  }
  return out
}

/** Explicit edges a human or agent drew between two memories. */
export function normalizeLinks(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const raw of input) {
    const to = text(raw?.to ?? raw?.id, LIMIT.id)
    if (to === '' || seen.has(to)) continue
    seen.add(to)
    out.push({ to, type: text(raw?.type, 40) || 'related' })
    if (out.length >= 24) break
  }
  return out
}

/** Where an auto-captured memory came from: the audit trail that makes it checkable. */
function normalizeOrigin(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const sessionId = text(raw.sessionId, 200)
  const quote = text(raw.quote, 600)
  const rule = text(raw.rule, 60)
  if (sessionId === '' && quote === '' && rule === '') return undefined
  return {
    sessionId,
    turn: clampInt(raw.turn, 0, 1e9, 0),
    quote,
    rule,
    at: text(raw.at, 40) || nowIso(),
  }
}

/** One canonical shape, whether it came from the disk, the API or a tool. */
export function normalizeItem(raw = {}) {
  const content = text(raw.content ?? raw.text ?? raw.body, LIMIT.content)
  const title = text(raw.title ?? raw.name, LIMIT.title) || content.split('\n')[0].slice(0, 80) || '未命名记忆'
  return {
    id: text(raw.id, LIMIT.id) || `mem_${randomUUID().slice(0, 8)}`,
    title,
    content,
    tags: normalizeTags(raw.tags),
    links: normalizeLinks(raw.links),
    origin: normalizeOrigin(raw.origin),
    kind: oneOf(raw.kind, KINDS, 'fact'),
    scope: oneOf(raw.scope, SCOPES, 'global'),
    workspace: text(raw.workspace, 500),
    importance: clampInt(raw.importance, 1, 5, 3),
    pinned: raw.pinned === true,
    archived: raw.archived === true,
    source: oneOf(raw.source, ['manual', 'agent', 'import', 'capture'], 'manual'),
    hits: clampInt(raw.hits, 0, 1e9, 0),
    createdAt: text(raw.createdAt, 40) || nowIso(),
    updatedAt: text(raw.updatedAt, 40) || nowIso(),
    lastHitAt: text(raw.lastHitAt, 40) || '',
  }
}

/** Fields a caller is allowed to change, in the order they are documented. */
const MUTABLE = ['title', 'content', 'tags', 'links', 'kind', 'scope', 'workspace', 'importance', 'pinned', 'archived']

function applyPatch(item, patch = {}) {
  const next = { ...item }
  for (const key of MUTABLE) {
    if (!(key in patch)) continue
    const value = patch[key]
    switch (key) {
      case 'title':
        next.title = text(value, LIMIT.title) || next.title
        break
      case 'content':
        next.content = text(value, LIMIT.content)
        break
      case 'tags':
        next.tags = normalizeTags(value)
        break
      case 'links':
        next.links = normalizeLinks(value)
        break
      case 'kind':
        next.kind = oneOf(value, KINDS, next.kind)
        break
      case 'scope':
        next.scope = oneOf(value, SCOPES, next.scope)
        break
      case 'workspace':
        next.workspace = text(value, 500)
        break
      case 'importance':
        next.importance = clampInt(value, 1, 5, next.importance)
        break
      case 'pinned':
        next.pinned = value === true
        break
      case 'archived':
        next.archived = value === true
        break
      default:
        break
    }
  }
  if (typeof patch.title === 'string' && next.title === '') next.title = next.content.split('\n')[0].slice(0, 80)
  if (typeof patch.title === 'string' && next.title === '') next.title = '未命名记忆'
  next.updatedAt = nowIso()
  return next
}

/** Case-insensitive match with a small, explainable ranking. */
export function scoreItem(item, query) {
  if (query === '') return 1
  const q = query.toLowerCase()
  const title = item.title.toLowerCase()
  const content = item.content.toLowerCase()
  const tags = item.tags.map((tag) => tag.toLowerCase())
  if (title.includes(q)) return 100 - title.indexOf(q)
  if (tags.some((tag) => tag.includes(q))) return 80
  if (content.includes(q)) return 60 - Math.min(40, content.indexOf(q) / 40)
  return 0
}

export class MemoryStore {
  constructor(dir) {
    this.dir = dir
    this.file = join(dir, 'memories.json')
    this.items = []
    this.index = null
    this.loaded = false
    this.dirty = false
    this.stamp = 0
  }

  load() {
    const stamp = stampOf(this.file)
    if (this.loaded && stamp === this.stamp) return this
    this.loaded = true
    this.stamp = stamp
    if (!existsSync(this.file)) {
      this.items = []
      return this
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      const list = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : []
      this.items = list.map(normalizeItem)
    } catch (error) {
      // Keep the broken file for inspection instead of overwriting it on the
      // next save: a parse failure here is exactly the case where the content
      // might still be recoverable by hand.
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        /* the store still opens empty */
      }
      this.items = []
      console.warn('[dsh-memory-studio] memories.json was unreadable; it has been moved aside:', error?.message ?? error)
    }
    return this
  }

  persist() {
    mkdirSync(this.dir, { recursive: true })
    const payload = JSON.stringify({ version: 2, updatedAt: nowIso(), items: this.items }, null, 2)
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, payload, 'utf8')
    renameSync(tmp, this.file)
    this.dirty = false
    this.index = null
    this.stamp = stampOf(this.file)
  }

  /** Rebuild the vector index lazily; every mutation drops the cached one. */
  ensureIndex() {
    const items = this.list()
    if (this.index === null || this.index.items !== items || this.index.items.length !== items.length) {
      this.index = buildIndex(items)
    }
    return this.index
  }

  list() {
    this.load()
    return this.items
  }

  count() {
    return this.list().length
  }

  get(id) {
    const key = text(id, LIMIT.id)
    if (key === '') return undefined
    return this.list().find((item) => item.id === key)
  }

  create(input = {}) {
    this.load()
    if (this.items.length >= MAX_ITEMS) throw new Error(`memory store is full (${MAX_ITEMS} items)`)
    const item = normalizeItem({ ...input, id: undefined, createdAt: nowIso(), updatedAt: nowIso(), hits: 0 })
    item.source = oneOf(input.source, ['manual', 'agent', 'import'], 'manual')
    this.items.unshift(item)
    this.persist()
    return item
  }

  update(id, patch = {}) {
    this.load()
    const index = this.items.findIndex((item) => item.id === id)
    if (index < 0) return undefined
    const next = applyPatch(this.items[index], patch)
    this.items[index] = next
    this.persist()
    return next
  }

  remove(id) {
    this.load()
    const index = this.items.findIndex((item) => item.id === id)
    if (index < 0) return false
    this.items.splice(index, 1)
    this.persist()
    return true
  }

  /** Draw an explicit edge. Stored on one side only; the graph draws both. */
  link(fromId, toId, type = 'related') {
    const from = this.get(fromId)
    const to = this.get(toId)
    if (!from || !to || from.id === to.id) return undefined
    return this.update(from.id, {
      links: [...from.links.filter((entry) => entry.to !== to.id), { to: to.id, type: text(type, 40) || 'related' }],
    })
  }

  unlink(fromId, toId) {
    const from = this.get(fromId)
    if (!from) return undefined
    return this.update(from.id, { links: from.links.filter((entry) => entry.to !== toId) })
  }

  /** Nodes and derived edges, ready for the canvas. */
  graph(options = {}) {
    return buildGraph(this.list(), options)
  }

  /** Record that a memory was read by an Agent, which is what makes recency meaningful. */
  hit(id) {
    const item = this.get(id)
    if (!item) return undefined
    item.hits += 1
    item.lastHitAt = nowIso()
    this.persist()
    return item
  }

  /**
   * A prior that keeps importance, pins and freshness in the ranking even when
   * the query is a loose paraphrase. All three terms are 0..1.
   */
  prior(item) {
    const importance = clampInt(item.importance, 1, 5, 3) / 5
    const pinned = item.pinned ? 1 : 0
    const stamp = Date.parse(item.updatedAt ?? '')
    const age = Number.isFinite(stamp) ? Date.now() - stamp : Infinity
    const freshness = Number.isFinite(age) ? Math.exp(-Math.max(0, age) / (1000 * 60 * 60 * 24 * 45)) : 0.3
    return 0.45 * importance + 0.25 * pinned + 0.3 * freshness
  }

  /**
   * Hybrid retrieval: vector similarity + keyword exactness + prior, then a
   * small one-hop graph expansion so a hit can drag a related memory up.
   *
   * @returns {Array<{item: object, score: number, vector: number, lexical: number, prior: number}>}
   */
  searchDetailed(query, options = {}) {
    const limit = clampInt(options.limit, 1, 100, 10)
    const kind = KINDS.includes(options.kind) ? options.kind : ''
    const tag = text(options.tag, LIMIT.tag).toLowerCase()
    const includeArchived = options.includeArchived === true
    const q = text(query, 200)
    const pool = this.list()
      .filter((item) => (includeArchived || !item.archived))
      .filter((item) => (kind === '' ? true : item.kind === kind))
      .filter((item) => (tag === '' ? true : item.tags.some((value) => value.toLowerCase() === tag)))
    if (pool.length === 0) return []
    const index = buildIndex(pool)
    const rows = rank(index, q, {
      lexical: (item) => (q === '' ? 0 : Math.min(1, scoreItem(item, q) / 100)),
      prior: (item) => this.prior(item),
    })
    if (q !== '' && pool.length > 1 && pool.length <= 400 && rows.length > 1) {
      let graph
      try {
        graph = buildGraph(pool)
      } catch {
        graph = null
      }
      if (graph) {
        const byId = new Map(rows.map((row) => [row.item.id, row]))
        const boost = new Map()
        for (const seed of rows.slice(0, 6)) {
          for (const edge of graph.edges) {
            const other = edge.source === seed.item.id ? edge.target : edge.target === seed.item.id ? edge.source : ''
            if (other === '') continue
            const gain = 0.06 * edge.weight * seed.score
            if (gain > (boost.get(other) ?? 0)) boost.set(other, gain)
          }
        }
        if (boost.size > 0) {
          for (const [id, gain] of boost) {
            const row = byId.get(id)
            if (row) row.score += gain
          }
          rows.sort((a, b) => b.score - a.score)
        }
      }
    }
    return rows.slice(0, limit)
  }

  search(query, options = {}) {
    return this.searchDetailed(query, options).map((row) => row.item)
  }

  /**
   * The parent view of a captured memory: every memory that came out of the
   * same session, in turn order. Memories remember where they were said, so the
   * episode can be derived instead of stored twice.
   *
   * @param {string} sessionId
   * @returns {{sessionId: string, items: Array<object>}}
   */
  episode(sessionId) {
    const id = text(sessionId, 120)
    if (id === '') return { sessionId: '', items: [] }
    const items = this.list()
      .filter((item) => item.origin?.sessionId === id)
      .sort((a, b) => (a.origin?.turn ?? 0) - (b.origin?.turn ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)))
    return { sessionId: id, items }
  }

  /**
   * The navigation view over the same items: topics (tag components) or
   * sessions, each split by kind or turn. Derived on read, never stored.
   *
   * @param {'topic'|'session'} mode
   * @param {{includeArchived?: boolean}} options
   */
  tree(mode = 'topic', options = {}) {
    return buildTree(this.list(), { mode, includeArchived: options.includeArchived === true })
  }

  stats() {
    const items = this.list()
    const active = items.filter((item) => !item.archived)
    const week = Date.now() - 7 * 24 * 60 * 60 * 1000
    const tags = new Set()
    for (const item of items) for (const tag of item.tags) tags.add(tag)
    return {
      total: items.length,
      active: active.length,
      archived: items.length - active.length,
      pinned: items.filter((item) => item.pinned).length,
      tags: tags.size,
      recent: items.filter((item) => Date.parse(item.updatedAt) >= week).length,
    }
  }
}

export function storeDir() {
  const override = process.env.DSH_MEMORY_STUDIO_DIR
  if (typeof override === 'string' && override.trim() !== '') return override.trim()
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'memory-studio')
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function sendText(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': type })
  response.end(body)
}

function readBody(request, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('payload too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new Error('invalid json body'))
      }
    })
    request.on('error', reject)
  })
}

/** One exact route each, so no path parsing and no prefix fence to get past. */
export function buildRoutes(store) {
  const guard = (methods, handle) => async (request, response) => {
    try {
      if (!methods.includes(request.method)) {
        response.writeHead(405, { allow: methods.join(', ') })
        response.end()
        return
      }
      await handle(request, response)
    } catch (error) {
      sendJson(response, 400, { error: error?.message ?? String(error) })
    }
  }

  return [
    {
      kind: 'exact',
      path: `${API}/state`,
      handler: guard(['GET'], async (request, response) => {
        sendJson(response, 200, {
          items: store.list(),
          stats: store.stats(),
          kinds: KINDS,
          scopes: SCOPES,
          storeFile: store.file,
        })
      }),
    },
    {
      kind: 'exact',
      path: `${API}/search`,
      handler: guard(['GET'], async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        const started = Date.now()
        const rows = store.searchDetailed(url.searchParams.get('q') ?? '', {
          kind: url.searchParams.get('kind') ?? '',
          tag: url.searchParams.get('tag') ?? '',
          limit: url.searchParams.get('limit') ?? 20,
          includeArchived: url.searchParams.get('archived') === '1',
        })
        const round = (value) => Number(value.toFixed(4))
        sendJson(response, 200, {
          query: url.searchParams.get('q') ?? '',
          rows: rows.map((row) => ({
            item: row.item,
            score: {
              total: round(row.score),
              vector: round(row.vector),
              lexical: round(row.lexical),
              exact: round(row.exact ?? 0),
              prior: round(row.prior),
            },
            match: row.match ?? null,
            matches: row.matches ?? 0,
          })),
          took: Date.now() - started,
          embedding: EMBEDDING,
        })
      }),
    },
    {
      kind: 'exact',
      path: `${API}/items`,
      handler: guard(['POST'], async (request, response) => {
        const body = await readBody(request)
        const item = store.create({ ...body, source: 'manual' })
        sendJson(response, 200, { item })
      }),
    },
    {
      kind: 'exact',
      path: `${API}/items/update`,
      handler: guard(['POST'], async (request, response) => {
        const body = await readBody(request)
        const item = store.update(text(body.id, LIMIT.id), body.patch ?? body)
        if (!item) {
          sendJson(response, 404, { error: 'memory not found' })
          return
        }
        sendJson(response, 200, { item })
      }),
    },
    {
      kind: 'exact',
      path: `${API}/items/delete`,
      handler: guard(['POST'], async (request, response) => {
        const body = await readBody(request)
        const removed = store.remove(text(body.id, LIMIT.id))
        if (!removed) {
          sendJson(response, 404, { error: 'memory not found' })
          return
        }
        sendJson(response, 200, { ok: true })
      }),
    },
    {
      kind: 'exact',
      path: `${API}/items/import`,
      handler: guard(['POST'], async (request, response) => {
        const body = await readBody(request)
        const list = Array.isArray(body.items) ? body.items : []
        let added = 0
        let skipped = 0
        for (const raw of list) {
          const content = text(raw?.content, LIMIT.content)
          if (content === '' && text(raw?.title, LIMIT.title) === '') {
            skipped += 1
            continue
          }
          const duplicate = store.list().some((item) => item.title === text(raw?.title, LIMIT.title) && item.content === content)
          if (duplicate) {
            skipped += 1
            continue
          }
          store.create({ ...raw, source: 'import' })
          added += 1
        }
        sendJson(response, 200, { added, skipped })
      }),
    },
    {
      kind: 'exact',
      path: `${API}/export`,
      handler: guard(['GET'], async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (url.searchParams.get('format') === 'md') {
          const lines = ['# 记忆库导出', '', `导出时间：${nowIso()}`, '']
          for (const item of store.list()) {
            lines.push(`## ${item.title}`, '')
            lines.push(`- 类型：${item.kind}　重要度：${item.importance}　范围：${item.scope}`)
            if (item.tags.length > 0) lines.push(`- 标签：${item.tags.join(', ')}`)
            lines.push(`- 更新：${item.updatedAt}`)
            lines.push('', item.content, '')
          }
          sendText(response, 200, lines.join('\n'), 'text/markdown; charset=utf-8')
          return
        }
        sendText(
          response,
          200,
          JSON.stringify({ version: 1, exportedAt: nowIso(), items: store.list() }, null, 2),
          'application/json; charset=utf-8',
        )
      }),
    },
    {
      kind: 'exact',
      path: `${API}/episode`,
      handler: guard(['GET'], async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const episode = store.episode(url.searchParams.get('session') ?? '')
        sendJson(response, 200, { ...episode, count: episode.items.length })
      }),
    },
    {
      kind: 'exact',
      path: `${API}/tree`,
      handler: guard(['GET'], async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const mode = url.searchParams.get('mode') === 'session' ? 'session' : 'topic'
        const tree = store.tree(mode, { includeArchived: url.searchParams.get('archived') === '1' })
        sendJson(response, 200, { ...tree, tree: TREE })
      }),
    },
  ]
}

function guardRoutes(methods, handle) {
  return async (request, response) => {
    try {
      if (!methods.includes(request.method)) {
        response.writeHead(405, { allow: methods.join(', ') })
        response.end()
        return
      }
      await handle(request, response)
    } catch (error) {
      sendJson(response, 400, { error: error?.message ?? String(error) })
    }
  }
}

function acceptInboxItem(item, store, profile) {
  if (item.target === 'profile') {
    profile.addFacet({
      category: item.category || 'preference',
      title: item.title,
      text: item.content,
      tags: item.tags,
      confidence: item.confidence,
      source: 'capture',
      origin: item.origin,
    })
    return 'profile'
  }
  store.create({
    title: item.title,
    content: item.content,
    tags: item.tags,
    kind: item.kind,
    importance: item.importance,
    source: 'capture',
    origin: item.origin,
  })
  return 'memory'
}

/**
 * The routes added for capture, the profile, the graph and the inbox.
 *
 * Kept apart from the original six so the first contract stays untouched:
 * `/state` still answers exactly the page's original question, and a client that
 * only knows the old API keeps working.
 */
export function buildExtraRoutes(deps = {}) {
  const { store, profile, inbox, settings, capture } = deps
  const API_BASE = API
  const routes = []

  if (store) {
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/graph`,
      handler: guardRoutes(['GET'], async (request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const graph = store.graph({ includeArchived: url.searchParams.get('archived') === '1' })
        sendJson(response, 200, { ...graph, weights: GRAPH_WEIGHTS })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/items/link`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        const from = store.link(text(body.from, LIMIT.id), text(body.to, LIMIT.id), text(body.type, 40))
        if (!from) {
          sendJson(response, 404, { error: 'both memories must exist' })
          return
        }
        sendJson(response, 200, { item: from })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/items/unlink`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        const from = store.unlink(text(body.from, LIMIT.id), text(body.to, LIMIT.id))
        if (!from) {
          sendJson(response, 404, { error: 'memory not found' })
          return
        }
        sendJson(response, 200, { item: from })
      }),
    })
  }

  if (profile) {
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/profile`,
      handler: guardRoutes(['GET'], async (request, response) => {
        sendJson(response, 200, {
          profile: profile.get(),
          categories: CATEGORIES,
          labels: CATEGORY_LABELS,
          summary: profile.renderSummary(),
          file: profile.file,
        })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/profile/tree`,
      handler: guardRoutes(['GET'], async (request, response) => {
        const tree = buildProfileTree(profile.get())
        sendJson(response, 200, { ...tree, tree: TREE })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/profile/graph`,
      handler: guardRoutes(['GET'], async (request, response) => {
        const graph = buildProfileGraph(profile.get())
        sendJson(response, 200, { ...graph, weights: PROFILE_GRAPH_WEIGHTS })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/profile/identity`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        sendJson(response, 200, { identity: profile.setIdentity(body) })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/profile/facets`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        const result = profile.addFacet({ ...body, source: 'manual' })
        sendJson(response, 200, result)
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/profile/facets/update`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        const facet = profile.updateFacet(text(body.id, LIMIT.id), body.patch ?? body)
        if (!facet) {
          sendJson(response, 404, { error: 'facet not found' })
          return
        }
        sendJson(response, 200, { facet })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/profile/facets/delete`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        const removed = profile.removeFacet(text(body.id, LIMIT.id))
        sendJson(response, removed ? 200 : 404, removed ? { ok: true } : { error: 'facet not found' })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/profile/forget`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        const removed = profile.forget(text(body.query, 200))
        sendJson(response, 200, { removed: removed.map((facet) => facet.id), count: removed.length })
      }),
    })
  }

  if (inbox) {
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/inbox`,
      handler: guardRoutes(['GET'], async (request, response) => {
        sendJson(response, 200, { items: inbox.list(), count: inbox.count(), file: inbox.file })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/inbox/accept`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        const id = text(body.id, LIMIT.id)
        const item = inbox.get(id)
        if (!item) {
          sendJson(response, 404, { error: 'inbox item not found' })
          return
        }
        let saved
        if (capture) saved = capture.accept(item)
        else saved = acceptInboxItem(item, store, profile)
        inbox.remove(id)
        sendJson(response, 200, { ok: true, target: item.target, saved: saved?.id ?? '' })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/inbox/dismiss`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const body = await readBody(request)
        const removed = inbox.remove(text(body.id, LIMIT.id))
        sendJson(response, removed ? 200 : 404, removed ? { ok: true } : { error: 'inbox item not found' })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/inbox/accept-all`,
      handler: guardRoutes(['POST'], async (request, response) => {
        const items = [...inbox.list()]
        let accepted = 0
        for (const item of items) {
          try {
            if (capture) capture.accept(item)
            else acceptInboxItem(item, store, profile)
            inbox.remove(item.id)
            accepted += 1
          } catch (error) {
            console.warn('[dsh-memory-studio] accept-all skipped one row:', error?.message ?? error)
          }
        }
        sendJson(response, 200, { accepted })
      }),
    })
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/inbox/clear`,
      handler: guardRoutes(['POST'], async (request, response) => {
        sendJson(response, 200, { removed: inbox.clear() })
      }),
    })
  }

  if (settings) {
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/settings`,
      handler: guardRoutes(['GET', 'POST'], async (request, response) => {
        if (request.method === 'GET') {
          sendJson(response, 200, { settings: settings.get(), file: settings.file })
          return
        }
        const body = await readBody(request)
        sendJson(response, 200, { settings: settings.update(body) })
      }),
    })
  }

  if (capture) {
    routes.push({
      kind: 'exact',
      path: `${API_BASE}/capture`,
      handler: guardRoutes(['GET', 'POST'], async (request, response) => {
        if (request.method === 'GET') {
          sendJson(response, 200, capture.stats())
          return
        }
        const body = await readBody(request)
        if (body.sessionId) {
          sendJson(response, 200, { report: capture.finalize(text(body.sessionId, 200), 'manual') })
          return
        }
        sendJson(response, 200, { reports: capture.flushAll('manual') })
      }),
    })
  }

  return routes
}

/** One line the model can act on; ids are the handle every other tool takes. */
function brief(item) {
  const snippet = item.content.replace(/\s+/g, ' ').slice(0, 140)
  const tags = item.tags.length > 0 ? ` tags=${item.tags.join(',')}` : ''
  return `- [${item.id}] (${item.kind}${item.pinned ? ', pinned' : ''}, importance ${item.importance}) ${item.title}${tags}\n  ${snippet}`
}

function full(item) {
  return [
    `id: ${item.id}`,
    `title: ${item.title}`,
    `kind: ${item.kind}  importance: ${item.importance}  scope: ${item.scope}${item.pinned ? '  pinned: true' : ''}${item.archived ? '  archived: true' : ''}`,
    item.tags.length > 0 ? `tags: ${item.tags.join(', ')}` : 'tags: (none)',
    `created: ${item.createdAt}  updated: ${item.updatedAt}  hits: ${item.hits}`,
    '',
    item.content,
  ].join('\n')
}

function snippet(value, max = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function asString(value, fallback = '') {
  if (value === undefined || value === null) return fallback
  return typeof value === 'string' ? value : String(value)
}

/**
 * Tool parameters are strings on purpose: the harness projects tool schemas
 * conservatively, and a numeric knob sent as "4" costs nothing while a rejected
 * schema would cost the whole tool. Every handler coerces.
 */
export function toolSpecs(store, extras = {}) {
  const register = (spec) => spec
  return [
    register({
      name: 'memory_write',
      description:
        'Save one durable memory for later sessions: a user preference, a project fact, a decision with its reason, an insight, a todo, or an entity profile. Use it when something would be costly to re-derive. Returns the new id.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short label, one line.' },
          content: { type: 'string', description: 'The memory itself. Self-contained: say what, and why it matters.' },
          tags: { type: 'string', description: 'Comma separated tags.' },
          kind: { type: 'string', description: `One of ${KINDS.join(', ')}. Default fact.` },
          importance: { type: 'string', description: '1 to 5, 5 = never forget. Default 3.' },
          scope: { type: 'string', description: 'global or workspace. Default global.' },
        },
        required: ['title', 'content'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const item = store.create({
          title: asString(args.title),
          content: asString(args.content),
          tags: asString(args.tags),
          kind: asString(args.kind, 'fact'),
          importance: asString(args.importance, '3'),
          scope: asString(args.scope, 'global'),
          source: 'agent',
        })
        return `saved ${item.id} — ${item.title}`
      },
    }),
    register({
      name: 'memory_search',
      description:
        'Search saved memories. Ranking blends embedding similarity (so a paraphrase still lands), exact keyword matches and a prior built from importance, pins and freshness, then widens one hop through the memory graph. Call this when the user refers to an earlier session, a past decision or a rule they set, or before asking something they may already have answered. Nothing is injected automatically, so this is how you recall.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords. Empty returns the most recent memories.' },
          tags: { type: 'string', description: 'Optional comma separated tags, all must match.' },
          kind: { type: 'string', description: `Optional kind filter: ${KINDS.join(', ')}.` },
          limit: { type: 'string', description: 'Maximum results, default 10.' },
        },
        required: ['query'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const limit = clampInt(asString(args.limit, '10'), 1, 50, 10)
        const tags = normalizeTags(asString(args.tags))
        const rows = store
          .searchDetailed(asString(args.query), { kind: asString(args.kind), limit: 100 })
          .filter((row) => (tags.length === 0 ? true : tags.every((tag) => row.item.tags.some((t) => t.toLowerCase() === tag.toLowerCase()))))
          .slice(0, limit)
        if (rows.length === 0) return 'No memories matched.'
        return rows.map((row) => `${brief(row.item)} [${row.score.toFixed(2)}]`).join('\n')
      },
    }),
    register({
      name: 'memory_brief',
      description:
        'A small digest of what memory already knows: the user profile in a line or two, plus the titles of pinned and recent memories. Call it once when a task depends on who the user is or what was decided earlier. Nothing is injected automatically — memory is pulled, not pushed.',
      parameters: { type: 'object', properties: {}, required: [] },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() {
        const lines = []
        const summary = extras.profile ? extras.profile.renderSummary(320) : ''
        if (summary !== '') lines.push(summary)
        const items = store.list().filter((item) => !item.archived)
        const pinned = items.filter((item) => item.pinned).slice(0, 6)
        const recent = items.filter((item) => !item.pinned).slice(0, 6)
        if (pinned.length > 0) lines.push(`Pinned:\n${pinned.map((item) => `- ${item.id} · ${item.title}`).join('\n')}`)
        if (recent.length > 0) lines.push(`Recent:\n${recent.map((item) => `- ${item.id} · ${item.title}`).join('\n')}`)
        if (lines.length === 0) return 'Memory is empty.'
        lines.push('Open one with memory_read <id>, or search with memory_search <keywords>.')
        return lines.join('\n\n').slice(0, 1200)
      },
    }),
    register({
      name: 'memory_read',
      description:
        'Read one memory in full by id, and count it as used. If the memory was captured from a conversation, the reply also lists what else came out of that same session — the parent context a single assertion loses.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Memory id, e.g. mem_1a2b3c4d.' } },
        required: ['id'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const item = store.get(asString(args.id))
        if (!item) return `No memory with id ${asString(args.id)}.`
        store.hit(item.id)
        const lines = [full(item)]
        const sessionId = item.origin?.sessionId ?? ''
        if (sessionId !== '') {
          const siblings = store.episode(sessionId).items.filter((other) => other.id !== item.id)
          const origin = item.origin.turn ? `turn ${item.origin.turn}` : 'session'
          lines.push(`Origin: ${sessionId} · ${origin}${item.origin.quote ? ` · "${snippet(item.origin.quote, 120)}"` : ''}`)
          if (siblings.length > 0) {
            lines.push(`Same session (${siblings.length + 1} memories):\n${siblings.map((other) => `- ${other.id} · ${other.title} [${other.kind}]`).join('\n')}`)
          }
        }
        return lines.join('\n\n')
      },
    }),
    register({
      name: 'memory_list',
      description: 'List memories newest first, optionally filtered by kind, tag or archive state.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: `Optional kind: ${KINDS.join(', ')}.` },
          tags: { type: 'string', description: 'Optional comma separated tags.' },
          archived: { type: 'string', description: '"true" to include archived memories.' },
          limit: { type: 'string', description: 'Maximum results, default 20.' },
        },
        required: [],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const limit = clampInt(asString(args.limit, '20'), 1, 100, 20)
        const tags = normalizeTags(asString(args.tags))
        const rows = store
          .list()
          .filter((item) => (asString(args.archived) === 'true' ? true : !item.archived))
          .filter((item) => (asString(args.kind) === '' ? true : item.kind === asString(args.kind)))
          .filter((item) => (tags.length === 0 ? true : tags.every((tag) => item.tags.some((t) => t.toLowerCase() === tag.toLowerCase()))))
          .slice(0, limit)
        if (rows.length === 0) return 'The memory store is empty.'
        return rows.map(brief).join('\n')
      },
    }),
    register({
      name: 'memory_update',
      description: 'Change fields of an existing memory: title, content, tags, kind, importance, scope, pinned, archived.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory id.' },
          title: { type: 'string', description: 'New title.' },
          content: { type: 'string', description: 'Replacement body.' },
          tags: { type: 'string', description: 'Replacement tags, comma separated.' },
          kind: { type: 'string', description: `New kind: ${KINDS.join(', ')}.` },
          importance: { type: 'string', description: '1 to 5.' },
          scope: { type: 'string', description: 'global or workspace.' },
          pinned: { type: 'string', description: '"true" to pin.' },
          archived: { type: 'string', description: '"true" to archive.' },
        },
        required: ['id'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const id = asString(args.id)
        const patch = {}
        for (const key of ['title', 'content', 'tags', 'kind', 'importance', 'scope']) {
          if (args[key] !== undefined && asString(args[key]) !== '') patch[key] = asString(args[key])
        }
        for (const key of ['pinned', 'archived']) {
          if (args[key] !== undefined) patch[key] = asString(args[key]) === 'true'
        }
        const item = store.update(id, patch)
        if (!item) return `No memory with id ${id}.`
        return `updated ${item.id} — ${item.title}`
      },
    }),
    register({
      name: 'memory_delete',
      description: 'Delete one memory by id. Prefer archiving over deleting when unsure.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Memory id.' } },
        required: ['id'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const id = asString(args.id)
        return store.remove(id) ? `deleted ${id}` : `No memory with id ${id}.`
      },
    }),
    register({
      name: 'profile_read',
      description:
        'Read the long-term user profile: a curated portrait of the person (identity, work, tooling, preferences, constraints, goals), separate from work memories. Call it before tailoring an answer to the user.',
      parameters: { type: 'object', properties: {}, required: [] },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute() {
        const profile = extras.profile
        if (!profile) return 'The profile store is unavailable.'
        const summary = profile.renderSummary(1200)
        const facets = profile.facets()
        if (summary === '' && facets.length === 0) return 'The user profile is empty.'
        const lines = [summary === '' ? '(no summary yet)' : summary, '', `facets: ${facets.length}`]
        for (const facet of facets.slice(0, 40)) lines.push(`- [${facet.id}] ${facet.category} · ${facet.text}`)
        return lines.join('\n')
      },
    }),
    register({
      name: 'profile_write',
      description:
        'Save one durable fact about the user into their profile (not the memory list): who they are, what they work on, which tools they use, what they prefer, what limits them, what they are aiming at. Prefer the user\'s own words.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: `One of ${CATEGORIES.join(', ')}.` },
          text: { type: 'string', description: 'The fact, in the user\'s terms, one or two sentences.' },
          title: { type: 'string', description: 'Optional short label.' },
          confidence: { type: 'string', description: '0 to 1. Default 1 for an explicit statement.' },
        },
        required: ['category', 'text'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const profile = extras.profile
        if (!profile) return 'The profile store is unavailable.'
        const category = asString(args.category, 'preference')
        if (!CATEGORIES.includes(category)) return `Unknown category ${category}. Use one of ${CATEGORIES.join(', ')}.`
        const result = profile.addFacet({
          category,
          text: asString(args.text),
          title: asString(args.title),
          confidence: asString(args.confidence, '1'),
          source: 'agent',
        })
        return `${result.created ? 'added' : 'refreshed'} ${result.facet.id} — ${CATEGORY_LABELS[category]}：${result.facet.text}`
      },
    }),
    register({
      name: 'profile_forget',
      description: 'Remove profile facts matching a keyword. Use when the user says something about them is wrong or should be forgotten.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Keyword that appears in the fact to remove.' } },
        required: ['query'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const profile = extras.profile
        if (!profile) return 'The profile store is unavailable.'
        const removed = profile.forget(asString(args.query))
        if (removed.length === 0) return 'Nothing matched, so nothing was removed.'
        return `forgot ${removed.length} fact(s):\n${removed.map((facet) => `- ${facet.text}`).join('\n')}`
      },
    }),
    register({
      name: 'memory_link',
      description:
        'Draw an explicit relation between two memories (for example "this decision replaced that one"). The graph also infers edges from shared tags and wording; this one is for relations only you know.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Source memory id.' },
          to: { type: 'string', description: 'Target memory id.' },
          type: { type: 'string', description: 'Relation label, e.g. replaces, depends-on, part-of.' },
        },
        required: ['from', 'to'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const item = store.link(asString(args.from), asString(args.to), asString(args.type, 'related'))
        if (!item) return 'Both ids must exist and differ.'
        return `linked ${item.id} → ${asString(args.to)}`
      },
    }),
    register({
      name: 'memory_graph',
      description:
        'Inspect the memory graph. Without id: node/edge counts and components. With id: the memories most closely related to it, and why.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Optional memory id.' } },
        required: [],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        const graph = store.graph()
        const id = asString(args.id)
        if (id === '') {
          return `nodes: ${graph.stats.nodes}  edges: ${graph.stats.edges}  components: ${graph.stats.components}  isolated: ${graph.stats.isolated}`
        }
        if (!graph.nodes.some((node) => node.id === id)) return `No memory with id ${id}.`
        const related = relatedOf(graph, id)
        if (related.length === 0) return `${id} has no edges yet.`
        return related
          .slice(0, 12)
          .map((row) => `- [${row.id}] (${row.types.join('+')}, ${row.weight}) ${row.title}`)
          .join('\n')
      },
    }),
  ]
}

function registerTools(toolCtx, store, extras = {}) {
  const registry = toolCtx?.tools
  if (!registry || typeof registry.register !== 'function') return
  for (const spec of toolSpecs(store, extras)) {
    try {
      registry.register(spec)
    } catch (error) {
      // A name collision with another memory plugin must cost this one tool,
      // not the server half that also serves the page.
      console.warn(`[dsh-memory-studio] could not register ${spec.name}:`, error?.message ?? error)
    }
  }
}

export function apply(ctx) {
  const dir = storeDir()
  const store = new MemoryStore(dir)
  store.load()
  const profile = new ProfileStore(dir)
  profile.load()
  const inbox = new InboxStore(dir)
  inbox.load()
  const settings = new SettingsStore(dir)
  settings.load()
  const log = (message, error) => console.warn(`[dsh-memory-studio] ${message}:`, error?.message ?? error ?? '')
  const capture = new CaptureEngine({ store, profile, inbox, settings, log })
  const deps = { store, profile, inbox, settings, capture }

  ctx.inject(['webServer'], (hostCtx) => {
    const server = hostCtx?.webServer
    if (!server || typeof server.register !== 'function') return
    for (const route of [...buildRoutes(store), ...buildExtraRoutes(deps)]) {
      try {
        server.register(route)
      } catch (error) {
        console.warn(`[dsh-memory-studio] could not register ${route.path}:`, error?.message ?? error)
      }
    }
  })

  ctx.inject(['tools'], (toolCtx) => {
    registerTools(toolCtx, store, { profile, inbox, capture, settings })
  })

  // Capture listens to every session, not just the one this plugin happens to
  // be loaded into: the point of a memory store is that it accumulates.
  const listen = (event, handler, options) => {
    try {
      ctx.on(event, handler, options)
    } catch (error) {
      log(`could not listen to ${event}`, error)
    }
  }

  listen(
    'session/event',
    (session, event) => {
      capture.observe(session, event)
    },
    { global: true },
  )

  listen(
    'session/disposed',
    (session) => {
      try {
        capture.finalize(session?.id ?? '', 'disposed')
      } catch (error) {
        log('finalize on disposal failed', error)
      }
    },
    { global: true },
  )

  listen('agent/turn-stopping', (payload) => {
    capture.schedule(resolveSessionId(payload))
  })
}

export const __internals = {
  MemoryStore,
  buildRoutes,
  buildExtraRoutes,
  toolSpecs,
  scoreItem,
  normalizeItem,
  applyPatch,
  storeDir,
  API,
  ProfileStore,
  InboxStore,
  SettingsStore,
  CaptureEngine,
  buildProfileTree,
}

export default { name, apply }
