/**
 * Render test: drives the Memory tab through a tiny React-compatible runtime so
 * the component is actually mounted, clicked and edited without a browser.
 * Run with: node test/render.mjs
 */
import assert from 'node:assert/strict'

// ------------------------------------------------------------------ mini react

const makeRuntime = () => {
  const slots = []
  let index = 0
  let dirty = false
  let queue = []
  // Hook state is per component instance, not per slot index: two views mounted
  // in sequence both start at index 0 and must not inherit each other's state.
  const owners = new Map()
  let owner = 'root'
  const keyOf = (at) => `${owner}:${at}`
  const ownerOf = (component) => {
    if (!owners.has(component)) owners.set(component, `c${owners.size}`)
    return owners.get(component)
  }

  const depsChanged = (prev, next) => {
    if (prev === undefined || next === undefined) return true
    if (prev.length !== next.length) return true
    for (let i = 0; i < prev.length; i += 1) if (!Object.is(prev[i], next[i])) return true
    return false
  }

  const hooks = {
    createElement(type, props, ...children) {
      return {
        type,
        props: props ?? {},
        children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
      }
    },
    useState(initial) {
      const at = keyOf(index)
      index += 1
      if (!(at in slots)) slots[at] = { value: typeof initial === 'function' ? initial() : initial }
      const set = (next) => {
        const value = typeof next === 'function' ? next(slots[at].value) : next
        if (Object.is(value, slots[at].value)) return
        slots[at].value = value
        dirty = true
      }
      return [slots[at].value, set]
    },
    useRef(initial) {
      const at = keyOf(index)
      index += 1
      const slot = slots[at] ?? (slots[at] = {})
      if (!slot.ref) slot.ref = { current: initial }
      return slot.ref
    },
    useMemo(factory, deps) {
      const at = keyOf(index)
      index += 1
      const slot = slots[at]
      if (!slot || slot.kind !== 'memo' || depsChanged(slot.deps, deps)) slots[at] = { kind: 'memo', deps, value: factory() }
      return slots[at].value
    },
    useCallback(fn, deps) {
      return hooks.useMemo(() => fn, deps)
    },
    useEffect(fn, deps) {
      const at = keyOf(index)
      index += 1
      const slot = slots[at]
      if (!slot || slot.kind !== 'effect' || depsChanged(slot.deps, deps)) {
        slots[at] = { kind: 'effect', deps, fn, ran: false }
        queue.push(at)
      }
    },
  }

  const runQueue = () => {
    const pending = queue
    queue = []
    for (const at of pending) {
      const slot = slots[at]
      if (!slot || slot.ran) continue
      slot.ran = true
      slot.cleanup = slot.fn()
    }
  }

  // Real React invokes function components; this runtime expands them eagerly so
  // the tree handed back is plain host elements. Child components here hold no
  // hooks, so expanding after the parent's hook pass is sound.
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand)
    if (node === null || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const previous = owner
      owner = ownerOf(node.type)
      const out = expand(node.type(node.props))
      owner = previous
      return out
    }
    return { ...node, children: (node.children ?? []).map(expand) }
  }

  const render = (component, props) => {
    owner = ownerOf(component)
    for (let round = 0; round < 25; round += 1) {
      index = 0
      const tree = component(props)
      runQueue()
      if (!dirty) return expand(tree)
      dirty = false
    }
    throw new Error('render did not settle: a state update keeps re-firing every pass')
  }

  return { React: hooks, render }
}

const textOf = (node) => {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children ?? []).map(textOf).join('')
}

const findAll = (node, predicate, found = []) => {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, found)
  return found
}

const find = (node, predicate) => findAll(node, predicate)[0]

const byClass = (name) => (node) =>
  typeof node.props?.className === 'string' && node.props.className.split(' ').includes(name)
const byTag = (tag) => (node) => node.type === tag

// ------------------------------------------------------------------ harness

const NOW = Date.now()
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString()
const items = [
  {
    id: 'mem_00000001',
    title: '项目使用 pnpm',
    content: '安装依赖请用 pnpm，不要用 npm。',
    tags: ['tooling', 'pnpm'],
    kind: 'preference',
    scope: 'global',
    importance: 4,
    pinned: true,
    archived: false,
    hits: 3,
    createdAt: iso(600),
    updatedAt: iso(20),
    lastHitAt: iso(30),
    source: 'capture',
    origin: { sessionId: 'session-abcdef12-3456', turn: 4, quote: '我们的记忆用拉取式，不要自动注入。', rule: 'decision', at: iso(600) },
  },
  {
    id: 'mem_00000002',
    title: '发布前先跑冒烟测试',
    content: '每次发版前执行 test/smoke.mjs。',
    tags: ['release'],
    kind: 'decision',
    scope: 'workspace',
    importance: 3,
    pinned: false,
    archived: false,
    hits: 0,
    createdAt: iso(2000),
    updatedAt: iso(300),
    lastHitAt: '',
    source: 'agent',
  },
]

const calls = []
const fetchStub = async (url, init = {}) => {
  const method = init.method ?? 'GET'
  const body = init.body ? JSON.parse(init.body) : undefined
  calls.push({ url, method, body })
  if (url.endsWith('/state')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items,
        stats: {},
        storeFile: 'C:\\Users\\someone\\.dsh\\memory-studio\\memories.json',
      }),
    }
  }
  if (url.includes('/search?')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        query: '',
        rows: items.map((item, index) => ({
          item,
          score: { total: 0.9 - index * 0.1, vector: 0.7, lexical: 0.2, prior: 0.1 },
          match: index === 0 ? { index: 0, text: '命中的那一小句：搜索会返回子块片段。' } : null,
          matches: index === 0 ? 1 : 0,
        })),
        took: 1,
      }),
    }
  }
  if (url.includes('/tree?')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'root',
        label: '全部记忆',
        count: items.length,
        mode: url.includes('mode=session') ? 'session' : 'topic',
        children: [
          {
            id: 'topic:t1',
            label: 'tooling',
            tag: 'tooling',
            count: 1,
            children: [
              {
                id: 'topic:t1:kind:preference',
                label: '偏好',
                kind: 'preference',
                count: 1,
                children: [{ id: items[0].id, label: items[0].title, item: items[0], count: 0, children: [] }],
              },
            ],
          },
          { id: 'topic:loose', label: '未归类', tag: '', count: 1, children: [] },
        ],
      }),
    }
  }
  if (url.endsWith('/items') && method === 'POST') {
    const item = {
      ...items[1],
      id: 'mem_00000003',
      ...body,
      tags: body.tags ?? [],
      createdAt: iso(0),
      updatedAt: iso(0),
      hits: 0,
    }
    return { ok: true, status: 200, json: async () => ({ item }) }
  }
  if (url.endsWith('/items/update')) {
    return { ok: true, status: 200, json: async () => ({ item: { ...items[0], ...body.patch } }) }
  }
  if (url.endsWith('/profile/graph')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        nodes: [
          { id: 'pf_00000001', title: '先给结论，再给理由', category: 'preference', confidence: 0.9, tags: ['style'], degree: 1 },
          { id: 'pf_00000002', title: '偏好中文回答', category: 'preference', confidence: 0.8, tags: ['style'], degree: 1 },
        ],
        edges: [{ source: 'pf_00000001', target: 'pf_00000002', weight: 3.2, types: ['tag'] }],
        stats: { nodes: 2, edges: 1, isolated: 0, byCategory: { preference: 2 } },
        weights: { tag: 2.2, topic: 2.4, category: 0.55 },
      }),
    }
  }
  if (url.endsWith('/profile/tree')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'root',
        label: '关于你',
        mode: 'profile',
        count: 1,
        children: [
          {
            id: 'profile:identity',
            label: '身份卡',
            count: 2,
            children: [
              { id: 'profile:identity:name', label: '称呼 · Ada', field: 'name', count: 0, children: [] },
              { id: 'profile:identity:role', label: '身份 · developer', field: 'role', count: 0, children: [] },
            ],
          },
          {
            id: 'profile:preference',
            label: '偏好',
            category: 'preference',
            count: 1,
            children: [
              {
                id: 'profile:preference:tag:_',
                label: '未标记',
                tag: '',
                count: 1,
                children: [
                  {
                    id: 'pf_00000001',
                    label: '先给结论，再给理由',
                    facet: { id: 'pf_00000001', category: 'preference', title: '先给结论，再给理由', text: '先给结论，再给理由' },
                    count: 0,
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      }),
    }
  }
  if (url.endsWith('/profile')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        profile: {
          identity: { name: 'Ada', role: 'developer', location: '', language: 'zh' },
          facets: [{ id: 'pf_00000001', category: 'preference', text: '先给结论，再给理由' }],
        },
        summary: '关于你：开发者，偏好先给结论。',
        categories: ['identity', 'preference'],
        labels: {},
      }),
    }
  }
  if (url.endsWith('/settings')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ settings: { enabled: true, autoSave: true, debounceMs: 8000, maxPerTurn: 4 } }),
    }
  }
  if (url.endsWith('/graph')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        nodes: items.map((item) => ({
          id: item.id,
          title: item.title,
          kind: item.kind,
          importance: item.importance,
          pinned: item.pinned,
          tags: item.tags,
          degree: 1,
        })),
        edges: [{ source: items[0].id, target: items[1].id, type: 'tag', weight: 1 }],
        stats: { nodes: 2, edges: 1, isolated: 0, byKind: { preference: 1, decision: 1 } },
      }),
    }
  }
  if (url.endsWith('/inbox')) {
    return { ok: true, status: 200, json: async () => ({ items: [], count: 0, file: 'inbox.json' }) }
  }
  return { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
}

let captured = null
globalThis.window = {
  __ModuleLoader__: { load: (descriptor) => { captured = descriptor } },
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.document = {
  documentElement: { lang: 'zh-CN' },
  head: { appendChild: () => {} },
  querySelector: () => null,
  createElement: () => ({ dataset: {}, set textContent(value) {}, get textContent() { return '' } }),
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.fetch = fetchStub
globalThis.addEventListener = () => {}

const { React, render } = makeRuntime()
await import(new URL('../lib/client.js', import.meta.url).href)
const client = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
const { MemoryStudio, MemoryView, TreeView, ProfileView, GraphView, InboxView } = client.__test

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const tick = async () => {
  await flush()
  await flush()
}
const app = () => render(MemoryView, {})
const saveButton = (tree) =>
  find(
    tree,
    (node) => byClass('mst-btn')(node) && byClass('mst-btn-primary')(node) && textOf(node).includes('保存'),
  )
const searchInput = (tree) => find(tree, byClass('mst-search')).children.find(byTag('input'))

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

console.log('dsh-memory-studio render test\n')

let tree = app()
await check('first paint is the empty shell, then state lands', async () => {
  assert.ok(find(tree, byClass('mst-root')), 'root missing')
  await tick()
  tree = app()
  assert.equal(calls[0].url, '/dsh-memory-studio/api/state')
})

await check('both memories render with title, snippet and tags', () => {
  const list = find(tree, byClass('mst-list'))
  assert.ok(list, 'list missing')
  const titles = findAll(list, byClass('mst-item-title')).map(textOf)
  assert.deepEqual(titles, ['项目使用 pnpm', '发布前先跑冒烟测试'])
  const text = textOf(list)
  assert.match(text, /tooling/)
  assert.match(text, /决策|偏好/)
})

await check('header and stats show counts from the data', () => {
  assert.match(textOf(tree), /记忆库/)
  const chips = findAll(tree, byClass('mst-chip')).map(textOf)
  assert.ok(chips.some((text) => text === '2条记忆'), chips.join(' | '))
  assert.ok(chips.some((text) => text === '1条固定'), chips.join(' | '))
  assert.ok(chips.some((text) => text === '3个标签'), chips.join(' | '))
})

await check('the heat strip has 28 days', () => {
  assert.equal(find(tree, byClass('mst-heat')).children.length, 28)
})

await check('search narrows the list', () => {
  searchInput(tree).props.onChange({ target: { value: '冒烟' } })
  tree = app()
  assert.deepEqual(findAll(tree, byClass('mst-item-title')).map(textOf), ['发布前先跑冒烟测试'])
  searchInput(tree).props.onChange({ target: { value: '' } })
  tree = app()
  assert.equal(findAll(tree, byClass('mst-item-title')).length, 2)
})

await check('clicking an item opens the editor with its content', () => {
  find(tree, byClass('mst-item')).props.onClick()
  tree = app()
  assert.equal(find(tree, byClass('mst-title-input')).props.value, '项目使用 pnpm')
  assert.equal(find(tree, byClass('mst-textarea')).props.value, '安装依赖请用 pnpm，不要用 npm。')
})

await check('editing marks the draft dirty and save posts the patch', async () => {
  find(tree, byClass('mst-textarea')).props.onChange({ target: { value: '安装依赖请一律使用 pnpm。' } })
  tree = app()
  assert.match(textOf(tree), /未保存的修改/)
  const save = saveButton(tree)
  assert.ok(save, 'save button missing')
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  await tick()
  const posted = calls.find((call) => call.url.endsWith('/items/update'))
  assert.ok(posted, 'no update call')
  assert.equal(posted.body.id, 'mem_00000001')
  assert.equal(posted.body.patch.content, '安装依赖请一律使用 pnpm。')
  tree = app()
})

await check('new memory saves through POST /items', async () => {
  find(tree, (node) => byClass('mst-btn')(node) && textOf(node).includes('新建记忆')).props.onClick()
  tree = app()
  assert.equal(find(tree, byClass('mst-title-input')).props.value, '')
  find(tree, byClass('mst-title-input')).props.onChange({ target: { value: '记得关闭窗口前提交' } })
  find(tree, byClass('mst-textarea')).props.onChange({ target: { value: '窗口关闭会丢草稿。' } })
  tree = app()
  saveButton(tree).props.onClick()
  await tick()
  const posted = calls.find((call) => call.url.endsWith('/items') && call.method === 'POST')
  assert.ok(posted, 'no create call')
  assert.equal(posted.body.title, '记得关闭窗口前提交')
  assert.equal(posted.body.kind, 'fact')
  tree = app()
})

await check('filters by kind and tag', () => {
  const select = find(tree, (node) => node.type === 'select')
  select.props.onChange({ target: { value: 'decision' } })
  tree = app()
  assert.deepEqual(findAll(tree, byClass('mst-item-title')).map(textOf), ['发布前先跑冒烟测试'])
  find(tree, (node) => node.type === 'select').props.onChange({ target: { value: 'all' } })
  tree = app()
  const tagChip = findAll(tree, byClass('mst-chip')).find((node) => /^#tooling\d*$/.test(textOf(node)))
  assert.ok(tagChip, findAll(tree, byClass('mst-chip')).map(textOf).join(' | '))
  tagChip.props.onClick()
  tree = app()
  assert.deepEqual(findAll(tree, byClass('mst-item-title')).map(textOf), ['项目使用 pnpm'])
  const clear = findAll(tree, byClass('mst-chip')).find(
    (node) => textOf(node).startsWith('#tooling') && textOf(node).includes('×'),
  )
  assert.ok(clear, 'no clear-tag chip')
  clear.props.onClick()
  tree = app()
  assert.equal(findAll(tree, byClass('mst-item-title')).length, 2)
})

await check('pinned view shows only pinned memories', () => {
  const pinned = findAll(tree, byClass('mst-chip')).find((node) => textOf(node).endsWith('条固定'))
  assert.ok(pinned)
  pinned.props.onClick()
  tree = app()
  assert.deepEqual(findAll(tree, byClass('mst-item-title')).map(textOf), ['项目使用 pnpm'])
  findAll(tree, byClass('mst-chip')).find((node) => textOf(node).endsWith('条记忆')).props.onClick()
  tree = app()
  assert.equal(findAll(tree, byClass('mst-item-title')).length, 2)
})

await check('empty search renders the empty state with a create action', () => {
  searchInput(tree).props.onChange({ target: { value: 'zzz-not-found' } })
  tree = app()
  assert.match(textOf(tree), /还没有符合条件的记忆/)
  assert.ok(find(tree, byClass('mst-empty')))
  searchInput(tree).props.onChange({ target: { value: '' } })
  tree = app()
  assert.equal(findAll(tree, byClass('mst-item-title')).length, 2)
})

await check('a search result shows the matched child snippet, not the whole note', async () => {
  searchInput(tree).props.onChange({ target: { value: '记忆' } })
  tree = app()
  await new Promise((resolve) => setTimeout(resolve, 260))
  tree = app()
  assert.ok(find(tree, byClass('mst-hit-mark')), 'hit badge missing')
  assert.match(textOf(tree), /命中的那一小句/)
  searchInput(tree).props.onChange({ target: { value: '' } })
  tree = app()
})

await check('the shell lists the five sections', () => {
  const shell = MemoryStudio({})
  assert.deepEqual(findAll(shell, byClass('mst-tab')).map(textOf), ['记忆', '目录', '我', '关系', '待审'])
  assert.ok(find(shell, byClass('mst-section')), 'section host missing')
})

await check('the tree view nests a topic under a kind and opens the memory', async () => {
  const opened = []
  const props = { onOpen: (item) => opened.push(item.id) }
  let view = render(TreeView, props)
  await tick()
  view = render(TreeView, props)
  assert.match(textOf(view), /tooling/)
  assert.ok(find(view, byClass('mst-tree')), 'tree host missing')
  const kindRow = findAll(view, byClass('mst-tree-row')).find((row) => textOf(row).includes('偏好'))
  assert.ok(kindRow, 'kind node missing')
  kindRow.props.onClick()
  view = render(TreeView, props)
  const leaf = find(view, byClass('mst-tree-item'))
  assert.ok(leaf, 'no memory node')
  leaf.props.onClick()
  assert.deepEqual(opened, ['mem_00000001'])
})

await check('a captured memory shows its origin and its session siblings', () => {
  find(tree, byClass('mst-item')).props.onClick()
  tree = app()
  assert.ok(find(tree, byClass('mst-source')), 'source card missing')
  assert.match(textOf(find(tree, byClass('mst-source'))), /同一次对话|来源/)
  assert.ok(find(tree, byClass('mst-source-quote')), 'quote missing')
})

await check('the profile view renders identity and facets', async () => {
  let view = render(ProfileView, {})
  await tick()
  view = render(ProfileView, {})
  assert.match(textOf(view), /关于你/)
  assert.match(textOf(view), /先给结论/)
  assert.ok(
    find(view, (node) => node.type === 'input' && node.props.value === 'Ada'),
    'identity name input missing',
  )
})

await check('the profile tree files facets under a category and a tag', async () => {
  let view = render(ProfileView, {})
  await tick()
  view = render(ProfileView, {})
  const treeChip = findAll(view, byClass('mst-chip')).find((chip) => textOf(chip) === '树')
  assert.ok(treeChip, 'tree toggle missing')
  treeChip.props.onClick()
  view = render(ProfileView, {})
  await flush()
  view = render(ProfileView, {})
  await flush()
  view = render(ProfileView, {})
  assert.ok(find(view, byClass('mst-tree')), 'profile tree missing')
  const categoryRow = findAll(view, byClass('mst-tree-row')).find((row) => textOf(row).includes('偏好'))
  assert.ok(categoryRow, 'category node missing')
  const tagRow = findAll(view, byClass('mst-tree-row')).find((row) => textOf(row).includes('未标记'))
  assert.ok(tagRow, 'tag node missing')
  tagRow.props.onClick()
  view = render(ProfileView, {})
  const leaf = findAll(view, byClass('mst-tree-item')).find((node) => textOf(node) === '先给结论，再给理由')
  assert.ok(leaf, 'facet leaf missing')
  leaf.props.onClick()
  view = render(ProfileView, {})
  const focused = findAll(view, byClass('mst-facet')).find((node) => node.props['data-focus'] === '1')
  assert.ok(focused, 'clicking a leaf did not focus the facet card')
})

await check('the profile graph draws the facets on a canvas', async () => {
  let view = render(ProfileView, {})
  await tick()
  view = render(ProfileView, {})
  const graphChip = findAll(view, byClass('mst-chip')).find((chip) => textOf(chip) === '关系')
  assert.ok(graphChip, 'graph toggle missing')
  graphChip.props.onClick()
  view = render(ProfileView, {})
  await flush()
  view = render(ProfileView, {})
  await flush()
  view = render(ProfileView, {})
  assert.match(textOf(view), /关于你的关系图/)
  assert.ok(find(view, byTag('canvas')), 'profile graph canvas missing')
  assert.match(textOf(view), /偏好/, 'category legend missing')
})

await check('the graph view renders a canvas and its legend', async () => {
  let view = render(GraphView, {})
  await tick()
  view = render(GraphView, {})
  assert.match(textOf(view), /记忆关系图/)
  assert.ok(find(view, byTag('canvas')), 'canvas missing')
})

await check('the inbox view renders its empty state', async () => {
  let view = render(InboxView, {})
  await tick()
  view = render(InboxView, {})
  assert.match(textOf(view), /没有待审提案/)
})

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
