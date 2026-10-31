/**
 * Smoke test: exercises the host half (store + HTTP routes + tool specs) and the
 * browser half (module loader contract + slot registration) without booting the
 * desktop app. Run with: node test/smoke.mjs
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const hostPath = new URL('../lib/index.js', import.meta.url).href
const clientPath = new URL('../lib/client.js', import.meta.url).href

const dir = mkdtempSync(join(tmpdir(), 'mst-smoke-'))
let failures = 0
const check = async (label, fn) => {
  try {
    await fn()
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${label}\n       ${error?.stack ?? error}`)
  }
}

console.log(`dsh-memory-studio smoke test\n  store: ${dir}\n`)

const plugin = await import(hostPath)
const { MemoryStore, buildRoutes, toolSpecs, storeDir, KINDS, normalizeItem } = plugin

console.log('host: store')
await check('module shape', () => {
  assert.equal(plugin.name, 'dsh-memory-studio')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.default.apply, 'function')
})

const store = new MemoryStore(dir)
await check('starts empty', () => assert.equal(store.list().length, 0))
await check('create returns a normalized item', () => {
  const item = store.create({ title: 'Prefers pnpm', content: 'Use pnpm, not npm.', tags: ['tooling', '#pnpm', 'Tooling'], kind: 'preference' })
  assert.match(item.id, /^mem_[0-9a-f]{8}$/)
  assert.deepEqual(item.tags, ['tooling', 'pnpm'])
  assert.equal(item.kind, 'preference')
  assert.equal(item.hits, 0)
})
await check('create rejects an unknown kind but keeps a fallback', () => {
  const item = store.create({ title: 'Odd', content: 'x', kind: 'nonsense' })
  assert.ok(KINDS.includes(item.kind))
})
await check('list is newest first', () => {
  const titles = store.list().map((entry) => entry.title)
  assert.deepEqual(titles, ['Odd', 'Prefers pnpm'])
})
await check('search ranks title hits above content hits', () => {
  store.create({ title: 'Deploy notes', content: 'pnpm workspace layout explained', tags: ['deploy'] })
  const hits = store.search('pnpm')
  assert.equal(hits.length, 2)
  assert.equal(hits[0].title, 'Prefers pnpm')
})
await check('search filters by kind and tag', () => {
  assert.equal(store.search('', { kind: 'preference' }).length, 1)
  assert.equal(store.search('', { tag: 'deploy' }).length, 1)
  assert.equal(store.search('', { tag: 'DEPLOY' }).length, 1)
})
await check('update applies a partial patch', () => {
  const target = store.list().find((entry) => entry.title === 'Deploy notes')
  const next = store.update(target.id, { pinned: true, importance: 5 })
  assert.equal(next.pinned, true)
  assert.equal(next.importance, 5)
  assert.equal(next.title, 'Deploy notes')
})
await check('archive hides from search unless asked', () => {
  const target = store.list()[0]
  store.update(target.id, { archived: true })
  assert.ok(!store.search('').some((entry) => entry.id === target.id))
  assert.ok(store.search('', { includeArchived: true }).some((entry) => entry.id === target.id))
})
await check('hit() counts reads and survives a reload', () => {
  const target = store.list()[0]
  store.hit(target.id)
  assert.equal(store.get(target.id).hits, 1)
  const reopened = new MemoryStore(dir)
  assert.equal(reopened.get(target.id).hits, 1)
  assert.equal(reopened.list().length, 3)
})
await check('persisted file is versioned JSON', () => {
  const raw = JSON.parse(readFileSync(join(dir, 'memories.json'), 'utf8'))
  assert.equal(raw.version, 2)
  assert.equal(raw.items.length, 3)
})
await check('a second store instance sees what the first one wrote', () => {
  const shared = mkdtempSync(join(tmpdir(), 'mst-shared-'))
  try {
    const first = new MemoryStore(shared)
    const second = new MemoryStore(shared)
    const created = first.create({ title: '第一条', content: '写在第一个实例里。', kind: 'fact' })
    assert.deepEqual(second.list().map((item) => item.id), [created.id])
    // …and the traffic goes both ways.
    second.create({ title: '第二条', content: '写在第二个实例里。', kind: 'fact' })
    assert.equal(first.list().length, 2)
    assert.equal(first.get(created.id).title, '第一条')
  } finally {
    rmSync(shared, { recursive: true, force: true })
  }
})
await check('a corrupt store is moved aside, not overwritten', () => {
  const broken = mkdtempSync(join(tmpdir(), 'mst-broken-'))
  try {
    writeFileSync(join(broken, 'memories.json'), '{not json', 'utf8')
    const recovered = new MemoryStore(broken)
    assert.equal(recovered.list().length, 0)
    const files = readdirSyncSafe(broken)
    assert.ok(files.some((file) => file.startsWith('memories.json.corrupt-')), files.join(','))
  } finally {
    rmSync(broken, { recursive: true, force: true })
  }
})
await check('remove is idempotent about missing ids', () => {
  const target = store.list()[0]
  assert.equal(store.remove(target.id), true)
  assert.equal(store.remove(target.id), false)
})

console.log('\nhost: http routes')
const routes = buildRoutes(store)
const routeFor = (path) => routes.find((route) => route.path === path)
const fakeRequest = (method, url, body) => {
  const request = new EventEmitter()
  request.method = method
  request.url = url
  request.destroy = () => {}
  setImmediate(() => {
    if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)))
    request.emit('end')
  })
  return request
}
const fakeResponse = () => {
  const response = { status: 0, headers: {}, body: '' }
  response.writeHead = (status, headers) => {
    response.status = status
    Object.assign(response.headers, headers ?? {})
  }
  response.end = (chunk) => {
    if (chunk !== undefined) response.body += String(chunk)
    response.done = true
  }
  return response
}
const makeCaller = (list) => async (path, method, body) => {
  // The web server matches on the pathname; query strings stay on request.url.
  const route = list.find((entry) => entry.path === path.split('?')[0])
  assert.ok(route, `no route ${path}`)
  assert.equal(route.kind, 'exact')
  const response = fakeResponse()
  await route.handler(fakeRequest(method, path, body), response)
  const json = (() => {
    try {
      return JSON.parse(response.body)
    } catch {
      return null
    }
  })()
  return { response, json }
}
const call = makeCaller(routes)

await check('GET /state returns items and stats', async () => {
  const { response, json } = await call('/dsh-memory-studio/api/state', 'GET')
  assert.equal(response.status, 200)
  assert.ok(Array.isArray(json.items))
  assert.equal(json.stats.total, json.items.length)
  assert.ok(json.storeFile.endsWith('memories.json'))
})
await check('POST /items creates', async () => {
  const { response, json } = await call('/dsh-memory-studio/api/items', 'POST', { title: 'Route made', content: 'via http', tags: 'a, b' })
  assert.equal(response.status, 200)
  assert.deepEqual(json.item.tags, ['a', 'b'])
})
await check('POST /items/update patches', async () => {
  const created = (await call('/dsh-memory-studio/api/items', 'POST', { title: 'Patch me', content: '' })).json.item
  const { response, json } = await call('/dsh-memory-studio/api/items/update', 'POST', { id: created.id, patch: { importance: 2 } })
  assert.equal(response.status, 200)
  assert.equal(json.item.importance, 2)
})
await check('update of a missing id is a 404', async () => {
  const { response } = await call('/dsh-memory-studio/api/items/update', 'POST', { id: 'nope', patch: { importance: 2 } })
  assert.equal(response.status, 404)
})
await check('wrong method is a 405 with allow', async () => {
  const { response } = await call('/dsh-memory-studio/api/items', 'GET')
  assert.equal(response.status, 405)
  assert.equal(response.headers.allow, 'POST')
})
await check('POST /items/delete removes', async () => {
  const created = (await call('/dsh-memory-studio/api/items', 'POST', { title: 'Delete me', content: '' })).json.item
  const { response } = await call('/dsh-memory-studio/api/items/delete', 'POST', { id: created.id })
  assert.equal(response.status, 200)
  assert.equal(store.get(created.id), undefined)
})
await check('import skips duplicates', async () => {
  const payload = { items: [{ title: 'Imported', content: 'once' }, { title: 'Imported', content: 'once' }, { title: '', content: '' }] }
  const { json } = await call('/dsh-memory-studio/api/items/import', 'POST', payload)
  assert.deepEqual(json, { added: 1, skipped: 2 })
})
await check('export renders markdown', async () => {
  const { response } = await call('/dsh-memory-studio/api/export?format=md', 'GET')
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /text\/markdown/)
  assert.match(response.body, /^# 记忆库导出/)
})

console.log('\nhost: agent tools')
const specs = toolSpecs(store)
await check('twelve tools with string-only parameters', () => {
  assert.equal(specs.length, 12)
  const names = specs.map((spec) => spec.name)
  assert.deepEqual(names, [
    'memory_write',
    'memory_search',
    'memory_brief',
    'memory_read',
    'memory_list',
    'memory_update',
    'memory_delete',
    'profile_read',
    'profile_write',
    'profile_forget',
    'memory_link',
    'memory_graph',
  ])
  for (const spec of specs) {
    assert.equal(spec.parameters.type, 'object')
    for (const [key, value] of Object.entries(spec.parameters.properties)) {
      assert.equal(value.type, 'string', `${spec.name}.${key} must be a string parameter`)
    }
    assert.equal(typeof spec.execute, 'function')
  }
})
await check('memory_write stores and returns the id', async () => {
  const write = specs.find((spec) => spec.name === 'memory_write')
  const out = await write.execute({ title: 'From agent', content: 'remember this', tags: 'agent', kind: 'insight' })
  assert.equal(typeof out, 'string')
  assert.match(out, /From agent/)
  assert.ok(store.list().some((item) => item.title === 'From agent'))
})
await check('memory_search finds it', async () => {
  const search = specs.find((spec) => spec.name === 'memory_search')
  const out = await search.execute({ query: 'remember this', limit: '5' })
  assert.match(out, /From agent/)
})
await check('memory_read and memory_delete round-trip', async () => {
  const write = specs.find((spec) => spec.name === 'memory_write')
  const read = specs.find((spec) => spec.name === 'memory_read')
  const del = specs.find((spec) => spec.name === 'memory_delete')
  const out = await write.execute({ title: 'Temp', content: 'temp' })
  const id = store.list().find((item) => item.title === 'Temp').id
  assert.match(out, new RegExp(id))
  assert.match(await read.execute({ id }), /temp/)
  assert.match(await del.execute({ id }), /deleted|删除/i)
  assert.equal(store.get(id), undefined)
})

console.log('\nbrowser: module loader')
let captured = null
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: () => [null, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
}
globalThis.window = { __ModuleLoader__: { load: (descriptor) => { captured = descriptor } } }
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  head: { appendChild: () => {} },
  querySelector: () => null,
  createElement: () => ({ dataset: {}, set textContent(value) {}, get textContent() { return '' } }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
await import(clientPath)
await check('client registers under the plugin id', () => {
  assert.equal(captured?.id, 'dsh-memory-studio')
  assert.equal(typeof captured.factory, 'function')
})
const client = captured.factory((name) => {
  if (name === 'react') return fakeReact
  throw new Error(`unexpected require: ${name}`)
})
await check('client exports a slot plugin', () => {
  assert.deepEqual(client.inject, ['slots'])
  assert.equal(client.name, 'dsh-memory-studio')
  assert.equal(typeof client.__test.MemoryStudio, 'function')
})
await check('apply() registers the tab, the main panel and the sidebar row', () => {
  const registered = []
  client.apply({
    slots: {
      inject: (_name, callback) => callback(),
      register: (meta, component) => {
        registered.push({ meta, component })
        return () => {}
      },
    },
  })
  assert.equal(registered.length, 3)
  const tab = registered.find((entry) => entry.meta.name === 'conversation.view')
  assert.equal(tab.meta.id, 'memory-studio')
  assert.equal(tab.meta.order, 30)
  assert.equal(tab.meta.label(), '记忆')
  assert.equal(tab.component, client.__test.MemoryStudio)
  const panel = registered.find((entry) => entry.meta.name === 'main')
  assert.equal(panel.meta.key, 'memory-studio')
  assert.equal(typeof panel.component, 'function')
  const row = registered.find((entry) => entry.meta.name === 'sidebar.panellist')
  assert.equal(row.meta.id, 'memory-studio')
  assert.equal(row.meta.label(), '记忆')
  assert.equal(typeof row.component, 'function')
  assert.ok(row.component({ size: 18 }), 'sidebar icon did not render')
})
await check('client helpers parse tags and relative time', () => {
  assert.deepEqual(client.__test.parseTags(' a, B ,#a，c '), ['a', 'B', 'c'])
  assert.equal(client.__test.relTime(new Date().toISOString()), '刚刚')
  assert.equal(client.__test.relTime('not a date'), '')
})
await check('storeDir honours the env override', () => {
  const previous = process.env.DSH_MEMORY_STUDIO_DIR
  process.env.DSH_MEMORY_STUDIO_DIR = 'C:\\tmp\\mst'
  try {
    assert.equal(storeDir(), 'C:\\tmp\\mst')
  } finally {
    if (previous === undefined) delete process.env.DSH_MEMORY_STUDIO_DIR
    else process.env.DSH_MEMORY_STUDIO_DIR = previous
  }
})
await check('normalizeItem clamps out-of-range values', () => {
  const item = normalizeItem({ id: 'x', title: 'T', content: 'c', importance: 99, tags: Array(40).fill('t'), kind: 'unknown' })
  assert.equal(item.importance, 5)
  assert.ok(item.tags.length <= 16)
  assert.ok(KINDS.includes(item.kind))
})

console.log('\nhost: capture policy')
const { extractCandidates, THRESHOLDS } = await import(new URL('../lib/policy.js', import.meta.url).href)

await check('keeps identity and preferences, drops noise', () => {
  const { candidates, dropped, scanned } = extractCandidates([
    { role: 'user', text: '我的名字是 Ada，是一名开发者。' },
    { role: 'user', text: '我喜欢先看结论，再听理由。' },
    { role: 'user', text: '好的' },
    { role: 'user', text: 'WARN deprecated inflight@1.0.6' },
    { role: 'assistant', text: '我先看一下代码结构，再决定改哪里。' },
  ])
  assert.ok(scanned >= 5)
  const rules = candidates.map((entry) => entry.rule)
  assert.ok(rules.includes('profile.identity'), rules.join(','))
  assert.ok(candidates.some((entry) => entry.target === 'profile'))
  const reasons = new Set(dropped.map((entry) => entry.reason))
  assert.ok(reasons.has('confirmation'), [...reasons].join(','))
  assert.ok(reasons.has('log'), [...reasons].join(','))
  assert.ok(reasons.has('agent-narration'), [...reasons].join(','))
})
await check('assistant text never becomes a memory, even when rule-shaped', () => {
  const { candidates, dropped } = extractCandidates([
    { role: 'assistant', text: '我们决定采用 SQLite 作为存储，因为单文件更好备份。' },
    { role: 'assistant', text: '我喜欢先给结论，再给理由。' },
    { role: 'assistant', text: '用户名叫 Ada，是一名开发者。' },
  ])
  assert.equal(candidates.length, 0, JSON.stringify(candidates))
  assert.ok(dropped.length >= 3, JSON.stringify(dropped))
  assert.ok(dropped.every((row) => row.reason === 'agent-narration'), JSON.stringify(dropped))
})
await check('harness boilerplate never becomes a memory', () => {
  const { candidates, dropped } = extractCandidates([
    { role: 'user', text: 'Current working directory: "C:\\Users\\someone\\OneDrive\\project".' },
    { role: 'user', text: 'Time sampled while preparing turn 1, step 1: 2026-10-31T22:21:04+08:00[Asia/Shanghai]' },
    { role: 'user', text: 'Current DSH file policy: workspace-write.' },
    { role: 'user', text: '<system-reminder>skills</system-reminder>' },
    { role: 'user', text: '- `13c-metabolic-flux`: Estimates intracellular fluxes.' },
  ])
  assert.equal(candidates.length, 0, JSON.stringify(candidates))
  assert.ok(dropped.length >= 5, JSON.stringify(dropped))
  assert.ok(dropped.every((row) => row.reason === 'runtime-context'), JSON.stringify(dropped))
})
await check('an imperative request is not a memory', () => {
  const { candidates, dropped } = extractCandidates([
    { role: 'user', text: '请你帮我做一个可视化记忆管理插件' },
    { role: 'user', text: '给我加一个导出按钮' },
    { role: 'user', text: '以后都先用中文回答' },
  ])
  assert.equal(candidates.length, 1, JSON.stringify(candidates))
  assert.equal(candidates[0].category, 'preference', candidates[0].category)
  const reasons = new Set(dropped.map((row) => row.reason))
  assert.ok(reasons.has('request'), [...reasons].join(','))
})
await check('identity needs a real self-statement', () => {
  const { candidates } = extractCandidates([
    { role: 'user', text: '我是说，这个功能先别动' },
    { role: 'user', text: '我叫 Ada，现在在做上下文压缩。' },
  ])
  assert.equal(candidates.length, 1, JSON.stringify(candidates))
  assert.equal(candidates[0].rule, 'profile.identity', candidates[0].rule)
})
await check('a repeated sentence is dropped as a duplicate', () => {
  const { candidates, dropped } = extractCandidates([
    { role: 'user', text: '我的名字是 Ada。' },
    { role: 'user', text: '我的名字是 Ada。' },
  ])
  assert.equal(candidates.filter((entry) => /Ada/.test(entry.content)).length, 1)
  assert.ok(dropped.some((entry) => entry.reason === 'duplicate'))
})
await check('thresholds order auto-save above de-duplication', () => {
  assert.ok(THRESHOLDS.autoSaveMemory > THRESHOLDS.duplicate)
  assert.ok(THRESHOLDS.autoSaveProfile >= THRESHOLDS.autoSaveMemory)
})

console.log('\nhost: graph, profile, inbox')
const { buildGraph, relatedOf } = await import(new URL('../lib/graph.js', import.meta.url).href)
const base = {
  content: 'pnpm workspace',
  kind: 'preference',
  importance: 3,
  pinned: false,
  archived: false,
  hits: 0,
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-01-02T03:04:05.000Z',
}
await check('the graph draws tag edges and reports stats', () => {
  const a = { ...base, id: 'mem_0000000a', title: '安装依赖用 pnpm', tags: ['tooling', 'pnpm'] }
  const b = { ...base, id: 'mem_0000000b', title: '工作区布局说明', tags: ['tooling', 'pnpm'] }
  const graph = buildGraph([a, b])
  assert.equal(graph.nodes.length, 2)
  assert.ok(graph.edges.length >= 1)
  assert.ok(graph.edges[0].types.includes('tag'), graph.edges[0].types.join(','))
  assert.equal(graph.stats.isolated, 0)
  assert.ok(relatedOf(graph, a.id).length >= 1)
})

const { buildTopicTree, buildSessionTree } = await import(new URL('../lib/tree.js', import.meta.url).href)
await check('the topic tree groups neighbours and keeps the rest in one bucket', () => {
  const a = { ...base, id: 'mem_00000021', title: '安装依赖用 pnpm', tags: ['tooling', 'pnpm'] }
  const b = { ...base, id: 'mem_00000022', title: '发布用 pnpm', tags: ['tooling', 'pnpm'] }
  const c = { ...base, id: 'mem_00000023', title: '孤立的笔记', tags: [], kind: 'decision' }
  const tree = buildTopicTree([a, b, c])
  assert.equal(tree.count, 3)
  const topic = tree.children.find((node) => node.tag !== '')
  assert.ok(topic, 'no topic group')
  assert.equal(topic.count, 2)
  assert.equal(topic.children.reduce((sum, kind) => sum + kind.count, 0), 2)
  const loose = tree.children.find((node) => node.label === '未归类')
  assert.ok(loose, 'no loose bucket')
  assert.deepEqual(loose.children.map((node) => node.label), ['决策'])
})

await check('the session tree nests turns in spoken order', () => {
  const a = { ...base, id: 'mem_00000031', title: '第一条', origin: { sessionId: 'session-aaaa1111', turn: 5 } }
  const b = { ...base, id: 'mem_00000032', title: '第二条', origin: { sessionId: 'session-aaaa1111', turn: 2 } }
  const c = { ...base, id: 'mem_00000033', title: '手写', origin: null }
  const tree = buildSessionTree([a, b, c])
  const session = tree.children.find((node) => node.sessionId === 'session-aaaa1111')
  assert.ok(session, 'session node missing')
  assert.deepEqual(session.children.map((node) => node.turn), [2, 5])
  assert.ok(tree.children.some((node) => node.label === '手动记录'))
})

const { ProfileStore, InboxStore, SettingsStore, CaptureEngine } = plugin.__internals
const profile = new ProfileStore(dir)
const inbox = new InboxStore(dir)
const settings = new SettingsStore(dir)
const capture = new CaptureEngine({ store, profile, inbox, settings, log: () => {} })
const callExtra = makeCaller(plugin.buildExtraRoutes({ store, profile, inbox, settings, capture }))

await check('the profile keeps identity apart from facets', () => {
  profile.setIdentity({ name: 'Ada', role: 'developer' })
  const { facet } = profile.addFacet({ category: 'preference', text: '先给结论，再给理由', source: 'manual' })
  assert.match(facet.id, /^pf_/)
  assert.equal(profile.count(), 1)
  assert.match(profile.renderSummary(), /Ada|先给结论/)
})
await check('GET /profile returns identity, facets and summary', async () => {
  const { response, json } = await callExtra('/dsh-memory-studio/api/profile', 'GET')
  assert.equal(response.status, 200)
  assert.equal(json.profile.identity.name, 'Ada')
  assert.equal(json.profile.facets.length, 1)
  assert.ok(json.summary.length > 0)
})
await check('POST /profile/facets adds one', async () => {
  const { response, json } = await callExtra('/dsh-memory-studio/api/profile/facets', 'POST', { category: 'work', text: '在一人团队维护桌面端工具' })
  assert.equal(response.status, 200)
  assert.equal(json.facet.category, 'work')
  assert.equal(profile.count(), 2)
})
await check('inbox proposals can be accepted into memories', async () => {
  const queued = inbox.add(
    {
      target: 'memory',
      kind: 'fact',
      title: 'Node 22 运行时',
      content: '项目固定使用 Node 22 运行时。',
      tags: ['tooling'],
      importance: 3,
      confidence: 0.66,
      rule: 'fact',
      label: '事实',
    },
    { sessionId: 's1', turn: 1, quote: '项目固定使用 Node 22。', at: new Date().toISOString() },
  )
  assert.ok(queued)
  const before = store.list().length
  const { json } = await callExtra('/dsh-memory-studio/api/inbox/accept', 'POST', { id: queued.id })
  assert.equal(json.ok, true)
  assert.equal(store.list().length, before + 1)
  assert.equal(inbox.count(), 0)
})
await check('GET /inbox is empty after accepting', async () => {
  const { json } = await callExtra('/dsh-memory-studio/api/inbox', 'GET')
  assert.deepEqual(json.items, [])
})
await check('capture settings default to on', async () => {
  const { json } = await callExtra('/dsh-memory-studio/api/settings', 'GET')
  assert.equal(json.settings.enabled, true)
  assert.equal(json.settings.debounceMs, 8000)
  assert.equal('injectProfile' in json.settings, false)
})
await check('POST /settings patches one key', async () => {
  const { json } = await callExtra('/dsh-memory-studio/api/settings', 'POST', { enabled: false })
  assert.equal(json.settings.enabled, false)
  await callExtra('/dsh-memory-studio/api/settings', 'POST', { enabled: true })
})
await check('GET /graph returns nodes, edges and weights', async () => {
  const { response, json } = await callExtra('/dsh-memory-studio/api/graph', 'GET')
  assert.equal(response.status, 200)
  assert.ok(Array.isArray(json.nodes))
  assert.ok(Array.isArray(json.edges))
  assert.ok(json.weights)
})
await check('GET /tree serves both shapes of the same items', async () => {
  const { response, json } = await call('/dsh-memory-studio/api/tree', 'GET')
  assert.equal(response.status, 200)
  assert.equal(json.mode, 'topic')
  assert.ok(Array.isArray(json.children))
  assert.ok(json.children.length >= 1)
  assert.equal(json.count, store.list().filter((item) => !item.archived).length)
  const session = await call('/dsh-memory-studio/api/tree?mode=session', 'GET')
  assert.equal(session.json.mode, 'session')
  assert.ok(Array.isArray(session.json.children))
})
await check('GET /profile/tree is the profile itself, filed by category then tag', async () => {
  const { response, json } = await callExtra('/dsh-memory-studio/api/profile/tree', 'GET')
  assert.equal(response.status, 200)
  assert.equal(json.mode, 'profile')
  const identity = json.children.find((node) => node.id === 'profile:identity')
  assert.ok(identity, 'identity card missing')
  assert.deepEqual(identity.children.map((row) => row.field), ['name', 'role'])
  const preference = json.children.find((node) => node.id === 'profile:preference')
  assert.ok(preference, 'preference bucket missing')
  assert.equal(preference.count, 1)
  assert.equal(preference.children[0].label, '未标记')
  const leaf = preference.children[0].children[0]
  assert.equal(leaf.id, profile.facets()[0].id)
  assert.equal(leaf.facet.text, '先给结论，再给理由')
})
await check('GET /profile/graph draws facets and only explains its edges', async () => {
  const { response, json } = await callExtra('/dsh-memory-studio/api/profile/graph', 'GET')
  assert.equal(response.status, 200)
  assert.equal(json.stats.nodes, profile.facets().length)
  assert.ok(Array.isArray(json.edges))
  for (const edge of json.edges) {
    assert.ok(['tag', 'topic', 'category'].includes(edge.types[0]), `unexpected edge type ${edge.types[0]}`)
  }
  assert.equal(typeof json.weights.tag, 'number')
})

await check('POST /items/link connects two memories', async () => {
  const ids = store.list().slice(0, 2).map((item) => item.id)
  const { json } = await callExtra('/dsh-memory-studio/api/items/link', 'POST', { from: ids[0], to: ids[1], type: 'related' })
  assert.ok(json.item.links.some((link) => link.to === ids[1]))
})

console.log('\nretrieval: embeddings + hybrid ranking')
const { tokenize, buildIndex, cosine, queryVector, rank } = await import(new URL('../lib/retrieval.js', import.meta.url).href)
await check('BM25 puts the memory that is about the term first', () => {
  const items = [
    { id: 'mem_0000000a', title: '记忆 注入', content: '记忆 策略', tags: ['记忆'], kind: 'fact' },
    {
      id: 'mem_0000000b',
      title: '随手记',
      content: '今天顺带提一句，记忆这两个字放在这里只是一个顺带提及，其余全是别的内容填充填充填充。',
      tags: [],
      kind: 'fact',
    },
  ]
  const rows = rank(buildIndex(items), '记忆')
  assert.equal(rows[0].item.id, 'mem_0000000a')
  assert.ok(rows[0].lexical > rows[1].lexical)
})
await check('tokenizer keeps CJK unigrams and bigrams', () => {
  const tokens = tokenize('导出按钮 export now')
  assert.ok(tokens.includes('导'), tokens.join(','))
  assert.ok(tokens.includes('导出'), tokens.join(','))
  assert.ok(tokens.includes('export'), tokens.join(','))
})
await check('a vector is comparable with itself and empty against a stranger', () => {
  const index = buildIndex([{ id: 'a', title: '导出按钮', content: '把记忆导出成 Markdown', tags: [], kind: 'todo' }])
  const vector = index.vectors.get('a#0')
  assert.ok(cosine(vector, vector) > 0.999)
  const stranger = queryVector('kubernetes 集群', index)
  assert.ok(Math.abs(cosine(vector, stranger)) < 0.35)
})
await check('a long memory is indexed as children and returned as one parent', () => {
  const filler = '这一段是用来把内容撑长的说明文字，重复一些没有信息量的句子，让每段都超过切块预算。'
  const body = [
    `${filler}${filler}这一段说项目用 pnpm 管理依赖。`,
    `${filler}${filler}这一段说发布前先跑冒烟测试。`,
    `${filler}这一段说导出按钮放在右下角，导出成 Markdown。`,
  ].join('\n')
  const index = buildIndex([{ id: 'mem_0000000c', title: '长笔记', content: body, tags: [], kind: 'fact' }])
  assert.ok(index.docs.length >= 2, `chunks=${index.docs.length}`)
  assert.equal(index.byItem.get('mem_0000000c').length, index.docs.length)
  const rows = rank(index, '导出 Markdown')
  assert.equal(rows.length, 1)
  assert.ok(rows[0].match.text.includes('Markdown'), JSON.stringify(rows[0].match))
})
await check('a paraphrase still finds the memory it is about', () => {
  const store2 = new MemoryStore(mkdtempSync(join(tmpdir(), 'mst-vector-')))
  store2.create({ title: '加一个导出按钮', content: '把记忆导出成 Markdown 文件', tags: ['ui'], kind: 'todo' })
  store2.create({ title: '部署脚本', content: 'pnpm build 之后拷贝到服务器', tags: ['deploy'], kind: 'fact' })
  const rows = store2.searchDetailed('导出成 md')
  assert.ok(rows.length >= 1, JSON.stringify(rows.map((row) => row.item.title)))
  assert.ok(rows[0].item.title.includes('导出'), rows[0].item.title)
  assert.ok(rows[0].vector > 0)
  const unrelated = store2.searchDetailed('kubernetes 集群')
  assert.ok(unrelated.length === 0 || unrelated[0].item.title.includes('部署') === false)
})
await check('GET /search returns scores the UI can explain', async () => {
  const { response, json } = await call('/dsh-memory-studio/api/search?q=pnpm&limit=5', 'GET')
  assert.equal(response.status, 200)
  assert.ok(Array.isArray(json.rows))
  assert.ok(json.rows.length >= 1)
  assert.ok(typeof json.rows[0].score.total === 'number')
  assert.ok(json.rows[0].score.total >= json.rows[0].score.vector)
})
await check('memory_search prints the match score', async () => {
  const search = specs.find((spec) => spec.name === 'memory_search')
  const text = await search.execute({ query: 'pnpm' })
  assert.ok(/\[\d\.\d\d\]/.test(text), text)
})

console.log('\nhost: capture end to end')
await check('a completed turn is extracted and stored', () => {
  const session = { id: 's-capture' }
  capture.observe(session, {
    type: 'user/message',
    data: {
      id: 'm-capture',
      role: 'user',
      content: [{ type: 'text', text: '我的名字是 Ada，我喜欢先看结论再听理由。' }],
      source: { kind: 'user' },
    },
  })
  capture.observe(session, {
    type: 'assistant/message',
    data: { message: { id: 'm-reply', role: 'assistant', content: [{ type: 'text', text: '好的，我记下了。' }] } },
  })
  const report = capture.finalize('s-capture', 'test')
  assert.ok(report.scanned >= 1, JSON.stringify(report))
  assert.ok(report.found >= 1, JSON.stringify(report))
  assert.ok(report.saved >= 1, JSON.stringify(report))
  assert.equal(capture.stats().lastReport?.sessionId ?? capture.lastReport?.sessionId, 's-capture')
})
await check('a plugin injection is not mistaken for a user turn', () => {
  const session = { id: 's-inject' }
  capture.observe(session, {
    type: 'user/message',
    data: {
      id: 'm-inject',
      role: 'user',
      content: [{ type: 'text', text: '我的名字是 Ada。' }],
      source: { kind: 'plugin:dsh-memory-studio', form: 'recall' },
    },
  })
  const report = capture.finalize('s-inject', 'test')
  assert.equal(report.scanned, 0)
})
await check('recall is pull-based: nothing is injected', () => {
  assert.equal(typeof capture.injectFor, 'undefined')
  assert.equal('injectProfile' in settings.get(), false)
})
await check('memory_brief is small and names what it knows', async () => {
  const spec = specs.find((entry) => entry.name === 'memory_brief')
  const text = await spec.execute({})
  assert.equal(typeof text, 'string')
  assert.ok(text.length <= 1200, String(text.length))
})

function readdirSyncSafe(path) {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
