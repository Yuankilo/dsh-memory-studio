/**
 * dsh-memory-studio — browser half.
 *
 * Loaded by the harness module loader: this file registers a `conversation.view`
 * tab that renders the memory manager. Everything here is plain
 * `React.createElement` so the file can ship without a build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const API = '/dsh-memory-studio/api'
    const NS = 'dsh-memory-studio'
    /** The `main` panel key and `sidebar.panellist` id are the same by contract. */
    const PANEL_ID = 'memory-studio'

    const detectZh = () => {
      const lang = typeof document !== 'undefined' ? document.documentElement.lang : ''
      if (/^zh(-|$)/i.test(lang)) return true
      if (lang && !/^en(-|$)/i.test(lang)) return false
      const nav = typeof navigator !== 'undefined' ? navigator.language : ''
      return /^zh(-|$)/i.test(nav || '')
    }
    const zh = detectZh()

    const COPY = zh
      ? {
          tab: '记忆',
          title: '记忆库',
          subtitle: '跨会话保存的事实、偏好与决策',
          search: '搜索标题、内容或标签…',
          newItem: '新建记忆',
          refresh: '刷新',
          all: '全部',
          pinned: '已固定',
          archived: '已归档',
          statTotal: '条记忆',
          statPinned: '条固定',
          statWeek: '本周更新',
          statTags: '个标签',
          filterKind: '类型',
          anyKind: '全部类型',
          filterTag: '标签',
          clearTag: '清除',
          emptyList: '还没有符合条件的记忆',
          emptyListHint: '写一条，或让 Agent 用 memory_write 保存。',
          emptyDetail: '选择左侧一条记忆',
          emptyDetailHint: '这里会显示完整内容；也可以直接新建。',
          newTitle: '新记忆',
          titlePlaceholder: '一句话标题',
          contentPlaceholder: '完整内容：发生了什么、为什么重要、下次怎么用…',
          tagsPlaceholder: '标签，用逗号分隔',
          importance: '重要度',
          save: '保存',
          saving: '保存中…',
          cancel: '取消',
          delete: '删除',
          deleteConfirm: '再点一次确认删除',
          pin: '固定',
          unpin: '取消固定',
          archive: '归档',
          unarchive: '取消归档',
          created: '创建',
          updated: '更新',
          hits: '被读取',
          times: '次',
          storeAt: '存储位置',
          saved: '已保存',
          deleted: '已删除',
          importHint: 'Agent 可通过 memory_write / memory_search 读写同一份记忆。',
          dirty: '未保存的修改',
          loadFailed: '读取记忆失败',
          retry: '重试',
          empty: '空',
          chars: '字',
        }
      : {
          tab: 'Memory',
          title: 'Memory',
          subtitle: 'Facts, preferences and decisions kept across sessions',
          search: 'Search title, content or tags…',
          newItem: 'New memory',
          refresh: 'Refresh',
          all: 'All',
          pinned: 'Pinned',
          archived: 'Archived',
          statTotal: 'memories',
          statPinned: 'pinned',
          statWeek: 'this week',
          statTags: 'tags',
          filterKind: 'Kind',
          anyKind: 'Any kind',
          filterTag: 'Tags',
          clearTag: 'Clear',
          emptyList: 'No memories match',
          emptyListHint: 'Write one, or let an Agent save with memory_write.',
          emptyDetail: 'Pick a memory',
          emptyDetailHint: 'Its full text shows here, or start a new one.',
          newTitle: 'New memory',
          titlePlaceholder: 'A one-line title',
          contentPlaceholder: 'What happened, why it matters, how to use it next time…',
          tagsPlaceholder: 'Tags, comma separated',
          importance: 'Importance',
          save: 'Save',
          saving: 'Saving…',
          cancel: 'Cancel',
          delete: 'Delete',
          deleteConfirm: 'Click again to delete',
          pin: 'Pin',
          unpin: 'Unpin',
          archive: 'Archive',
          unarchive: 'Unarchive',
          created: 'Created',
          updated: 'Updated',
          hits: 'Read',
          times: 'times',
          storeAt: 'Stored at',
          saved: 'Saved',
          deleted: 'Deleted',
          importHint: 'Agents read and write the same store through memory_write / memory_search.',
          dirty: 'Unsaved changes',
          loadFailed: 'Could not load memories',
          retry: 'Retry',
          empty: 'empty',
          chars: 'chars',
        }

    const KINDS = [
      { id: 'fact', zh: '事实', en: 'Fact', tone: '#4d6bfe' },
      { id: 'preference', zh: '偏好', en: 'Preference', tone: '#a855f7' },
      { id: 'decision', zh: '决策', en: 'Decision', tone: '#f59e0b' },
      { id: 'insight', zh: '洞察', en: 'Insight', tone: '#10b981' },
      { id: 'todo', zh: '待办', en: 'Todo', tone: '#ef4444' },
      { id: 'entity', zh: '实体', en: 'Entity', tone: '#06b6d4' },
    ]
    const kindLabel = (id) => {
      const found = KINDS.find((k) => k.id === id)
      if (!found) return id
      return zh ? found.zh : found.en
    }
    const kindTone = (id) => (KINDS.find((k) => k.id === id) || KINDS[0]).tone

    const CATEGORIES = [
      { id: 'identity', zh: '身份', en: 'Identity', tone: '#4d6bfe' },
      { id: 'work', zh: '工作', en: 'Work', tone: '#0ea5e9' },
      { id: 'tooling', zh: '工具', en: 'Tooling', tone: '#06b6d4' },
      { id: 'preference', zh: '偏好', en: 'Preference', tone: '#a855f7' },
      { id: 'constraint', zh: '限制', en: 'Constraint', tone: '#ef4444' },
      { id: 'goal', zh: '目标', en: 'Goal', tone: '#10b981' },
      { id: 'style', zh: '风格', en: 'Style', tone: '#f59e0b' },
    ]
    const categoryLabel = (id) => {
      const found = CATEGORIES.find((entry) => entry.id === id)
      return found ? (zh ? found.zh : found.en) : id
    }
    const categoryTone = (id) => (CATEGORIES.find((entry) => entry.id === id) || CATEGORIES[0]).tone

    /** Copy for the parts added after v1: profile, graph, inbox, capture. */
    const MORE = zh
      ? {
          secMemory: '记忆',
          secTree: '目录',
          secProfile: '我',
          secGraph: '关系',
          secInbox: '待审',
          treeModeTopic: '按主题',
          treeModeSession: '按会话',
          treeEmpty: '还没有可以成组的记忆',
          treeOpen: '在列表里打开',
          profileTitle: '关于你',
          profileSub: '独立于工作记忆的长期画像；需要时才读取，平时不占上下文',
          profileCards: '卡片',
          profileTree: '树',
          profileGraph: '关系',
          profileGraphTitle: '关于你的关系图',
          profileGraphSub: '每条画像是一个点：共享标签、措辞相近、同类别的会被连起来',
          profileGraphEmpty: '还画不出图：至少要有两条画像',
          facetOpen: '在卡片中查看',
          summary: '助手从 memory_brief / profile_read 拿到的内容',
          summaryEmpty: '画像还是空的。写下几条，或让 Agent 用 profile_write 记录。',
          identity: '基本信息',
          name: '称呼',
          role: '身份 / 角色',
          location: '所在地',
          language: '语言偏好',
          saveIdentity: '保存基本信息',
          addFacet: '添加',
          facetText: '写下一条关于你的长期事实，例如“偏好先给结论，再给理由”…',
          remove: '移除',
          graphTitle: '记忆关系图',
          graphSub: '共享标签、措辞相近、同一会话自动连边；拖动、滚轮缩放、点节点看关联',
          graphEmpty: '记忆还太少，图会随沉淀自动长出来',
          related: '关联记忆',
          relatedEmpty: '这条记忆还没有连边',
          inboxTitle: '待审提案',
          inboxSub: '自动沉淀时把握不足的条目：确认后才写入，忽略即丢弃',
          accept: '入库',
          dismiss: '忽略',
          acceptAll: '全部入库',
          clearAll: '清空',
          inboxEmpty: '没有待审提案',
          confidence: '置信度',
          captureTitle: '自动沉淀',
          captureEnabled: '会话结束时自动沉淀',
          captureAuto: '高置信度直接保存（其余进待审）',
          capturePull: '记忆不再自动注入会话：需要时由助手调用 memory_brief / memory_search / profile_read。',
          debounce: '合并窗口（秒）',
          flush: '立即沉淀当前缓冲',
          lastReport: '上次沉淀',
          report: (row) => `扫描 ${row.scanned} 句 · 采纳 ${row.saved} · 待审 ${row.queued}`,
          linkType: { link: '显式', tag: '同标签', topic: '措辞相近', kind: '同类型', session: '同会话', time: '同时', category: '同类别' },
          nodes: '节点',
          edges: '边',
          isolated: '孤立',
          kinds: '类型',
          targetMemory: '记忆',
          targetProfile: '画像',
          origin: '来源',
          noOrigin: '手动记录',
          sameSession: '同一次对话',
        }
      : {
          secMemory: 'Memory',
          secTree: 'Tree',
          secProfile: 'Me',
          secGraph: 'Graph',
          secInbox: 'Inbox',
          treeModeTopic: 'By topic',
          treeModeSession: 'By session',
          treeEmpty: 'Nothing to group yet',
          treeOpen: 'Open in list',
          profileTitle: 'About you',
          profileSub: 'A long-term portrait kept apart from work memories; read when it matters, never injected by default',
          profileCards: 'Cards',
          profileTree: 'Tree',
          profileGraph: 'Graph',
          profileGraphTitle: 'How you hold together',
          profileGraphSub: 'Each facet is a point; shared tags, similar wording and the same category draw the lines',
          profileGraphEmpty: 'Nothing to draw yet — needs at least two facets',
          facetOpen: 'Show in cards',
          summary: 'What the agent gets from memory_brief / profile_read',
          summaryEmpty: 'The profile is empty. Write a few facts, or let an Agent call profile_write.',
          identity: 'Basics',
          name: 'Name',
          role: 'Role',
          location: 'Location',
          language: 'Language',
          saveIdentity: 'Save basics',
          addFacet: 'Add',
          facetText: 'One durable fact about you, e.g. "prefers the conclusion before the reasoning"…',
          remove: 'Remove',
          graphTitle: 'Memory graph',
          graphSub: 'Edges come from shared tags, similar wording and shared sessions. Drag, wheel to zoom, click a node.',
          graphEmpty: 'Too few memories yet — the graph grows as capture runs',
          related: 'Related',
          relatedEmpty: 'No edges yet',
          inboxTitle: 'Pending proposals',
          inboxSub: 'Low-confidence captures wait here: accept writes them, dismiss drops them',
          accept: 'Save',
          dismiss: 'Dismiss',
          acceptAll: 'Accept all',
          clearAll: 'Clear',
          inboxEmpty: 'Nothing pending',
          confidence: 'Confidence',
          captureTitle: 'Auto capture',
          captureEnabled: 'Capture when a session ends',
          captureAuto: 'Save high-confidence ones directly (rest go to the inbox)',
          capturePull: 'Memory is never injected into a session — the assistant pulls it with memory_brief / memory_search / profile_read only when needed.',
          debounce: 'Coalesce window (s)',
          flush: 'Capture the current buffer now',
          lastReport: 'Last run',
          report: (row) => `${row.scanned} sentences scanned · ${row.saved} saved · ${row.queued} queued`,
          linkType: { link: 'explicit', tag: 'tag', topic: 'wording', kind: 'kind', session: 'session', time: 'time', category: 'category' },
          nodes: 'nodes',
          edges: 'edges',
          isolated: 'isolated',
          kinds: 'Kinds',
          targetMemory: 'memory',
          targetProfile: 'profile',
          origin: 'Source',
          noOrigin: 'Added by hand',
          sameSession: 'Same conversation',
        }

    // ---------------------------------------------------------------- styles

    const CSS = `
.mst-root{--mst-radius:12px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;height:100%;min-height:440px;padding:14px 16px 16px;color:var(--dsw-alias-label-primary);overflow:hidden;font-size:13px}
.mst-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.mst-brand{display:flex;align-items:baseline;gap:8px;min-width:0}
.mst-title{font-size:15px;font-weight:650;letter-spacing:.01em}
.mst-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mst-spacer{flex:1 1 24px;min-width:8px}
.mst-search{position:relative;display:flex;align-items:center;min-width:180px;max-width:320px;flex:0 1 280px}
.mst-search input{width:100%;box-sizing:border-box;height:28px;padding:0 10px 0 28px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}
.mst-search input:focus{border-color:color-mix(in srgb,var(--color-blue-500) 55%,var(--dsw-alias-border-l2))}
.mst-search svg{position:absolute;left:9px;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.mst-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;transition:border-color .15s ease,background-color .15s ease,color .15s ease}
.mst-btn:hover:not(:disabled){border-color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover)}
.mst-btn:disabled{opacity:.45;cursor:default}
.mst-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.mst-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-button-primary-fill) 88%,#fff);border-color:transparent}
.mst-btn-danger{color:var(--dsw-alias-state-error-primary,var(--color-red-500));border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--color-red-500)) 40%,var(--dsw-alias-border-l2))}
.mst-iconbtn{width:28px;padding:0;justify-content:center}
.mst-stats{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mst-chip{display:inline-flex;align-items:baseline;gap:5px;padding:3px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;font-family:inherit;line-height:1.5}
.mst-chip b{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-size:11.5px;font-weight:650}
.mst-chip-on{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.mst-chip-on b{color:inherit}
.mst-chip-static{cursor:default}
.mst-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.mst-heat{display:flex;align-items:flex-end;gap:2px;margin-left:auto;padding-left:6px}
.mst-heat i{display:block;width:8px;height:8px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 16%,transparent)}
.mst-heat i[data-l="1"]{background:color-mix(in srgb,var(--color-blue-500) 30%,transparent)}
.mst-heat i[data-l="2"]{background:color-mix(in srgb,var(--color-blue-500) 52%,transparent)}
.mst-heat i[data-l="3"]{background:color-mix(in srgb,var(--color-blue-500) 74%,transparent)}
.mst-heat i[data-l="4"]{background:var(--color-blue-500)}
.mst-body{display:grid;grid-template-columns:minmax(260px,360px) minmax(0,1fr);gap:12px;flex:1 1 auto;min-height:0}
.mst-col{display:flex;flex-direction:column;gap:8px;min-height:0;min-width:0}
.mst-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:0 1px}
.mst-select{height:26px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;padding:0 6px;outline:none;max-width:150px}
.mst-list{overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:7px;padding:1px 3px 8px 1px;min-height:0;scrollbar-width:thin}
.mst-item{text-align:left;font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px 9px;cursor:pointer;display:flex;flex-direction:column;gap:4px;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease;min-width:0}
.mst-item:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4,var(--dsw-alias-label-tertiary))}
.mst-item-on{border-color:color-mix(in srgb,var(--color-blue-500) 58%,var(--dsw-alias-border-l2));box-shadow:0 0 0 1px color-mix(in srgb,var(--color-blue-500) 26%,transparent);background:color-mix(in srgb,var(--color-blue-500) 5%,var(--dsw-alias-bg-layer-1))}
.mst-item-top{display:flex;align-items:center;gap:6px;min-width:0}
.mst-item-title{font-size:12.5px;font-weight:600;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.mst-item-time{font-size:10px;color:var(--dsw-alias-label-tertiary);flex:none;font-variant-numeric:tabular-nums}
.mst-item-snippet{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.mst-item-foot{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:1px}
.mst-kind{display:inline-flex;align-items:center;gap:4px;font-size:10px;line-height:1.5;padding:0 6px;border-radius:999px;white-space:nowrap;border:1px solid color-mix(in srgb,var(--mst-tone) 38%,transparent);color:color-mix(in srgb,var(--mst-tone) 78%,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--mst-tone) 10%,transparent)}
.mst-tag{font-size:10px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent);border-radius:999px;padding:0 6px;line-height:1.6;white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis}
.mst-pindot{width:6px;height:6px;border-radius:50%;background:var(--color-blue-500);flex:none}
.mst-score{margin-left:auto;font-size:10px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#8a8f98);flex:none}
.mst-detail{display:flex;flex-direction:column;gap:9px;min-height:0;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--mst-radius);background:var(--dsw-alias-bg-layer-1);padding:12px 13px}
.mst-detail-head{display:flex;align-items:center;gap:8px;min-width:0}
.mst-title-input{flex:1 1 auto;min-width:0;border:0;background:transparent;font:inherit;font-size:16px;font-weight:650;color:var(--dsw-alias-label-primary);outline:none;padding:2px 0;border-bottom:1px solid transparent}
.mst-title-input:focus{border-bottom-color:color-mix(in srgb,var(--color-blue-500) 50%,transparent)}
.mst-title-input::placeholder{color:var(--dsw-alias-label-tertiary);font-weight:500}
.mst-fieldrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mst-field{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.mst-tags-input{flex:1 1 160px;min-width:120px;height:26px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;padding:0 8px;outline:none}
.mst-tags-input:focus{border-color:color-mix(in srgb,var(--color-blue-500) 50%,var(--dsw-alias-border-l2))}
.mst-stars{display:inline-flex;gap:1px}
.mst-star{border:0;background:transparent;color:color-mix(in srgb,var(--dsw-alias-label-secondary) 45%,transparent);font-size:13px;line-height:1;padding:0 1px;cursor:pointer;font-family:inherit}
.mst-star[data-on="1"]{color:#f59e0b}
.mst-textarea{flex:1 1 auto;min-height:150px;width:100%;box-sizing:border-box;resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:1.62;padding:10px 11px;outline:none}
.mst-textarea:focus{border-color:color-mix(in srgb,var(--color-blue-500) 50%,var(--dsw-alias-border-l2))}
.mst-detail-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:28px}
.mst-meta{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.mst-actions{display:flex;align-items:center;gap:6px;margin-left:auto}
.mst-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;color:var(--dsw-alias-label-secondary);padding:24px 12px}
.mst-empty svg{color:color-mix(in srgb,var(--dsw-alias-label-secondary) 55%,transparent)}
.mst-empty b{font-size:13px;color:var(--dsw-alias-label-primary);font-weight:600}
.mst-empty span{font-size:11.5px;line-height:1.5;max-width:340px}
.mst-empty .mst-btn{margin-top:6px}
.mst-banner{display:flex;align-items:center;gap:8px;border-radius:8px;padding:6px 10px;font-size:11.5px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--color-red-500)) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--color-red-500)) 30%,transparent);color:var(--dsw-alias-label-primary)}
.mst-toast{position:absolute;right:18px;bottom:16px;z-index:5;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 6px 20px #0003;border-radius:8px;padding:6px 12px;font-size:11.5px;color:var(--dsw-alias-label-primary);animation:mst-in .16s ease-out}
@keyframes mst-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.mst-loading{display:flex;align-items:center;justify-content:center;flex:1;color:var(--dsw-alias-label-secondary);font-size:12px}
.mst-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.mst-shell{display:flex;flex-direction:column;height:100%;min-height:0;position:relative}
.mst-panel{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;height:100%;overflow:hidden}
.mst-tabs{display:flex;align-items:center;gap:4px;padding:10px 16px 0;flex-wrap:wrap;flex:none}
.mst-tab{height:26px;padding:0 12px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;transition:background-color .15s ease,color .15s ease}
.mst-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mst-tab[data-on="1"]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.mst-section{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.mst-tree-view{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0;padding:0 16px 16px}
.mst-tree-head{display:flex;align-items:center;gap:8px;flex:none;padding-top:8px}
.mst-tree-modes{display:flex;align-items:center;gap:6px}
.mst-tree-modes .mst-chip[data-on="1"]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.mst-tree-total{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.mst-tree{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:8px 10px;scrollbar-width:thin}
.mst-tree-group{display:flex;flex-direction:column}
.mst-tree-row{display:flex;align-items:center;gap:7px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:5px 6px;border-radius:7px;cursor:pointer;text-align:left}
.mst-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.mst-tree-row[data-open="1"]>.mst-tree-label{color:var(--dsw-alias-label-primary);font-weight:600}
.mst-tree-caret{width:12px;flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.mst-tree-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.mst-tree-count{flex:none;font-size:10px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:1px 7px}
.mst-tree-children{margin-left:14px;border-left:1px solid var(--dsw-alias-border-l1);padding-left:4px;display:flex;flex-direction:column}
.mst-tree-item{display:flex;align-items:center;gap:7px;width:100%;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:4px 6px;border-radius:7px;cursor:pointer;text-align:left}
.mst-tree-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mst-tree-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--mst-tone,#8a8f98)}
.mst-cards{display:flex;flex-direction:column;gap:10px;flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 16px 16px;scrollbar-width:thin}
.mst-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:11px 13px;min-width:0}
.mst-card h4{margin:0;font-size:12px;font-weight:650;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}
.mst-input{height:28px;box-sizing:border-box;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 8px;outline:none;min-width:0;width:100%}
.mst-input:focus{border-color:color-mix(in srgb,var(--color-blue-500) 50%,var(--dsw-alias-border-l2))}
.mst-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.mst-facet{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);min-width:0}
.mst-facet p{margin:0;flex:1 1 auto;font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.mst-facet[data-focus="1"]{outline:2px solid var(--dsw-alias-button-primary-fill);outline-offset:1px}
.mst-x{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;font-family:inherit}
.mst-x:hover{color:var(--dsw-alias-state-error-primary,var(--color-red-500))}
.mst-graph-body{display:flex;gap:10px;flex:1 1 auto;min-height:0;padding:0 16px 16px}
.mst-canvas-wrap{position:relative;flex:1 1 auto;min-height:240px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.mst-canvas-wrap canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}
.mst-legend{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 16px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.mst-swatch{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px}
.mst-drawer{display:flex;flex-direction:column;gap:6px;overflow-y:auto;scrollbar-width:thin;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 11px;width:min(300px,38%);min-width:200px}
.mst-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px 0}
.mst-switch{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mst-switch input{accent-color:var(--color-blue-500)}
.mst-inbox-list{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 16px 16px;scrollbar-width:thin}
.mst-inbox-row{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:9px 11px}
.mst-bar{height:3px;border-radius:2px;background:var(--color-blue-500);opacity:.8}
.mst-badge{font-size:10px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);line-height:1.6;white-space:nowrap}
.mst-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.mst-summary{margin:0;white-space:pre-wrap;font:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);max-height:170px;overflow:auto}
.mst-item-hit{color:var(--dsw-alias-label-primary);background:color-mix(in oklab, var(--dsw-alias-button-primary-fill,#4d6bfe) 9%, transparent);border-radius:6px;padding:4px 6px;margin:0 0 0 0}
.mst-hit-mark{display:inline-block;margin-right:5px;padding:0 4px;border-radius:4px;font-size:9px;line-height:14px;letter-spacing:.04em;background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}
.mst-source{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:6px}
.mst-source-head{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.mst-source-tag{letter-spacing:.04em}
.mst-source-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover)}
.mst-source-turn{margin-left:auto}
.mst-source-quote{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l1);padding-left:8px}
.mst-source-siblings{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.mst-source-label{font-size:10px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary)}
.mst-chip{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:3px 9px;font:inherit;font-size:11px;cursor:pointer}
.mst-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
@media (max-width: 860px){.mst-body{grid-template-columns:minmax(0,1fr)}.mst-detail{min-height:320px}}
@media (max-width: 620px){.mst-heat{display:none}.mst-search{flex:1 1 100%;max-width:none}}
`

    let styleInjected = false
    const injectStyle = () => {
      if (styleInjected || typeof document === 'undefined') return
      styleInjected = true
      if (document.querySelector(`style[data-plugin-css="${NS}"]`) !== null) return
      const style = document.createElement('style')
      style.dataset.plugin = NS
      style.dataset.pluginCss = NS
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ---------------------------------------------------------------- utils

    const snippet = (value, max = 160) => {
      const flat = String(value || '').replace(/\s+/g, ' ').trim()
      return flat.length > max ? `${flat.slice(0, max)}…` : flat
    }

    const relTime = (iso) => {
      const t = Date.parse(iso)
      if (!Number.isFinite(t)) return ''
      const diff = Date.now() - t
      if (diff < 60 * 1000) return zh ? '刚刚' : 'now'
      if (diff < 60 * 60 * 1000) return zh ? `${Math.floor(diff / 60000)} 分钟前` : `${Math.floor(diff / 60000)}m ago`
      if (diff < 24 * 60 * 60 * 1000) return zh ? `${Math.floor(diff / 3600000)} 小时前` : `${Math.floor(diff / 3600000)}h ago`
      if (diff < 30 * 24 * 60 * 60 * 1000) return zh ? `${Math.floor(diff / 86400000)} 天前` : `${Math.floor(diff / 86400000)}d ago`
      return new Date(t).toLocaleDateString()
    }

    const dayKey = (date) => {
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    const parseTags = (value) =>
      String(value || '')
        .split(/[,，\n]/)
        .map((raw) => raw.trim().replace(/^#+/, ''))
        .filter((tag, index, list) => tag !== '' && list.findIndex((t) => t.toLowerCase() === tag.toLowerCase()) === index)
        .slice(0, 16)

    const blankDraft = () => ({
      id: null,
      title: '',
      content: '',
      tags: '',
      kind: 'fact',
      scope: 'global',
      importance: 3,
      pinned: false,
      archived: false,
      createdAt: '',
      updatedAt: '',
      hits: 0,
      origin: null,
    })

    const draftFrom = (item) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      tags: item.tags.join(', '),
      kind: item.kind,
      scope: item.scope,
      importance: item.importance,
      pinned: item.pinned,
      archived: item.archived,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      hits: item.hits,
      origin: item.origin ?? null,
    })

    async function api(path, options) {
      const init = { ...(options || {}) }
      init.headers = { 'content-type': 'application/json', ...(init.headers || {}) }
      const response = await fetch(`${API}${path}`, init)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
      return body
    }

    // ---------------------------------------------------------------- icons

    const svg = (paths, size = 14) =>
      h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        paths.map((d, index) => h('path', { key: index, d })),
      )

    const Icon = {
      search: () => svg(['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3']),
      plus: () => svg(['M12 5v14', 'M5 12h14']),
      refresh: () => svg(['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6']),
      brain: (size) => svg(['M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8A3 3 0 0 0 8 18a3 3 0 0 0 4 1V4a3 3 0 0 0-3 0Z', 'M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8A3 3 0 0 1 16 18a3 3 0 0 1-4 1V4a3 3 0 0 1 3 0Z'], size || 26),
      pin: () => svg(['M12 17v5', 'M5 9l7-6 7 6-2 1v5l2 1H5l2-1v-5L5 9Z']),
      trash: () => svg(['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13']),
      save: () => svg(['M5 3h11l3 3v15H5z', 'M8 3v6h8V3', 'M8 21v-7h8v7']),
    }

    // ---------------------------------------------------------------- pieces

    function MemoryItem({ item, active, onPick, score, match }) {
      const body = match ? match.text : item.content
      return h(
        'button',
        {
          type: 'button',
          className: `mst-item${active ? ' mst-item-on' : ''}`,
          onClick: () => onPick(item),
          title: item.title,
        },
        h(
          'div',
          { className: 'mst-item-top' },
          item.pinned ? h('span', { className: 'mst-pindot' }) : null,
          h('span', { className: 'mst-item-title' }, item.title),
          h('span', { className: 'mst-item-time' }, relTime(item.updatedAt)),
        ),
        body
          ? h(
              'div',
              { className: `mst-item-snippet${match ? ' mst-item-hit' : ''}` },
              match ? h('span', { className: 'mst-hit-mark' }, '命中') : null,
              snippet(body, 150),
            )
          : null,
        h(
          'div',
          { className: 'mst-item-foot' },
          h(
            'span',
            { className: 'mst-kind', style: { '--mst-tone': kindTone(item.kind) } },
            kindLabel(item.kind),
          ),
          item.tags.slice(0, 3).map((tag) =>
            h('span', { className: 'mst-tag', key: tag }, tag),
          ),
          item.tags.length > 3
            ? h('span', { className: 'mst-tag' }, `+${item.tags.length - 3}`)
            : null,
          typeof score === 'number'
            ? h('span', { className: 'mst-score', title: 'match score' }, score.toFixed(2))
            : null,
        ),
      )
    }

    function EmptyState({ tone, title, hint, action, actionLabel }) {
      return h(
        'div',
        { className: 'mst-empty' },
        tone,
        h('b', null, title),
        h('span', null, hint),
        action ? h('button', { type: 'button', className: 'mst-btn', onClick: action }, actionLabel) : null,
      )
    }

    function MemoryView({ focus } = {}) {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [query, setQuery] = useState('')
      const [kind, setKind] = useState('all')
      const [tag, setTag] = useState('')
      const [view, setView] = useState('all')
      const [selectedId, setSelectedId] = useState(null)
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [toast, setToast] = useState('')
      const [hits, setHits] = useState(null)
      const toastTimer = useRef(null)
      const searchRef = useRef(null)

      const notify = useCallback((message) => {
        setToast(message)
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(''), 2200)
      }, [])

      useEffect(() => () => {
        if (toastTimer.current) clearTimeout(toastTimer.current)
      }, [])

      const load = useCallback(async () => {
        setLoading(true)
        try {
          const body = await api('/state')
          setState(body)
          setError('')
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const items = state?.items ?? []
      const stats = useMemo(() => {
        const week = Date.now() - 7 * 24 * 60 * 60 * 1000
        const tags = new Set()
        let pinned = 0
        let recent = 0
        for (const item of items) {
          for (const one of item.tags) tags.add(one)
          if (item.pinned) pinned += 1
          if (Date.parse(item.updatedAt) >= week) recent += 1
        }
        return { total: items.length, pinned, recent, tags: tags.size }
      }, [items])

      const tagCounts = useMemo(() => {
        const map = new Map()
        for (const item of items) {
          for (const one of item.tags) map.set(one, (map.get(one) ?? 0) + 1)
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      }, [items])

      // The tree hands an item back to this view: select it instead of making
      // the user find it again in the list.
      useEffect(() => {
        if (!focus?.id || items.length === 0) return
        const item = items.find((one) => one.id === focus.id)
        if (!item) return
        setSelectedId(item.id)
        setDraft(draftFrom(item))
        setConfirmDelete(false)
      }, [focus, items])

      // Search goes through the host so the browser and the Agent rank with the
      // same hybrid scorer; the local list only filters when the box is empty.
      useEffect(() => {
        const q = query.trim()
        if (q === '') {
          setHits(null)
          return undefined
        }
        let cancelled = false
        const timer = setTimeout(async () => {
          try {
            const params = new URLSearchParams({
              q,
              kind: kind === 'all' ? '' : kind,
              tag,
              limit: '50',
              archived: view === 'archived' ? '1' : '0',
            })
            const body = await api(`/search?${params.toString()}`)
            if (!cancelled) setHits(Array.isArray(body?.rows) ? body.rows : [])
          } catch {
            if (!cancelled) setHits([])
          }
        }, 180)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [query, kind, tag, view, items])

      const hitOf = useMemo(
        () =>
          new Map(
            (hits ?? []).map((row) => [row.item.id, { score: row.score?.total, match: row.match ?? null }]),
          ),
        [hits],
      )

      const visible = useMemo(() => {
        const q = query.trim().toLowerCase()
        const searching = q !== '' && hits !== null
        const base = searching ? hits.map((row) => row.item) : items
        const filtered = base
          .filter((item) => {
            if (view === 'archived') return item.archived
            if (item.archived) return false
            if (view === 'pinned') return item.pinned
            return true
          })
          .filter((item) => (kind === 'all' ? true : item.kind === kind))
          .filter((item) => (tag === '' ? true : item.tags.some((one) => one === tag)))
        if (searching) return filtered
        return filtered
          .filter((item) => {
            if (q === '') return true
            return (
              item.title.toLowerCase().includes(q) ||
              item.content.toLowerCase().includes(q) ||
              item.tags.some((one) => one.toLowerCase().includes(q))
            )
          })
          .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
            return String(b.updatedAt).localeCompare(String(a.updatedAt))
          })
      }, [items, view, kind, tag, query, hits])

      const selected = useMemo(
        () => items.find((item) => item.id === selectedId) ?? null,
        [items, selectedId],
      )

      // A saved item keeps the editor in sync with the server copy; a new draft
      // is left alone so typing is never overwritten by a background refresh.
      useEffect(() => {
        if (draft !== null) return
        if (selected !== null) {
          setDraft(draftFrom(selected))
        }
      }, [selected, draft])

      const pick = (item) => {
        setSelectedId(item.id)
        setDraft(draftFrom(item))
        setConfirmDelete(false)
      }

      const startNew = () => {
        setSelectedId(null)
        setDraft(blankDraft())
        setConfirmDelete(false)
      }

      const patchDraft = (patch) => setDraft((current) => (current === null ? current : { ...current, ...patch }))

      const dirty = useMemo(() => {
        if (draft === null) return false
        if (draft.id === null) return draft.title.trim() !== '' || draft.content.trim() !== '' || draft.tags.trim() !== ''
        if (selected === null) return true
        return (
          draft.title !== selected.title ||
          draft.content !== selected.content ||
          draft.tags !== selected.tags.join(', ') ||
          draft.kind !== selected.kind ||
          draft.scope !== selected.scope ||
          draft.importance !== selected.importance ||
          draft.pinned !== selected.pinned ||
          draft.archived !== selected.archived
        )
      }, [draft, selected])

      const save = async () => {
        if (draft === null || busy) return
        const title = draft.title.trim()
        const content = draft.content.trim()
        if (title === '' && content === '') return
        setBusy(true)
        try {
          const payload = {
            title: title || content.split('\n')[0].slice(0, 80),
            content,
            tags: parseTags(draft.tags),
            kind: draft.kind,
            scope: draft.scope,
            importance: draft.importance,
            pinned: draft.pinned,
            archived: draft.archived,
          }
          const body =
            draft.id === null
              ? await api('/items', { method: 'POST', body: JSON.stringify(payload) })
              : await api('/items/update', {
                  method: 'POST',
                  body: JSON.stringify({ id: draft.id, patch: payload }),
                })
          const item = body.item
          await load()
          setSelectedId(item.id)
          setDraft(null)
          notify(COPY.saved)
        } catch (cause) {
          notify(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      const remove = async () => {
        if (draft === null || draft.id === null || busy) return
        if (!confirmDelete) {
          setConfirmDelete(true)
          setTimeout(() => setConfirmDelete(false), 4000)
          return
        }
        setBusy(true)
        try {
          await api('/items/delete', { method: 'POST', body: JSON.stringify({ id: draft.id }) })
          setConfirmDelete(false)
          setSelectedId(null)
          setDraft(null)
          await load()
          notify(COPY.deleted)
        } catch (cause) {
          notify(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      useEffect(() => {
        const onKey = (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            searchRef.current?.focus()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const heat = useMemo(() => {
        const counts = new Map()
        for (const item of items) {
          const t = Date.parse(item.updatedAt)
          if (Number.isFinite(t)) {
            const key = dayKey(new Date(t))
            counts.set(key, (counts.get(key) ?? 0) + 1)
          }
        }
        const days = []
        for (let offset = 27; offset >= 0; offset -= 1) {
          const date = new Date()
          date.setHours(0, 0, 0, 0)
          date.setDate(date.getDate() - offset)
          const key = dayKey(date)
          const count = counts.get(key) ?? 0
          days.push({ key, count, level: count === 0 ? 0 : count < 2 ? 1 : count < 4 ? 2 : count < 7 ? 3 : 4 })
        }
        return days
      }, [items])

      const header = h(
        'div',
        { className: 'mst-top' },
        h(
          'div',
          { className: 'mst-brand' },
          h('span', { className: 'mst-title' }, COPY.title),
          h('span', { className: 'mst-sub' }, COPY.subtitle),
        ),
        h('span', { className: 'mst-spacer' }),
        h(
          'div',
          { className: 'mst-search' },
          Icon.search(),
          h('input', {
            ref: searchRef,
            value: query,
            placeholder: COPY.search,
            onChange: (event) => setQuery(event.target.value),
            'aria-label': COPY.search,
          }),
        ),
        h(
          'button',
          { type: 'button', className: 'mst-btn mst-iconbtn', onClick: load, title: COPY.refresh, 'aria-label': COPY.refresh },
          Icon.refresh(),
        ),
        h(
          'button',
          { type: 'button', className: 'mst-btn mst-btn-primary', onClick: startNew },
          Icon.plus(),
          COPY.newItem,
        ),
      )

      const statRow = h(
        'div',
        { className: 'mst-stats' },
        h(
          'button',
          {
            type: 'button',
            className: `mst-chip${view === 'all' ? ' mst-chip-on' : ''}`,
            onClick: () => setView('all'),
          },
          h('b', null, stats.total),
          COPY.statTotal,
        ),
        h(
          'button',
          {
            type: 'button',
            className: `mst-chip${view === 'pinned' ? ' mst-chip-on' : ''}`,
            onClick: () => setView('pinned'),
          },
          h('b', null, stats.pinned),
          COPY.statPinned,
        ),
        h('span', { className: 'mst-chip mst-chip-static' }, h('b', null, stats.recent), COPY.statWeek),
        h('span', { className: 'mst-chip mst-chip-static' }, h('b', null, stats.tags), COPY.statTags),
        view === 'archived'
          ? h(
              'button',
              { type: 'button', className: 'mst-chip mst-chip-on', onClick: () => setView('all') },
              COPY.archived,
            )
          : h(
              'button',
              { type: 'button', className: 'mst-chip', onClick: () => setView('archived') },
              COPY.archived,
            ),
        h(
          'div',
          { className: 'mst-heat', title: COPY.statWeek },
          heat.map((day) => h('i', { key: day.key, 'data-l': String(day.level), title: `${day.key} · ${day.count}` })),
        ),
      )

      const filters = h(
        'div',
        { className: 'mst-filters' },
        h(
          'select',
          {
            className: 'mst-select',
            value: kind,
            onChange: (event) => setKind(event.target.value),
            'aria-label': COPY.filterKind,
          },
          h('option', { value: 'all' }, COPY.anyKind),
          KINDS.map((entry) => h('option', { key: entry.id, value: entry.id }, zh ? entry.zh : entry.en)),
        ),
        tag !== ''
          ? h(
              'button',
              { type: 'button', className: 'mst-chip mst-chip-on', onClick: () => setTag('') },
              `#${tag}`,
              ' ×',
            )
          : null,
        h(
          'div',
          { className: 'mst-chips' },
          tagCounts
            .filter(([name]) => name !== tag)
            .slice(0, tag === '' ? 5 : 4)
            .map(([name, count]) =>
              h(
                'button',
                { key: name, type: 'button', className: 'mst-chip', onClick: () => setTag(name) },
                `#${name}`,
                h('b', null, count),
              ),
            ),
        ),
      )

      const list = h(
        'div',
        { className: 'mst-list' },
        visible.length === 0
          ? h(EmptyState, {
              tone: Icon.brain(28),
              title: COPY.emptyList,
              hint: COPY.emptyListHint,
              action: startNew,
              actionLabel: COPY.newItem,
            })
          : visible.map((item) => {
              const hit = hitOf.get(item.id)
              return h(MemoryItem, {
                key: item.id,
                item,
                active: item.id === selectedId,
                onPick: pick,
                score: hit?.score,
                match: hit?.match ?? null,
              })
            }),
      )

      const detail =
        draft === null
          ? h(
              'div',
              { className: 'mst-detail' },
              h(EmptyState, {
                tone: Icon.brain(30),
                title: COPY.emptyDetail,
                hint: COPY.emptyDetailHint,
                action: startNew,
                actionLabel: COPY.newItem,
              }),
              state?.storeFile
                ? h('div', { className: 'mst-hint', style: { textAlign: 'center', paddingBottom: '6px' } }, `${COPY.storeAt}: ${state.storeFile}`)
                : null,
            )
          : h(
              'div',
              { className: 'mst-detail' },
              h(
                'div',
                { className: 'mst-detail-head' },
                h('input', {
                  className: 'mst-title-input',
                  value: draft.title,
                  placeholder: COPY.titlePlaceholder,
                  onChange: (event) => patchDraft({ title: event.target.value }),
                  'aria-label': COPY.titlePlaceholder,
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `mst-btn mst-iconbtn${draft.pinned ? ' mst-chip-on' : ''}`,
                    title: draft.pinned ? COPY.unpin : COPY.pin,
                    onClick: () => patchDraft({ pinned: !draft.pinned }),
                  },
                  Icon.pin(),
                ),
              ),
              h(
                'div',
                { className: 'mst-fieldrow' },
                h(
                  'label',
                  { className: 'mst-field' },
                  COPY.filterKind,
                  h(
                    'select',
                    {
                      className: 'mst-select',
                      value: draft.kind,
                      onChange: (event) => patchDraft({ kind: event.target.value }),
                    },
                    KINDS.map((entry) => h('option', { key: entry.id, value: entry.id }, zh ? entry.zh : entry.en)),
                  ),
                ),
                h(
                  'label',
                  { className: 'mst-field' },
                  COPY.importance,
                  h(
                    'span',
                    { className: 'mst-stars' },
                    [1, 2, 3, 4, 5].map((level) =>
                      h(
                        'button',
                        {
                          key: level,
                          type: 'button',
                          className: 'mst-star',
                          'data-on': draft.importance >= level ? '1' : '0',
                          title: String(level),
                          onClick: () => patchDraft({ importance: level }),
                        },
                        '★',
                      ),
                    ),
                  ),
                ),
                h(
                  'label',
                  { className: 'mst-field' },
                  h(
                    'select',
                    {
                      className: 'mst-select',
                      value: draft.scope,
                      onChange: (event) => patchDraft({ scope: event.target.value }),
                    },
                    h('option', { value: 'global' }, zh ? '全局' : 'Global'),
                    h('option', { value: 'workspace' }, zh ? '本工作区' : 'Workspace'),
                  ),
                ),
                h('input', {
                  className: 'mst-tags-input',
                  value: draft.tags,
                  placeholder: COPY.tagsPlaceholder,
                  onChange: (event) => patchDraft({ tags: event.target.value }),
                  'aria-label': COPY.tagsPlaceholder,
                }),
              ),
              h('textarea', {
                className: 'mst-textarea',
                value: draft.content,
                placeholder: COPY.contentPlaceholder,
                onChange: (event) => patchDraft({ content: event.target.value }),
                'aria-label': COPY.contentPlaceholder,
              }),
              draft.id !== null && draft.origin?.sessionId
                ? h(
                    'div',
                    { className: 'mst-source' },
                    h(
                      'div',
                      { className: 'mst-source-head' },
                      h('span', { className: 'mst-source-tag' }, MORE.origin),
                      h(
                        'code',
                        { className: 'mst-source-id', title: draft.origin.sessionId },
                        String(draft.origin.sessionId).replace(/^session-/, '').slice(0, 8),
                      ),
                      draft.origin.turn
                        ? h('span', { className: 'mst-source-turn' }, `turn ${draft.origin.turn}`)
                        : null,
                    ),
                    draft.origin.quote
                      ? h('p', { className: 'mst-source-quote' }, `“${snippet(draft.origin.quote, 180)}”`)
                      : null,
                    (() => {
                      const siblings = items.filter(
                        (other) =>
                          other.id !== draft.id && other.origin?.sessionId === draft.origin.sessionId,
                      )
                      if (siblings.length === 0) return null
                      return h(
                        'div',
                        { className: 'mst-source-siblings' },
                        h('span', { className: 'mst-source-label' }, `${MORE.sameSession} · ${siblings.length + 1}`),
                        siblings.map((other) =>
                          h(
                            'button',
                            {
                              key: other.id,
                              type: 'button',
                              className: 'mst-chip',
                              title: other.title,
                              onClick: () => pick(other),
                            },
                            other.title,
                          ),
                        ),
                      )
                    })(),
                  )
                : null,
              h(
                'div',
                { className: 'mst-detail-foot' },
                h(
                  'span',
                  { className: 'mst-meta' },
                  draft.id === null
                    ? COPY.newTitle
                    : [
                        `${COPY.updated} ${relTime(draft.updatedAt)}`,
                        `${draft.content.length} ${COPY.chars}`,
                        draft.hits > 0 ? `${COPY.hits} ${draft.hits} ${COPY.times}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · '),
                ),
                dirty ? h('span', { className: 'mst-meta', style: { color: '#f59e0b' } }, `● ${COPY.dirty}`) : null,
                h(
                  'div',
                  { className: 'mst-actions' },
                  draft.id !== null
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: `mst-btn${confirmDelete ? ' mst-btn-danger' : ''}`,
                          onClick: remove,
                          disabled: busy,
                        },
                        Icon.trash(),
                        confirmDelete ? COPY.deleteConfirm : COPY.delete,
                      )
                    : null,
                  draft.id !== null
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'mst-btn',
                          onClick: () => patchDraft({ archived: !draft.archived }),
                        },
                        draft.archived ? COPY.unarchive : COPY.archive,
                      )
                    : null,
                  h('button', { type: 'button', className: 'mst-btn', onClick: startNew, disabled: busy }, COPY.cancel),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'mst-btn mst-btn-primary',
                      onClick: save,
                      disabled: busy || !dirty || (draft.title.trim() === '' && draft.content.trim() === ''),
                    },
                    Icon.save(),
                    busy ? COPY.saving : COPY.save,
                  ),
                ),
              ),
              state?.storeFile
                ? h('div', { className: 'mst-hint' }, `${COPY.importHint} · ${COPY.storeAt}: ${state.storeFile}`)
                : h('div', { className: 'mst-hint' }, COPY.importHint),
            )

      return h(
        'div',
        { className: 'mst-root' },
        header,
        error !== ''
          ? h(
              'div',
              { className: 'mst-banner' },
              `${COPY.loadFailed}: ${error}`,
              h(
                'button',
                { type: 'button', className: 'mst-btn', style: { marginLeft: 'auto' }, onClick: load },
                COPY.retry,
              ),
            )
          : null,
        statRow,
        loading && state === null
          ? h('div', { className: 'mst-loading' }, '…')
          : h(
              'div',
              { className: 'mst-body' },
              h('div', { className: 'mst-col' }, filters, list),
              detail,
            ),
        toast !== '' ? h('div', { className: 'mst-toast' }, toast) : null,
      )
    }

    // ---------------------------------------------------------------- profile

    function ProfileView() {
      const [data, setData] = useState(null)
      const [settings, setSettings] = useState(null)
      const [error, setError] = useState('')
      const [identity, setIdentity] = useState({ name: '', role: '', location: '', language: '' })
      const [category, setCategory] = useState('identity')
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const [flash, setFlash] = useState('')
      const [report, setReport] = useState(null)
      const [layout, setLayout] = useState('cards')
      const [tree, setTree] = useState(null)
      const [treeError, setTreeError] = useState('')
      const [open, setOpen] = useState(() => new Set())
      const [focusFacet, setFocusFacet] = useState('')
      const flashTimer = useRef(0)

      const notify = (message) => {
        setFlash(message)
        clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlash(''), 1800)
      }
      useEffect(() => () => clearTimeout(flashTimer.current), [])

      const load = useCallback(async () => {
        try {
          const next = await api('/profile')
          setData(next)
          const base = next.profile?.identity ?? {}
          setIdentity({
            name: base.name ?? '',
            role: base.role ?? '',
            location: base.location ?? '',
            language: base.language ?? '',
          })
          setError('')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      useEffect(() => {
        let alive = true
        api('/settings')
          .then((next) => {
            if (alive) setSettings(next.settings ?? null)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        if (layout !== 'tree') return undefined
        let alive = true
        setTreeError('')
        api('/profile/tree')
          .then((body) => {
            if (!alive) return
            setTree(body)
            setOpen(new Set((body?.children ?? []).map((node) => node.id)))
          })
          .catch((cause) => {
            if (alive) setTreeError(String(cause?.message ?? cause))
          })
        return () => {
          alive = false
        }
      }, [layout, data])

      const toggle = (id) => {
        setOpen((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const openFacet = (node) => {
        setLayout('cards')
        setFocusFacet(node?.facet?.id ?? node?.id ?? '')
        setTimeout(() => setFocusFacet(''), 4000)
      }

      const renderNode = treeRenderer({ open, toggle, onLeaf: openFacet })

      const patchSettings = async (patch) => {
        setSettings((current) => ({ ...(current ?? {}), ...patch }))
        try {
          const next = await api('/settings', { method: 'POST', body: JSON.stringify(patch) })
          setSettings(next.settings ?? null)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }

      const saveIdentity = async () => {
        setBusy(true)
        try {
          await api('/profile/identity', { method: 'POST', body: JSON.stringify(identity) })
          await load()
          notify(COPY.saved)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      const addFacet = async () => {
        const value = text.trim()
        if (value === '') return
        setBusy(true)
        try {
          await api('/profile/facets', { method: 'POST', body: JSON.stringify({ category, text: value }) })
          setText('')
          await load()
          notify(COPY.saved)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      const removeFacet = async (id) => {
        try {
          await api('/profile/facets/delete', { method: 'POST', body: JSON.stringify({ id }) })
          await load()
          notify(COPY.deleted)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }

      const captureNow = async () => {
        setBusy(true)
        try {
          const next = await api('/capture', { method: 'POST', body: '{}' })
          const latest = next.report ?? (next.reports ?? [])[0] ?? null
          setReport(latest)
          notify(latest ? MORE.report(latest) : COPY.saved)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy(false)
        }
      }

      const field = (key, label) =>
        h(
          'label',
          {
            key,
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '4px',
              fontSize: '11px',
              color: 'var(--dsw-alias-label-secondary)',
            },
          },
          h('span', null, label),
          h('input', {
            className: 'mst-input',
            value: identity[key] ?? '',
            onChange: (event) => setIdentity((current) => ({ ...current, [key]: event.target.value })),
          }),
        )

      const facets = data?.profile?.facets ?? []
      const groups = CATEGORIES.map((entry) => ({
        ...entry,
        rows: facets.filter((facet) => facet.category === entry.id),
      })).filter((group) => group.rows.length > 0)
      const current = settings ?? {}

      return h(
        'div',
        { className: 'mst-root' },
        h(
          'div',
          { className: 'mst-toolbar' },
          h(
            'div',
            { className: 'mst-brand' },
            h('span', { className: 'mst-title' }, MORE.profileTitle),
            h('span', { className: 'mst-sub' }, MORE.profileSub),
          ),
          h('span', { className: 'mst-spacer' }),
          h(
            'div',
            { className: 'mst-row', style: { gap: '4px' } },
            h(
              'button',
              {
                type: 'button',
                className: 'mst-chip',
                'data-on': layout === 'cards' ? '1' : '0',
                onClick: () => setLayout('cards'),
              },
              MORE.profileCards,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mst-chip',
                'data-on': layout === 'tree' ? '1' : '0',
                onClick: () => setLayout('tree'),
              },
              MORE.profileTree,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mst-chip',
                'data-on': layout === 'graph' ? '1' : '0',
                onClick: () => setLayout('graph'),
              },
              MORE.profileGraph,
            ),
          ),
          h('button', { type: 'button', className: 'mst-btn', onClick: load }, COPY.refresh),
        ),
        error !== ''
          ? h('div', { className: 'mst-toolbar' }, h('div', { className: 'mst-banner', style: { flex: '1 1 100%' } }, error))
          : null,
        layout === 'tree'
          ? h(
              'div',
              { className: 'mst-tree-view' },
              h(
                'div',
                { className: 'mst-tree-head' },
                h('span', { className: 'mst-tree-total' }, `${tree?.count ?? facets.length} ${COPY.chars === 'chars' ? 'facets' : '条'}`),
              ),
              treeError !== ''
                ? h('div', { className: 'mst-banner' }, treeError)
                : (tree?.children ?? []).length === 0
                  ? h(EmptyState, { tone: Icon.brain(28), title: MORE.treeEmpty, hint: COPY.emptyListHint })
                  : h('div', { className: 'mst-tree' }, (tree?.children ?? []).map(renderNode)),
            )
          : null,
        layout === 'graph' ? h(ProfileGraph, { onOpen: openFacet }) : null,
        h(
          'div',
          { className: 'mst-cards', style: layout !== 'cards' ? { display: 'none' } : undefined },
          h(
            'div',
            { className: 'mst-card' },
            h('h4', null, MORE.summary),
            h('pre', { className: 'mst-summary' }, data?.summary || MORE.summaryEmpty),
          ),
          h(
            'div',
            { className: 'mst-card' },
            h('h4', null, MORE.identity),
            h(
              'div',
              { className: 'mst-grid' },
              field('name', MORE.name),
              field('role', MORE.role),
              field('location', MORE.location),
              field('language', MORE.language),
            ),
            h(
              'div',
              { className: 'mst-row' },
              h('button', { type: 'button', className: 'mst-btn mst-btn-primary', disabled: busy, onClick: saveIdentity }, MORE.saveIdentity),
            ),
          ),
          h(
            'div',
            { className: 'mst-card' },
            h('h4', null, MORE.addFacet),
            h(
              'div',
              { className: 'mst-row' },
              h(
                'select',
                { className: 'mst-select', value: category, onChange: (event) => setCategory(event.target.value) },
                CATEGORIES.map((entry) => h('option', { key: entry.id, value: entry.id }, categoryLabel(entry.id))),
              ),
              h('input', {
                className: 'mst-input',
                style: { flex: '1 1 220px', width: 'auto' },
                value: text,
                placeholder: MORE.facetText,
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') addFacet()
                },
              }),
              h(
                'button',
                { type: 'button', className: 'mst-btn', disabled: busy || text.trim() === '', onClick: addFacet },
                MORE.addFacet,
              ),
            ),
            groups.length === 0
              ? h('span', { className: 'mst-hint' }, MORE.summaryEmpty)
              : groups.map((group) =>
                  h(
                    'div',
                    { key: group.id, className: 'mst-col', style: { gap: '5px' } },
                    h(
                      'div',
                      { className: 'mst-row' },
                      h('span', { className: 'mst-kind', style: { '--mst-tone': group.tone } }, categoryLabel(group.id)),
                      h('span', { className: 'mst-hint' }, String(group.rows.length)),
                    ),
                    group.rows.map((facet) =>
                      h(
                        'div',
                        { key: facet.id, className: 'mst-facet', 'data-focus': focusFacet === facet.id ? '1' : '0' },
                        h('p', null, facet.text),
                        h('button', { type: 'button', className: 'mst-x', title: MORE.remove, onClick: () => removeFacet(facet.id) }, '×'),
                      ),
                    ),
                  ),
                ),
          ),
          h(
            'div',
            { className: 'mst-card' },
            h('h4', null, MORE.captureTitle),
            h(
              'label',
              { className: 'mst-switch' },
              h('input', {
                type: 'checkbox',
                checked: current.enabled !== false,
                onChange: (event) => patchSettings({ enabled: event.target.checked }),
              }),
              MORE.captureEnabled,
            ),
            h('p', { className: 'mst-hint' }, MORE.capturePull),
            h(
              'label',
              { className: 'mst-switch' },
              h('input', {
                type: 'checkbox',
                checked: current.autoSave !== false,
                onChange: (event) => patchSettings({ autoSave: event.target.checked }),
              }),
              MORE.captureAuto,
            ),
            h(
              'div',
              { className: 'mst-row' },
              h('span', { className: 'mst-hint' }, MORE.debounce),
              h('input', {
                className: 'mst-input',
                style: { width: '84px', flex: 'none' },
                type: 'number',
                min: 1,
                max: 120,
                value: Math.round(Number(current.debounceMs ?? 8000) / 1000),
                onChange: (event) =>
                  patchSettings({ debounceMs: Math.max(1, Math.min(120, Number(event.target.value) || 8)) * 1000 }),
              }),
              h('button', { type: 'button', className: 'mst-btn', disabled: busy, onClick: captureNow }, MORE.flush),
            ),
            report ? h('span', { className: 'mst-hint' }, MORE.lastReport + ' · ' + MORE.report(report)) : null,
          ),
        ),
        flash !== '' ? h('div', { className: 'mst-toast' }, flash) : null,
      )
    }

    // ------------------------------------------------------------------ graph

    /**
     * The force layout, with no opinion about what a node means.
     *
     * Both graphs (memories and the profile) want the same physics, panning,
     * zooming and hit-testing; only the colour, the radius and the label
     * differ, so those come in as props.
     */
    function ForceCanvas({ nodes, edges, toneOf, radiusOf, labelOf, selectedId, onSelect }) {
      const canvasRef = useRef(null)
      const simRef = useRef(null)
      const frameRef = useRef(0)
      const selectedRef = useRef(null)
      selectedRef.current = selectedId

      useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || nodes.length === 0) return undefined
        const sim = {
          nodes: nodes.map((node, index) => ({
            ...node,
            x: Math.cos((index / Math.max(1, nodes.length)) * Math.PI * 2) * 90 + (Math.random() - 0.5) * 14,
            y: Math.sin((index / Math.max(1, nodes.length)) * Math.PI * 2) * 90 + (Math.random() - 0.5) * 14,
            vx: 0,
            vy: 0,
          })),
          edges: edges.map((edge) => ({ ...edge })),
          alpha: 1,
          scale: 1,
          tx: 0,
          ty: 0,
          drag: null,
          pan: null,
          moved: false,
          draw: null,
          reheat: null,
        }
        simRef.current = sim
        const byId = new Map(sim.nodes.map((node) => [node.id, node]))

        const localPoint = (event) => {
          const rect = canvas.getBoundingClientRect()
          return {
            x: (event.clientX - rect.left - rect.width / 2 - sim.tx) / sim.scale,
            y: (event.clientY - rect.top - rect.height / 2 - sim.ty) / sim.scale,
          }
        }

        const draw = () => {
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          const rect = canvas.getBoundingClientRect()
          const dpr = window.devicePixelRatio || 1
          if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
            canvas.width = Math.round(rect.width * dpr)
            canvas.height = Math.round(rect.height * dpr)
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, rect.width, rect.height)
          ctx.save()
          ctx.translate(rect.width / 2 + sim.tx, rect.height / 2 + sim.ty)
          ctx.scale(sim.scale, sim.scale)
          const active = selectedRef.current
          for (const edge of sim.edges) {
            const from = byId.get(edge.source)
            const to = byId.get(edge.target)
            if (!from || !to) continue
            const strong = active === from.id || active === to.id
            ctx.strokeStyle = strong ? 'rgba(77,107,254,0.72)' : 'rgba(128,140,170,0.26)'
            ctx.lineWidth = strong ? 1.6 : 0.9
            ctx.beginPath()
            ctx.moveTo(from.x, from.y)
            ctx.lineTo(to.x, to.y)
            ctx.stroke()
          }
          for (const node of sim.nodes) {
            const radius = radiusOf(node)
            ctx.beginPath()
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
            ctx.fillStyle = toneOf(node)
            ctx.globalAlpha = node.archived ? 0.35 : 0.92
            ctx.fill()
            ctx.globalAlpha = 1
            if (node.pinned) {
              ctx.beginPath()
              ctx.arc(node.x, node.y, radius + 2.8, 0, Math.PI * 2)
              ctx.strokeStyle = 'rgba(255,255,255,0.55)'
              ctx.lineWidth = 1.2
              ctx.stroke()
            }
            if (active === node.id) {
              ctx.beginPath()
              ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2)
              ctx.strokeStyle = '#4d6bfe'
              ctx.lineWidth = 2
              ctx.stroke()
            }
            if (sim.scale >= 0.85 || active === node.id || (Number(node.degree) || 0) >= 3) {
              ctx.fillStyle = 'rgba(140,150,175,0.95)'
              ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
              ctx.textAlign = 'center'
              ctx.fillText(labelOf(node), node.x, node.y + radius + 12)
            }
          }
          ctx.restore()
        }

        const step = () => {
          const count = sim.nodes.length
          const stride = count > 220 ? Math.ceil(count / 220) : 1
          for (let index = 0; index < count; index += 1) {
            const a = sim.nodes[index]
            for (let other = index + 1; other < count; other += stride) {
              const b = sim.nodes[other]
              let dx = a.x - b.x
              let dy = a.y - b.y
              let distance2 = dx * dx + dy * dy
              if (distance2 < 1) {
                dx = Math.random() - 0.5
                dy = Math.random() - 0.5
                distance2 = 1
              }
              const distance = Math.sqrt(distance2)
              const force = 900 / distance2
              const fx = (dx / distance) * force
              const fy = (dy / distance) * force
              a.vx += fx
              a.vy += fy
              b.vx -= fx
              b.vy -= fy
            }
          }
          for (const edge of sim.edges) {
            const from = byId.get(edge.source)
            const to = byId.get(edge.target)
            if (!from || !to) continue
            const dx = to.x - from.x
            const dy = to.y - from.y
            const distance = Math.sqrt(dx * dx + dy * dy) || 1
            const relation = edge.types?.[0] ?? edge.type
            const force = ((distance - 92) / distance) * 0.012 * (relation === 'link' ? 1.8 : 1)
            from.vx += dx * force
            from.vy += dy * force
            to.vx -= dx * force
            to.vy -= dy * force
          }
          for (const node of sim.nodes) {
            if (sim.drag && sim.drag.id === node.id) {
              node.vx = 0
              node.vy = 0
              continue
            }
            node.vx -= node.x * 0.0016
            node.vy -= node.y * 0.0016
            node.vx *= 0.86
            node.vy *= 0.86
            node.x += Math.max(-24, Math.min(24, node.vx))
            node.y += Math.max(-24, Math.min(24, node.vy))
          }
          sim.alpha *= 0.984
        }

        const animate = () => {
          step()
          draw()
          if (sim.alpha > 0.015) frameRef.current = requestAnimationFrame(animate)
          else frameRef.current = 0
        }
        const reheat = () => {
          sim.alpha = Math.max(sim.alpha, 0.45)
          if (!frameRef.current) frameRef.current = requestAnimationFrame(animate)
        }

        const nearest = (point) => {
          const radius = 10 / sim.scale
          let found = null
          for (const node of sim.nodes) {
            const dx = node.x - point.x
            const dy = node.y - point.y
            if (dx * dx + dy * dy <= radius * radius) {
              found = node
              break
            }
          }
          return found
        }

        const onDown = (event) => {
          canvas.setPointerCapture?.(event.pointerId)
          const point = localPoint(event)
          const hit = nearest(point)
          sim.moved = false
          if (hit) {
            sim.drag = { id: hit.id, dx: point.x - hit.x, dy: point.y - hit.y }
            canvas.style.cursor = 'grabbing'
          } else {
            sim.pan = { x: event.clientX, y: event.clientY, tx: sim.tx, ty: sim.ty }
          }
        }

        const onMove = (event) => {
          if (sim.drag) {
            const point = localPoint(event)
            const node = byId.get(sim.drag.id)
            if (node) {
              node.x = point.x - sim.drag.dx
              node.y = point.y - sim.drag.dy
            }
            sim.moved = true
            reheat()
            return
          }
          if (sim.pan) {
            sim.tx = sim.pan.tx + (event.clientX - sim.pan.x)
            sim.ty = sim.pan.ty + (event.clientY - sim.pan.y)
            sim.moved = true
            draw()
            return
          }
          canvas.style.cursor = nearest(localPoint(event)) ? 'pointer' : 'grab'
        }

        const onUp = (event) => {
          if (!sim.moved) {
            const hit = nearest(localPoint(event))
            onSelect(hit ? hit.id : null)
          }
          sim.drag = null
          sim.pan = null
          sim.moved = false
          canvas.style.cursor = 'grab'
        }

        const onWheel = (event) => {
          event.preventDefault()
          const rect = canvas.getBoundingClientRect()
          const mx = event.clientX - rect.left - rect.width / 2 - sim.tx
          const my = event.clientY - rect.top - rect.height / 2 - sim.ty
          const next = Math.max(0.35, Math.min(2.6, sim.scale * Math.exp(-event.deltaY * 0.0012)))
          sim.tx -= mx * (next / sim.scale - 1)
          sim.ty -= my * (next / sim.scale - 1)
          sim.scale = next
          draw()
        }

        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onUp)
        canvas.addEventListener('wheel', onWheel, { passive: false })
        sim.draw = draw
        sim.reheat = reheat
        draw()
        reheat()

        return () => {
          cancelAnimationFrame(frameRef.current)
          frameRef.current = 0
          canvas.removeEventListener('pointerdown', onDown)
          canvas.removeEventListener('pointermove', onMove)
          canvas.removeEventListener('pointerup', onUp)
          canvas.removeEventListener('pointercancel', onUp)
          canvas.removeEventListener('wheel', onWheel)
          simRef.current = null
        }
        // The callbacks are re-created every render on purpose; identity of the
        // data is what should restart the simulation.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [nodes, edges])

      useEffect(() => {
        simRef.current?.draw?.()
      }, [selectedId])

      return h('div', { className: 'mst-canvas-wrap' }, h('canvas', { ref: canvasRef }))
    }

    /** The profile, drawn: facets as points, related by tag, wording, category. */
    function ProfileGraph({ onOpen }) {
      const [graph, setGraph] = useState(null)
      const [error, setError] = useState('')
      const [selectedId, setSelectedId] = useState(null)

      const load = useCallback(async () => {
        try {
          setGraph(await api('/profile/graph'))
          setError('')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const nodes = graph?.nodes ?? []
      const edges = useMemo(() => {
        const ids = new Set(nodes.map((node) => node.id))
        return (graph?.edges ?? []).filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      }, [graph, nodes])

      const selected = nodes.find((node) => node.id === selectedId) ?? null
      const related = useMemo(() => {
        if (!selected || !graph) return []
        const index = new Map(nodes.map((node) => [node.id, node]))
        return (graph?.edges ?? [])
          .filter((edge) => edge.source === selected.id || edge.target === selected.id)
          .map((edge) => ({ edge, node: index.get(edge.source === selected.id ? edge.target : edge.source) }))
          .filter((row) => Boolean(row.node))
          .slice(0, 24)
      }, [graph, selected, nodes])
      const stats = graph?.stats ?? { nodes: 0, edges: 0, isolated: 0, byCategory: {} }

      return h(
        'div',
        { className: 'mst-section' },
        error !== '' ? h('div', { className: 'mst-banner' }, error) : null,
        h(
          'div',
          { className: 'mst-toolbar' },
          h(
            'div',
            { className: 'mst-brand' },
            h('span', { className: 'mst-title', style: { fontSize: '13px' } }, MORE.profileGraphTitle),
            h('span', { className: 'mst-sub' }, MORE.profileGraphSub),
          ),
          h('span', { className: 'mst-spacer' }),
          h('span', { className: 'mst-chip mst-chip-static' }, MORE.nodes, h('b', null, String(stats.nodes))),
          h('span', { className: 'mst-chip mst-chip-static' }, MORE.edges, h('b', null, String(stats.edges))),
          h('span', { className: 'mst-chip mst-chip-static' }, MORE.isolated, h('b', null, String(stats.isolated))),
          h('button', { type: 'button', className: 'mst-btn', onClick: load }, COPY.refresh),
        ),
        h(
          'div',
          { className: 'mst-legend' },
          CATEGORIES.map((entry) =>
            h(
              'span',
              { key: entry.id, className: 'mst-chip mst-chip-static' },
              h('i', { className: 'mst-swatch', style: { background: entry.tone } }),
              categoryLabel(entry.id),
              h('b', null, String(stats.byCategory?.[entry.id] ?? 0)),
            ),
          ),
        ),
        nodes.length < 2
          ? h(EmptyState, {
              tone: '#a855f7',
              title: MORE.profileGraphEmpty,
              hint: MORE.profileGraphSub,
            })
          : h(
              'div',
              { className: 'mst-graph-body' },
              h(ForceCanvas, {
                nodes,
                edges,
                toneOf: (node) => categoryTone(node.category),
                radiusOf: (node) => 5 + (Number(node.confidence) || 0.5) * 5,
                labelOf: (node) => snippet(node.title, 18),
                selectedId,
                onSelect: setSelectedId,
              }),
              selected
                ? h(
                    'div',
                    { className: 'mst-drawer' },
                    h(
                      'div',
                      { className: 'mst-row' },
                      h(
                        'span',
                        { className: 'mst-kind', style: { '--mst-tone': categoryTone(selected.category) } },
                        categoryLabel(selected.category),
                      ),
                      h('b', { style: { marginLeft: 'auto', fontSize: '10.5px' } }, Math.round((selected.confidence || 0) * 100) + '%'),
                    ),
                    h('strong', { style: { fontSize: '12.5px' } }, selected.title),
                    h('span', { className: 'mst-hint' }, (selected.tags ?? []).map((tag) => '#' + tag).join(' ')),
                    h('h4', { style: { margin: '6px 0 0', fontSize: '11.5px' } }, MORE.related),
                    related.length === 0
                      ? h('span', { className: 'mst-hint' }, MORE.relatedEmpty)
                      : related.map((row) =>
                          h(
                            'div',
                            { key: row.edge.source + '>' + row.edge.target, className: 'mst-row', style: { gap: '6px' } },
                            h('span', { className: 'mst-swatch', style: { background: categoryTone(row.node.category), flex: 'none' } }),
                            h(
                              'span',
                              {
                                style: {
                                  fontSize: '11.5px',
                                  flex: '1 1 auto',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                              },
                              row.node.title,
                            ),
                            h(
                              'span',
                              { className: 'mst-badge' },
                              (() => {
                                const relation = row.edge.types?.[0] ?? row.edge.type
                                return MORE.linkType?.[relation] ?? relation
                              })(),
                            ),
                          ),
                        ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mst-btn',
                        style: { marginTop: '6px', width: '100%' },
                        onClick: () => onOpen?.(selected),
                      },
                      MORE.facetOpen,
                    ),
                  )
                : null,
            ),
      )
    }

    function GraphView() {
      const [graph, setGraph] = useState(null)
      const [error, setError] = useState('')
      const [kind, setKind] = useState('all')
      const [selectedId, setSelectedId] = useState(null)
      const canvasRef = useRef(null)
      const simRef = useRef(null)
      const frameRef = useRef(0)
      const selectedRef = useRef(null)
      selectedRef.current = selectedId

      const load = useCallback(async () => {
        try {
          setGraph(await api('/graph'))
          setError('')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const nodes = useMemo(() => (graph?.nodes ?? []).filter((node) => kind === 'all' || node.kind === kind), [graph, kind])
      const edges = useMemo(() => {
        const ids = new Set(nodes.map((node) => node.id))
        return (graph?.edges ?? []).filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      }, [graph, nodes])

      useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || nodes.length === 0) return undefined
        const sim = {
          nodes: nodes.map((node, index) => ({
            ...node,
            x: Math.cos((index / Math.max(1, nodes.length)) * Math.PI * 2) * 90 + (Math.random() - 0.5) * 14,
            y: Math.sin((index / Math.max(1, nodes.length)) * Math.PI * 2) * 90 + (Math.random() - 0.5) * 14,
            vx: 0,
            vy: 0,
          })),
          edges: edges.map((edge) => ({ ...edge })),
          alpha: 1,
          scale: 1,
          tx: 0,
          ty: 0,
          drag: null,
          pan: null,
          moved: false,
          draw: null,
          reheat: null,
        }
        simRef.current = sim
        const byId = new Map(sim.nodes.map((node) => [node.id, node]))

        const localPoint = (event) => {
          const rect = canvas.getBoundingClientRect()
          return {
            x: (event.clientX - rect.left - rect.width / 2 - sim.tx) / sim.scale,
            y: (event.clientY - rect.top - rect.height / 2 - sim.ty) / sim.scale,
            rect,
          }
        }

        const draw = () => {
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          const rect = canvas.getBoundingClientRect()
          const dpr = window.devicePixelRatio || 1
          if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
            canvas.width = Math.round(rect.width * dpr)
            canvas.height = Math.round(rect.height * dpr)
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.clearRect(0, 0, rect.width, rect.height)
          ctx.save()
          ctx.translate(rect.width / 2 + sim.tx, rect.height / 2 + sim.ty)
          ctx.scale(sim.scale, sim.scale)
          const active = selectedRef.current
          for (const edge of sim.edges) {
            const from = byId.get(edge.source)
            const to = byId.get(edge.target)
            if (!from || !to) continue
            const strong = active === from.id || active === to.id
            ctx.strokeStyle = strong ? 'rgba(77,107,254,0.72)' : 'rgba(128,140,170,0.26)'
            ctx.lineWidth = strong ? 1.6 : 0.9
            ctx.beginPath()
            ctx.moveTo(from.x, from.y)
            ctx.lineTo(to.x, to.y)
            ctx.stroke()
          }
          for (const node of sim.nodes) {
            const radius = 4 + Math.min(5, Number(node.importance) || 3) * 1.15
            ctx.beginPath()
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
            ctx.fillStyle = kindTone(node.kind)
            ctx.globalAlpha = node.archived ? 0.35 : 0.92
            ctx.fill()
            ctx.globalAlpha = 1
            if (node.pinned) {
              ctx.beginPath()
              ctx.arc(node.x, node.y, radius + 2.8, 0, Math.PI * 2)
              ctx.strokeStyle = 'rgba(255,255,255,0.55)'
              ctx.lineWidth = 1.2
              ctx.stroke()
            }
            if (active === node.id) {
              ctx.beginPath()
              ctx.arc(node.x, node.y, radius + 5, 0, Math.PI * 2)
              ctx.strokeStyle = '#4d6bfe'
              ctx.lineWidth = 2
              ctx.stroke()
            }
            if (sim.scale >= 0.85 || active === node.id || (Number(node.degree) || 0) >= 3) {
              ctx.fillStyle = 'rgba(140,150,175,0.95)'
              ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
              ctx.textAlign = 'center'
              ctx.fillText(snippet(node.title, 18), node.x, node.y + radius + 12)
            }
          }
          ctx.restore()
        }

        const step = () => {
          const count = sim.nodes.length
          const stride = count > 220 ? Math.ceil(count / 220) : 1
          for (let index = 0; index < count; index += 1) {
            const a = sim.nodes[index]
            for (let other = index + 1; other < count; other += stride) {
              const b = sim.nodes[other]
              let dx = a.x - b.x
              let dy = a.y - b.y
              let distance2 = dx * dx + dy * dy
              if (distance2 < 1) {
                dx = Math.random() - 0.5
                dy = Math.random() - 0.5
                distance2 = 1
              }
              const distance = Math.sqrt(distance2)
              const force = 900 / distance2
              const fx = (dx / distance) * force
              const fy = (dy / distance) * force
              a.vx += fx
              a.vy += fy
              b.vx -= fx
              b.vy -= fy
            }
          }
          for (const edge of sim.edges) {
            const from = byId.get(edge.source)
            const to = byId.get(edge.target)
            if (!from || !to) continue
            const dx = to.x - from.x
            const dy = to.y - from.y
            const distance = Math.sqrt(dx * dx + dy * dy) || 1
            const relation = edge.types?.[0] ?? edge.type
            const force = ((distance - 92) / distance) * 0.012 * (relation === 'link' ? 1.8 : 1)
            from.vx += dx * force
            from.vy += dy * force
            to.vx -= dx * force
            to.vy -= dy * force
          }
          for (const node of sim.nodes) {
            if (sim.drag && sim.drag.id === node.id) {
              node.vx = 0
              node.vy = 0
              continue
            }
            node.vx -= node.x * 0.0016
            node.vy -= node.y * 0.0016
            node.vx *= 0.86
            node.vy *= 0.86
            node.x += Math.max(-24, Math.min(24, node.vx))
            node.y += Math.max(-24, Math.min(24, node.vy))
          }
          sim.alpha *= 0.984
        }

        const animate = () => {
          step()
          draw()
          if (sim.alpha > 0.015) frameRef.current = requestAnimationFrame(animate)
          else frameRef.current = 0
        }
        const reheat = () => {
          sim.alpha = Math.max(sim.alpha, 0.45)
          if (!frameRef.current) frameRef.current = requestAnimationFrame(animate)
        }

        const nearest = (point) => {
          const radius = 10 / sim.scale
          let found = null
          for (const node of sim.nodes) {
            const dx = node.x - point.x
            const dy = node.y - point.y
            if (dx * dx + dy * dy <= radius * radius) {
              found = node
              break
            }
          }
          return found
        }

        const onDown = (event) => {
          canvas.setPointerCapture?.(event.pointerId)
          const point = localPoint(event)
          const hit = nearest(point)
          sim.moved = false
          if (hit) {
            sim.drag = { id: hit.id, dx: point.x - hit.x, dy: point.y - hit.y }
            canvas.style.cursor = 'grabbing'
          } else {
            sim.pan = { x: event.clientX, y: event.clientY, tx: sim.tx, ty: sim.ty }
          }
        }

        const onMove = (event) => {
          if (sim.drag) {
            const point = localPoint(event)
            const node = byId.get(sim.drag.id)
            if (node) {
              node.x = point.x - sim.drag.dx
              node.y = point.y - sim.drag.dy
            }
            sim.moved = true
            reheat()
            return
          }
          if (sim.pan) {
            sim.tx = sim.pan.tx + (event.clientX - sim.pan.x)
            sim.ty = sim.pan.ty + (event.clientY - sim.pan.y)
            sim.moved = true
            draw()
            return
          }
          canvas.style.cursor = nearest(localPoint(event)) ? 'pointer' : 'grab'
        }

        const onUp = (event) => {
          if (!sim.moved) {
            const hit = nearest(localPoint(event))
            setSelectedId(hit ? hit.id : null)
          }
          sim.drag = null
          sim.pan = null
          sim.moved = false
          canvas.style.cursor = 'grab'
        }

        const onWheel = (event) => {
          event.preventDefault()
          const rect = canvas.getBoundingClientRect()
          const mx = event.clientX - rect.left - rect.width / 2 - sim.tx
          const my = event.clientY - rect.top - rect.height / 2 - sim.ty
          const next = Math.max(0.35, Math.min(2.6, sim.scale * Math.exp(-event.deltaY * 0.0012)))
          sim.tx -= mx * (next / sim.scale - 1)
          sim.ty -= my * (next / sim.scale - 1)
          sim.scale = next
          draw()
        }

        canvas.addEventListener('pointerdown', onDown)
        canvas.addEventListener('pointermove', onMove)
        canvas.addEventListener('pointerup', onUp)
        canvas.addEventListener('pointercancel', onUp)
        canvas.addEventListener('wheel', onWheel, { passive: false })
        sim.draw = draw
        sim.reheat = reheat
        draw()
        reheat()

        return () => {
          cancelAnimationFrame(frameRef.current)
          frameRef.current = 0
          canvas.removeEventListener('pointerdown', onDown)
          canvas.removeEventListener('pointermove', onMove)
          canvas.removeEventListener('pointerup', onUp)
          canvas.removeEventListener('pointercancel', onUp)
          canvas.removeEventListener('wheel', onWheel)
          simRef.current = null
        }
      }, [nodes, edges])

      useEffect(() => {
        simRef.current?.draw?.()
      }, [selectedId])

      const selected = useMemo(() => (graph?.nodes ?? []).find((node) => node.id === selectedId) ?? null, [graph, selectedId])
      const related = useMemo(() => {
        if (!selected || !graph) return []
        const index = new Map((graph.nodes ?? []).map((node) => [node.id, node]))
        return (graph.edges ?? [])
          .filter((edge) => edge.source === selected.id || edge.target === selected.id)
          .map((edge) => ({ edge, node: index.get(edge.source === selected.id ? edge.target : edge.source) }))
          .filter((row) => Boolean(row.node))
          .slice(0, 24)
      }, [graph, selected])

      const stats = graph?.stats ?? { nodes: 0, edges: 0, isolated: 0, byKind: {} }

      return h(
        'div',
        { className: 'mst-root' },
        h(
          'div',
          { className: 'mst-toolbar' },
          h(
            'div',
            { className: 'mst-brand' },
            h('span', { className: 'mst-title' }, MORE.graphTitle),
            h('span', { className: 'mst-sub' }, MORE.graphSub),
          ),
          h('span', { className: 'mst-spacer' }),
          h('button', { type: 'button', className: 'mst-btn', onClick: load }, COPY.refresh),
        ),
        error !== ''
          ? h('div', { className: 'mst-toolbar' }, h('div', { className: 'mst-banner', style: { flex: '1 1 100%' } }, error))
          : null,
        h(
          'div',
          { className: 'mst-legend' },
          h(
            'button',
            { type: 'button', className: 'mst-chip' + (kind === 'all' ? ' mst-chip-on' : ''), onClick: () => setKind('all') },
            MORE.nodes,
            h('b', null, String(stats.nodes)),
          ),
          h('span', { className: 'mst-chip mst-chip-static' }, MORE.edges, h('b', null, String(stats.edges))),
          h('span', { className: 'mst-chip mst-chip-static' }, MORE.isolated, h('b', null, String(stats.isolated))),
          KINDS.map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                className: 'mst-chip' + (kind === entry.id ? ' mst-chip-on' : ''),
                onClick: () => setKind(entry.id),
              },
              h('i', { className: 'mst-swatch', style: { background: entry.tone } }),
              kindLabel(entry.id),
              h('b', null, String(stats.byKind?.[entry.id] ?? 0)),
            ),
          ),
        ),
        nodes.length === 0
          ? h(EmptyState, { tone: '#4d6bfe', title: MORE.graphEmpty, hint: MORE.graphSub })
          : h(
              'div',
              { className: 'mst-graph-body' },
              h('div', { className: 'mst-canvas-wrap' }, h('canvas', { ref: canvasRef })),
              selected
                ? h(
                    'div',
                    { className: 'mst-drawer' },
                    h(
                      'div',
                      { className: 'mst-row' },
                      h('span', { className: 'mst-kind', style: { '--mst-tone': kindTone(selected.kind) } }, kindLabel(selected.kind)),
                    ),
                    h('strong', { style: { fontSize: '12.5px' } }, selected.title),
                    h('span', { className: 'mst-hint' }, (selected.tags ?? []).map((tag) => '#' + tag).join(' ')),
                    h('h4', { style: { margin: '6px 0 0', fontSize: '11.5px' } }, MORE.related),
                    related.length === 0
                      ? h('span', { className: 'mst-hint' }, MORE.relatedEmpty)
                      : related.map((row) =>
                          h(
                            'div',
                            { key: row.edge.source + '>' + row.edge.target, className: 'mst-row', style: { gap: '6px' } },
                            h('span', { className: 'mst-swatch', style: { background: kindTone(row.node.kind), flex: 'none' } }),
                            h(
                              'span',
                              {
                                style: {
                                  fontSize: '11.5px',
                                  flex: '1 1 auto',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                              },
                              row.node.title,
                            ),
                            h(
                              'span',
                              { className: 'mst-badge' },
                              (() => {
                                const relation = row.edge.types?.[0] ?? row.edge.type
                                return MORE.linkType?.[relation] ?? relation
                              })(),
                            ),
                          ),
                        ),
                  )
                : null,
            ),
      )
    }

    // ------------------------------------------------------------------ inbox

    function InboxView() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')

      const load = useCallback(async () => {
        try {
          setData(await api('/inbox'))
          setError('')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const act = async (path, body, marker) => {
        setBusy(marker)
        try {
          await api(path, { method: 'POST', body: JSON.stringify(body) })
          await load()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy('')
        }
      }

      const items = data?.items ?? []

      return h(
        'div',
        { className: 'mst-root' },
        h(
          'div',
          { className: 'mst-toolbar' },
          h(
            'div',
            { className: 'mst-brand' },
            h('span', { className: 'mst-title' }, MORE.inboxTitle),
            h('span', { className: 'mst-sub' }, MORE.inboxSub),
          ),
          h('span', { className: 'mst-spacer' }),
          h(
            'button',
            { type: 'button', className: 'mst-btn', disabled: busy !== '' || items.length === 0, onClick: () => act('/inbox/accept-all', {}, 'all') },
            MORE.acceptAll,
          ),
          h(
            'button',
            { type: 'button', className: 'mst-btn', disabled: busy !== '' || items.length === 0, onClick: () => act('/inbox/clear', {}, 'clear') },
            MORE.clearAll,
          ),
          h('button', { type: 'button', className: 'mst-btn', onClick: load }, COPY.refresh),
        ),
        error !== ''
          ? h('div', { className: 'mst-toolbar' }, h('div', { className: 'mst-banner', style: { flex: '1 1 100%' } }, error))
          : null,
        items.length === 0
          ? h(EmptyState, { tone: '#4d6bfe', title: MORE.inboxEmpty, hint: MORE.inboxSub })
          : h(
              'div',
              { className: 'mst-inbox-list' },
              items.map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'mst-inbox-row' },
                  h(
                    'div',
                    { className: 'mst-row' },
                    h('span', { className: 'mst-badge' }, item.target === 'profile' ? MORE.targetProfile : MORE.targetMemory),
                    h(
                      'span',
                      { className: 'mst-kind', style: { '--mst-tone': categoryTone(item.category ?? 'identity') } },
                      item.category ? categoryLabel(item.category) : kindLabel(item.kind),
                    ),
                    h('strong', { style: { fontSize: '12px', flex: '1 1 auto', minWidth: '0' } }, item.title),
                    h('span', { className: 'mst-hint' }, Math.round((Number(item.confidence) || 0) * 100) + '%'),
                  ),
                  h('span', { className: 'mst-hint', style: { fontSize: '11.5px' } }, item.content),
                  item.origin?.quote
                    ? h(
                        'span',
                        { className: 'mst-hint', style: { borderLeft: '2px solid var(--dsw-alias-border-l2)', paddingLeft: '7px' } },
                        item.origin.quote,
                      )
                    : null,
                  h('span', {
                    className: 'mst-bar',
                    style: { display: 'block', width: Math.max(4, Math.round((Number(item.confidence) || 0) * 100)) + '%' },
                  }),
                  h(
                    'div',
                    { className: 'mst-row' },
                    h('span', { className: 'mst-hint' }, item.label ?? item.rule ?? ''),
                    h('span', { className: 'mst-spacer' }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'mst-btn mst-btn-primary',
                        disabled: busy !== '',
                        onClick: () => act('/inbox/accept', { id: item.id }, item.id),
                      },
                      MORE.accept,
                    ),
                    h(
                      'button',
                      { type: 'button', className: 'mst-btn', disabled: busy !== '', onClick: () => act('/inbox/dismiss', { id: item.id }, item.id) },
                      MORE.dismiss,
                    ),
                  ),
                ),
              ),
            ),
      )
    }

    // ------------------------------------------------------------------ shell

    /**
     * One renderer for both trees: a memory tree leaf carries `item`, a profile
     * tree leaf carries `facet`, and everything else is grouping.
     */
    function treeRenderer({ open, toggle, onLeaf }) {
      const renderNode = (node) => {
        const payload = node.item ?? node.facet ?? null
        if (payload) {
          const tone = node.item ? kindTone(node.item.kind) : categoryTone(node.facet.category)
          return h(
            'button',
            {
              key: node.id,
              type: 'button',
              className: 'mst-tree-item',
              title: payload.text ?? node.label,
              onClick: () => onLeaf(node),
            },
            h('span', { className: 'mst-tree-dot', style: { '--mst-tone': tone } }),
            h('span', { className: 'mst-tree-label' }, node.label),
          )
        }
        if (!node.children || node.children.length === 0) {
          return h(
            'div',
            { key: node.id, className: 'mst-tree-item', title: node.label },
            h('span', { className: 'mst-tree-label' }, node.label),
          )
        }
        const children = Array.isArray(node.children) ? node.children : []
        const isOpen = open.has(node.id)
        return h(
          'div',
          { key: node.id, className: 'mst-tree-group' },
          h(
            'button',
            {
              type: 'button',
              className: 'mst-tree-row',
              'data-open': isOpen ? '1' : '0',
              onClick: () => toggle(node.id),
            },
            h('span', { className: 'mst-tree-caret' }, children.length > 0 ? (isOpen ? '▾' : '▸') : '·'),
            node.kind
              ? h('span', { className: 'mst-tree-dot', style: { '--mst-tone': kindTone(node.kind) } })
              : node.category
                ? h('span', { className: 'mst-tree-dot', style: { '--mst-tone': categoryTone(node.category) } })
                : null,
            h('span', { className: 'mst-tree-label' }, node.label),
            h('span', { className: 'mst-tree-count' }, String(node.count ?? children.length)),
          ),
          isOpen && children.length > 0
            ? h('div', { className: 'mst-tree-children' }, children.map(renderNode))
            : null,
        )
      }
      return renderNode
    }

    function TreeView({ onOpen }) {
      const [mode, setMode] = useState('topic')
      const [tree, setTree] = useState(null)
      const [open, setOpen] = useState(() => new Set())
      const [error, setError] = useState('')

      useEffect(() => {
        let cancelled = false
        setError('')
        api(`/tree?mode=${mode}`)
          .then((body) => {
            if (cancelled) return
            setTree(body)
            setOpen(new Set((body?.children ?? []).map((node) => node.id)))
          })
          .catch((failure) => {
            if (!cancelled) setError(failure?.message || COPY.loadFailed)
          })
        return () => {
          cancelled = true
        }
      }, [mode])

      const toggle = (id) => {
        setOpen((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const renderNode = treeRenderer({ open, toggle, onLeaf: (node) => onOpen(node.item) })

      const roots = tree?.children ?? []

      return h(
        'div',
        { className: 'mst-tree-view' },
        h(
          'div',
          { className: 'mst-tree-head' },
          h(
            'div',
            { className: 'mst-tree-modes' },
            h(
              'button',
              {
                type: 'button',
                className: 'mst-chip',
                'data-on': mode === 'topic' ? '1' : '0',
                onClick: () => setMode('topic'),
              },
              MORE.treeModeTopic,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mst-chip',
                'data-on': mode === 'session' ? '1' : '0',
                onClick: () => setMode('session'),
              },
              MORE.treeModeSession,
            ),
          ),
          h('span', { className: 'mst-tree-total' }, `${tree?.count ?? 0} ${COPY.chars === 'chars' ? 'items' : '条'}`),
        ),
        error
          ? h('div', { className: 'mst-banner' }, error)
          : roots.length === 0
            ? h(EmptyState, {
                tone: Icon.brain(28),
                title: MORE.treeEmpty,
                hint: COPY.emptyListHint,
              })
            : h('div', { className: 'mst-tree' }, roots.map(renderNode)),
      )
    }

    const SECTIONS = [
      { id: 'memory', label: () => MORE.secMemory },
      { id: 'tree', label: () => MORE.secTree },
      { id: 'profile', label: () => MORE.secProfile },
      { id: 'graph', label: () => MORE.secGraph },
      { id: 'inbox', label: () => MORE.secInbox },
    ]

    function MemoryStudio() {
      const [section, setSection] = useState('memory')
      const [focus, setFocus] = useState(null)
      const openInMemory = (item) => {
        setFocus({ id: item.id, at: Date.now() })
        setSection('memory')
      }
      return h(
        'div',
        { className: 'mst-shell' },
        h(
          'div',
          { className: 'mst-tabs' },
          SECTIONS.map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                className: 'mst-tab',
                'data-on': section === entry.id ? '1' : '0',
                onClick: () => setSection(entry.id),
              },
              entry.label(),
            ),
          ),
        ),
        h(
          'div',
          { className: 'mst-section' },
          section === 'tree'
            ? h(TreeView, { onOpen: openInMemory })
            : section === 'profile'
              ? h(ProfileView)
              : section === 'graph'
                ? h(GraphView)
                : section === 'inbox'
                  ? h(InboxView)
                  : h(MemoryView, { focus }),
        ),
      )
    }

    // ---------------------------------------------------------------- plugin

    injectStyle()

    /** The same shell, hosted as a `main` panel instead of a conversation tab. */
    function PanelPage() {
      return h('div', { className: 'mst-panel' }, h(MemoryStudio, {}))
    }

    return {
      name: 'dsh-memory-studio',
      inject: ['slots'],
      apply(ctx) {
        // A tab beside Chat / Trajectory …
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            {
              name: 'conversation.view',
              id: PANEL_ID,
              order: 30,
              label: () => COPY.tab,
            },
            MemoryStudio,
          ),
        )
        // … and a `main` panel, which is the only destination a sidebar row can
        // open: the row selects the panel whose key matches its own id.
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, PanelPage),
        )
        // … reachable from the left rail.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => COPY.tab },
            (owner = {}) => Icon.brain(owner.size ?? 16),
          ),
        )
      },
      __test: {
        MemoryStudio,
        MemoryView,
        TreeView,
        ProfileView,
        GraphView,
        InboxView,
        parseTags,
        relTime,
        draftFrom,
        blankDraft,
      },
    }
  },
})
