/**
 * Memory graph: who is related to whom, and why.
 *
 * Edges are derived, not just declared. Five signals, each with an explicit
 * weight, so the picture stays explainable:
 *   - an explicit link the user or the agent drew (strongest),
 *   - shared tags,
 *   - lexical overlap of title + body (CJK bigrams make this work in Chinese),
 *   - the same kind (a weak pull — all decisions sit near each other),
 *   - the same session, or creation within a few minutes (provenance).
 *
 * The result is intentionally sparse: a hairball communicates nothing, so each
 * node keeps its strongest edges only.
 */
import { features, similarity, timeOf } from './text.js'

const WEIGHT = {
  link: 2.6,
  tag: 0.85,
  topic: 2.4,
  kind: 0.25,
  session: 0.55,
  time: 0.3,
}

const MIN_EDGE = 0.5
const MAX_DEGREE = 8
/** Above this size the quadratic lexical pass is skipped; tags and links carry it. */
const LEXICAL_LIMIT = 700

function nodeOf(item) {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    importance: item.importance,
    tags: item.tags,
    pinned: item.pinned === true,
    archived: item.archived === true,
    created: item.createdAt,
    source: item.source,
    degree: 0,
  }
}

/**
 * @param {Array<object>} items normalized memory items
 * @param {{includeArchived?: boolean}} options
 */
export function buildGraph(items = [], options = {}) {
  const includeArchived = options.includeArchived === true
  const list = items.filter((item) => includeArchived || !item.archived)
  const nodes = list.map(nodeOf)
  const byId = new Map(list.map((item) => [item.id, item]))
  const index = new Map(list.map((item, i) => [item.id, i]))
  const pairs = new Map()

  const add = (a, b, type, weight) => {
    if (a === b) return
    const left = Math.min(a, b)
    const right = Math.max(a, b)
    const key = `${left}:${right}`
    const current = pairs.get(key) ?? { a: left, b: right, weight: 0, types: new Set() }
    current.weight += weight
    current.types.add(type)
    pairs.set(key, current)
  }

  // 1. Explicit links (both directions, so a one-sided link still draws).
  for (const item of list) {
    for (const link of Array.isArray(item.links) ? item.links : []) {
      const other = index.get(link?.to)
      const self = index.get(item.id)
      if (other === undefined || self === undefined) continue
      add(self, other, 'link', WEIGHT.link)
    }
  }

  // 2. Shared tags — cheap, and it is the signal a human can verify by eye.
  const byTag = new Map()
  list.forEach((item, i) => {
    for (const tag of item.tags) {
      const key = String(tag).toLowerCase()
      const bucket = byTag.get(key) ?? []
      bucket.push(i)
      byTag.set(key, bucket)
    }
  })
  for (const bucket of byTag.values()) {
    if (bucket.length < 2 || bucket.length > 40) continue
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) add(bucket[i], bucket[j], 'tag', WEIGHT.tag)
    }
  }

  // 3. Lexical overlap. Skipped for very large libraries, where the O(n²) pass
  // would cost more than the picture is worth.
  if (list.length <= LEXICAL_LIMIT) {
    const vectors = list.map((item) => features(`${item.title} ${item.content}`))
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const sim = similarity(vectors[i], vectors[j])
        if (sim < 0.14) continue
        add(i, j, 'topic', WEIGHT.topic * sim)
      }
    }
  }

  // 4. Same kind, same session, close in time: provenance-level ties.
  const byKind = new Map()
  const bySession = new Map()
  list.forEach((item, i) => {
    byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), i])
    const session = item.origin?.sessionId ?? item.sessionId ?? ''
    if (session !== '') bySession.set(session, [...(bySession.get(session) ?? []), i])
  })
  for (const bucket of byKind.values()) {
    if (bucket.length < 2 || bucket.length > 60) continue
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) add(bucket[i], bucket[j], 'kind', WEIGHT.kind)
    }
  }
  for (const bucket of bySession.values()) {
    if (bucket.length < 2) continue
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) add(bucket[i], bucket[j], 'session', WEIGHT.session)
    }
  }
  const timed = list
    .map((item, i) => ({ i, at: timeOf(item.createdAt) }))
    .filter((row) => row.at > 0)
    .sort((a, b) => a.at - b.at)
  for (let i = 1; i < timed.length; i += 1) {
    if (timed[i].at - timed[i - 1].at <= 10 * 60 * 1000) add(timed[i - 1].i, timed[i].i, 'time', WEIGHT.time)
  }

  // 5. Keep the strongest edges, then enforce a degree cap on both ends so a
  // single popular memory cannot swallow the canvas.
  const ranked = [...pairs.values()]
    .filter((pair) => pair.weight >= MIN_EDGE)
    .sort((a, b) => b.weight - a.weight)
  const degree = new Array(list.length).fill(0)
  const edges = []
  for (const pair of ranked) {
    if (degree[pair.a] >= MAX_DEGREE || degree[pair.b] >= MAX_DEGREE) continue
    degree[pair.a] += 1
    degree[pair.b] += 1
    edges.push({
      source: nodes[pair.a].id,
      target: nodes[pair.b].id,
      weight: Number(pair.weight.toFixed(2)),
      types: [...pair.types],
    })
  }
  for (let i = 0; i < nodes.length; i += 1) nodes[i].degree = degree[i]

  const components = countComponents(nodes, edges)
  const byKindCounts = {}
  for (const node of nodes) byKindCounts[node.kind] = (byKindCounts[node.kind] ?? 0) + 1

  return {
    nodes,
    edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      components,
      isolated: nodes.filter((node) => node.degree === 0).length,
      byKind: byKindCounts,
    },
  }
}

function countComponents(nodes, edges) {
  const parent = new Map(nodes.map((node) => [node.id, node.id]))
  const find = (id) => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)
    while (parent.get(id) !== root) {
      const next = parent.get(id)
      parent.set(id, root)
      id = next
    }
    return root
  }
  for (const edge of edges) {
    const a = find(edge.source)
    const b = find(edge.target)
    if (a !== b) parent.set(a, b)
  }
  const roots = new Set(nodes.map((node) => find(node.id)))
  return roots.size
}

/** Edges of one node, annotated with the other end's title, for the detail pane. */
export function relatedOf(graph, id) {
  const titles = new Map(graph.nodes.map((node) => [node.id, node.title]))
  return graph.edges
    .filter((edge) => edge.source === id || edge.target === id)
    .map((edge) => ({
      id: edge.source === id ? edge.target : edge.source,
      title: titles.get(edge.source === id ? edge.target : edge.source) ?? '',
      weight: edge.weight,
      types: edge.types,
    }))
    .sort((a, b) => b.weight - a.weight)
}

/** Profile edges are fewer and stronger: a person has fewer facets than notes. */
const PROFILE_WEIGHT = { tag: 2.2, topic: 2.4, category: 0.55 }
const PROFILE_MIN_EDGE = 0.5
const PROFILE_MAX_DEGREE = 6

/**
 * The "about you" graph: facets as nodes, related by shared tags, by wording,
 * and by category. Category is a real relation here (it is a closed
 * vocabulary and each facet has exactly one), so it is drawn — but weakly,
 * because "both are preferences" says less than "both are about pnpm".
 *
 * @param {{facets?: Array<object>}} profile
 */
export function buildProfileGraph(profile = {}) {
  const facets = (Array.isArray(profile.facets) ? profile.facets : []).filter(
    (facet) => facet && typeof facet.id === 'string',
  )
  const nodes = facets.map((facet) => ({
    id: facet.id,
    title: facet.title || '',
    category: facet.category || 'preference',
    confidence: Math.max(0, Math.min(1, Number(facet.confidence) || 0)),
    tags: Array.isArray(facet.tags) ? facet.tags : [],
    degree: 0,
  }))
  const pairs = new Map()

  const add = (a, b, type, weight) => {
    if (a === b) return
    const left = Math.min(a, b)
    const right = Math.max(a, b)
    const key = `${left}:${right}`
    const current = pairs.get(key) ?? { a: left, b: right, weight: 0, types: new Set() }
    current.weight += weight
    current.types.add(type)
    pairs.set(key, current)
  }

  const byTag = new Map()
  facets.forEach((facet, index) => {
    for (const tag of nodes[index].tags) {
      const key = String(tag).toLowerCase()
      if (key === '') continue
      byTag.set(key, [...(byTag.get(key) ?? []), index])
    }
  })
  for (const bucket of byTag.values()) {
    if (bucket.length < 2 || bucket.length > 24) continue
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) add(bucket[i], bucket[j], 'tag', PROFILE_WEIGHT.tag)
    }
  }

  if (facets.length <= LEXICAL_LIMIT) {
    const vectors = facets.map((facet) => features(`${facet.title ?? ''} ${facet.text ?? ''}`))
    for (let i = 0; i < facets.length; i += 1) {
      for (let j = i + 1; j < facets.length; j += 1) {
        const sim = similarity(vectors[i], vectors[j])
        if (sim < 0.16) continue
        add(i, j, 'topic', PROFILE_WEIGHT.topic * sim)
      }
    }
  }

  const byCategory = new Map()
  facets.forEach((facet, index) => {
    const key = nodes[index].category
    byCategory.set(key, [...(byCategory.get(key) ?? []), index])
  })
  for (const bucket of byCategory.values()) {
    if (bucket.length < 2 || bucket.length > 30) continue
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) add(bucket[i], bucket[j], 'category', PROFILE_WEIGHT.category)
    }
  }

  const ranked = [...pairs.values()]
    .filter((pair) => pair.weight >= PROFILE_MIN_EDGE)
    .sort((a, b) => b.weight - a.weight)
  const degree = new Array(nodes.length).fill(0)
  const edges = []
  for (const pair of ranked) {
    if (degree[pair.a] >= PROFILE_MAX_DEGREE || degree[pair.b] >= PROFILE_MAX_DEGREE) continue
    degree[pair.a] += 1
    degree[pair.b] += 1
    edges.push({
      source: nodes[pair.a].id,
      target: nodes[pair.b].id,
      weight: Number(pair.weight.toFixed(2)),
      types: [...pair.types],
    })
  }
  for (let i = 0; i < nodes.length; i += 1) nodes[i].degree = degree[i]

  const byCategoryCounts = {}
  for (const node of nodes) byCategoryCounts[node.category] = (byCategoryCounts[node.category] ?? 0) + 1

  return {
    nodes,
    edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      components: countComponents(nodes, edges),
      isolated: nodes.filter((node) => node.degree === 0).length,
      byCategory: byCategoryCounts,
    },
  }
}

export const GRAPH_WEIGHTS = WEIGHT
export const PROFILE_GRAPH_WEIGHTS = PROFILE_WEIGHT
