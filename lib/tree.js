/**
 * Memory tree: a second, complementary view of the same items.
 *
 * The graph answers "what is near what"; a tree answers "where am I". Both are
 * derived — nothing here is stored, because a stored `parentId` goes stale the
 * moment a tag is edited, and a memory usually belongs to more than one story.
 *
 * Two shapes, both three levels deep:
 *
 *   topic   全部 → 主题簇 → 类型 → 记忆
 *   session 全部 → 会话   → 轮次 → 记忆
 *
 * A topic cluster is a connected component of tag-sharing (capped so a generic
 * tag like `memory` cannot glue the whole library together) plus explicit
 * links. A memory belongs to exactly one cluster, so the tree never counts the
 * same item twice. Items that share nothing sit together under 未归类 — that
 * bucket is informational, not a failure.
 */

import { CATEGORIES, CATEGORY_LABELS } from './profile.js'

/** A tag carried by more items than this is too generic to define a topic. */
const GENERIC_TAG = 12
/** Singleton groups are not topics; they are the leftovers bucket. */
const MIN_CLUSTER = 2

const KIND_ORDER = ['decision', 'preference', 'fact', 'insight', 'todo', 'entity']

const KIND_LABEL = {
  decision: '决策',
  preference: '偏好',
  fact: '事实',
  insight: '洞察',
  todo: '待办',
  entity: '实体',
}

function rankKind(kind) {
  const at = KIND_ORDER.indexOf(kind)
  return at === -1 ? KIND_ORDER.length : at
}

function groupBy(items, keyOf) {
  const groups = new Map()
  for (const item of items) {
    const key = keyOf(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return groups
}

function byUpdated(a, b) {
  return String(b.updatedAt).localeCompare(String(a.updatedAt))
}

/**
 * Kind buckets under one parent. This is the one place the user's original
 * instinct — "same type, same parent" — is exactly right: inside a topic,
 * grouping by kind is how you scan it.
 */
function kindChildren(prefix, items) {
  const groups = groupBy(items, (item) => item.kind)
  return [...groups.entries()]
    .sort((a, b) => rankKind(a[0]) - rankKind(b[0]) || b[1].length - a[1].length)
    .map(([kind, members]) => ({
      id: `${prefix}:kind:${kind}`,
      label: KIND_LABEL[kind] ?? kind,
      kind,
      count: members.length,
      children: members.sort(byUpdated).map((item) => ({
        id: item.id,
        label: item.title,
        item,
        count: 0,
        children: [],
      })),
    }))
}

/** The tag that best names a cluster: carried by the most members, then the most specific. */
function clusterLabel(members, tagMembers) {
  const counts = new Map()
  for (const item of members) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  let best = ''
  let bestScore = -1
  for (const [tag, count] of counts) {
    const reach = tagMembers.get(tag)?.length ?? count
    if (reach > GENERIC_TAG) continue
    const score = count * 100 + Math.min(tag.length, 40)
    if (score > bestScore) {
      best = tag
      bestScore = score
    }
  }
  return best
}

function root(label, count, children, extra = {}) {
  return { id: 'root', label, count, children, ...extra }
}

/**
 * @param {Array<object>} items normalized memory items
 * @param {{includeArchived?: boolean}} options
 */
export function buildTopicTree(items = [], options = {}) {
  const includeArchived = options.includeArchived === true
  const list = items.filter((item) => includeArchived || !item.archived)
  const byId = new Map(list.map((item) => [item.id, item]))

  const byTag = groupBy(
    list.flatMap((item) => item.tags.map((tag) => ({ item, tag }))),
    (entry) => entry.tag,
  )
  const tagMembers = new Map([...byTag.entries()].map(([tag, entries]) => [tag, entries.map((e) => e.item)]))

  const parent = new Map(list.map((item) => [item.id, item.id]))
  const find = (id) => {
    let at = id
    while (parent.get(at) !== at) at = parent.get(at)
    while (parent.get(id) !== at) {
      const next = parent.get(id)
      parent.set(id, at)
      id = next
    }
    return at
  }
  const union = (a, b) => {
    if (!parent.has(a) || !parent.has(b)) return
    const left = find(a)
    const right = find(b)
    if (left !== right) parent.set(right, left)
  }

  for (const [tag, members] of tagMembers) {
    if (members.length < 2 || members.length > GENERIC_TAG) continue
    for (let at = 1; at < members.length; at += 1) union(members[0].id, members[at].id)
  }
  for (const item of list) {
    for (const link of Array.isArray(item.links) ? item.links : []) {
      if (byId.has(link?.to)) union(item.id, link.to)
    }
  }

  const clusters = groupBy(list, (item) => find(item.id))
  const topics = []
  const loose = []

  for (const members of clusters.values()) {
    if (members.length < MIN_CLUSTER) {
      loose.push(...members)
      continue
    }
    const label = clusterLabel(members, tagMembers)
    const name = label === '' ? '相关记忆' : label
    topics.push({
      id: `topic:${find(members[0].id)}`,
      label: name,
      tag: label,
      count: members.length,
      children: kindChildren(`topic:${find(members[0].id)}`, members),
    })
  }

  topics.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const children = [...topics]
  if (loose.length > 0) {
    children.push({
      id: 'topic:loose',
      label: '未归类',
      tag: '',
      count: loose.length,
      children: kindChildren('topic:loose', loose),
    })
  }
  return root('全部记忆', list.length, children, { mode: 'topic', topics: topics.length })
}

/**
 * Sessions, in the order they were spoken. `origin` is stamped at capture time,
 * so this costs nothing to maintain and can never disagree with the memories.
 */
export function buildSessionTree(items = [], options = {}) {
  const includeArchived = options.includeArchived === true
  const list = items.filter((item) => includeArchived || !item.archived)
  const sessions = groupBy(list, (item) => item.origin?.sessionId || '')
  const nodes = []

  for (const [sessionId, members] of sessions) {
    if (sessionId === '') {
      nodes.push({
        id: 'session:manual',
        label: '手动记录',
        sessionId: '',
        count: members.length,
        children: kindChildren('session:manual', members),
      })
      continue
    }
    const turns = groupBy(members, (item) => String(item.origin?.turn ?? 0))
    const children = [...turns.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([turn, rows]) => ({
        id: `session:${sessionId}:turn:${turn}`,
        label: turn === '0' ? '会话中' : `第 ${turn} 轮`,
        turn: Number(turn),
        count: rows.length,
        children: rows.sort(byUpdated).map((item) => ({
          id: item.id,
          label: item.title,
          item,
          count: 0,
          children: [],
        })),
      }))
    const newest = members.map((item) => item.createdAt).sort().at(-1) ?? ''
    nodes.push({
      id: `session:${sessionId}`,
      label: sessionId.replace(/^session-/, '').slice(0, 8),
      sessionId,
      count: members.length,
      created: newest,
      children,
    })
  }

  nodes.sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')))
  return root('全部记忆', list.length, nodes, { mode: 'session', sessions: nodes.length })
}

/**
 * @param {Array<object>} items
 * @param {{mode?: 'topic'|'session', includeArchived?: boolean}} options
 */
export function buildTree(items = [], options = {}) {
  return options.mode === 'session' ? buildSessionTree(items, options) : buildTopicTree(items, options)
}

const IDENTITY_ROWS = [
  { key: 'name', label: '称呼' },
  { key: 'role', label: '身份' },
  { key: 'location', label: '所在地' },
  { key: 'language', label: '语言' },
  { key: 'timezone', label: '时区' },
]

/**
 * The profile is the one place the type *is* the structure: `category` is a
 * closed ontology (seven values, one per facet), so 类别 → 标签 → 条目 is a real
 * hierarchy rather than a derived guess. Tags stay as the middle layer because
 * "preference" alone does not tell you which preference.
 */
export function buildProfileTree(profile = {}, options = {}) {
  const facets = (Array.isArray(profile.facets) ? profile.facets : []).filter(Boolean)
  const identity = profile.identity && typeof profile.identity === 'object' ? profile.identity : {}
  const children = []

  const identityRows = IDENTITY_ROWS.filter((row) => String(identity[row.key] ?? '') !== '')
  if (identityRows.length > 0) {
    children.push({
      id: 'profile:identity',
      label: '身份卡',
      count: identityRows.length,
      children: identityRows.map((row) => ({
        id: `profile:identity:${row.key}`,
        label: `${row.label} · ${identity[row.key]}`,
        field: row.key,
        count: 0,
        children: [],
      })),
    })
  }

  for (const category of CATEGORIES) {
    const rows = facets.filter((facet) => facet.category === category)
    if (rows.length === 0) continue
    const buckets = groupBy(rows, (facet) => (Array.isArray(facet.tags) ? facet.tags[0] : '') || '')
    const groups = [...buckets.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([tag, members]) => ({
        id: `profile:${category}:tag:${tag === '' ? '_' : tag}`,
        label: tag === '' ? '未标记' : tag,
        tag,
        count: members.length,
        children: [...members]
          .sort((a, b) => Number(b.confidence ?? 1) - Number(a.confidence ?? 1) || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
          .map((facet) => ({
            id: facet.id,
            label: facet.title,
            facet,
            count: 0,
            children: [],
          })),
      }))
    children.push({
      id: `profile:${category}`,
      label: CATEGORY_LABELS[category] ?? category,
      category,
      count: rows.length,
      children: groups,
    })
  }

  return root('关于你', facets.length, children, { mode: 'profile' })
}

export const TREE = { GENERIC_TAG, MIN_CLUSTER, KIND_ORDER, IDENTITY_ROWS }
