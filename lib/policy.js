/**
 * What is worth remembering, and what is noise.
 *
 * This module is the answer to "does it know what to keep": a small, readable
 * rule table instead of a vibes-based guess. Every candidate carries the rule
 * that produced it and the sentence it came from, so the inbox can show *why*
 * something was proposed, and a rejected sentence can show *why not*.
 *
 * Design rules, in order of precedence:
 *   1. Never remember a question, a confirmation, code, a log line, or the
 *      agent narrating its own process.
 *   2. Prefer the user's own words over the assistant's summary of them.
 *   3. Separate "about the user" (profile facets) from "about the work"
 *      (memories); the two live in different stores by design.
 *   4. Confidence decides the destination: high confidence is saved at turn
 *      end, low confidence waits in the inbox for a human.
 */
import { features, normalizeText, similarity, splitSentences, stripCodeBlocks, toTag, toTitle } from './text.js'

export const PROFILE_CATEGORIES = ['identity', 'work', 'tooling', 'preference', 'constraint', 'goal', 'style']

/** Thresholds: one place to tune the appetite of automatic capture. */
export const THRESHOLDS = {
  autoSaveMemory: 0.8,
  autoSaveProfile: 0.85,
  duplicate: 0.72,
  maxPerTurn: 4,
  maxPerBatch: 12,
}

const CONFIRMATION = /^(?:好|好的|好呀|行|可以|没问题|嗯|哦|对|是的|收到|明白|知道了|谢谢|多谢|辛苦了|ok|okay|sure|yes|yeah|no|nope|thanks|great|perfect)[。.!！~～]?$/i
// The harness injects its own boilerplate into the conversation — runtime
// context, the skill catalog, system reminders. It carries the user role but it
// is not something the user said, so it must never become a memory.
const HARNESS_CONTEXT =
  /^(?:Current\s+(?:working directory|runtime context|DSH|DeepSeek Harness|file policy|session|browser)|Time sampled|Browser time zone|Elapsed since|Approval policy|This snapshot|You are an AI agent|Valid channels|Tools are grouped|The following skills|A skill is a reusable|If the user names a skill|[-*]\s+`[a-z0-9-]+`\s*:|[-*]\s*[:：])/i
const MARKUP = /^</
const ENV_NAME = /\bDSH_[A-Z_]+\b/
// An imperative is a task for this session, not a durable fact about the user —
// unless it is phrased as a standing rule ("以后都…").
const REQUEST = /(?:帮我|帮忙|请你|麻烦你|能不能|能否|可以帮我|给我(?:做|写|加|改|弄)|please (?:help|build|add|make|write))/i
const PERSISTENT = /(?:以后|今后|之后|下次|总是|一直|每次|都)/
const LOG_LINE = /^\s*(?:at\s|Error\b|WARN\b|INFO\b|DEBUG\b|TRACE\b|Traceback\b|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/
const QUESTION_TAIL = /(?:[?？]|(?:吗|么|呢)[。.!！]?)$/
const CODE_SHAPE = /(?:=>|===|!==|\bconst\s|\bfunction\s|\{\s*"|\}\s*;|<\/?[a-z]+>)/i

const ENTITY_TAGS = [
  { tag: 'path', pattern: /[A-Za-z]:\\[^\s]+|\/(?:Users|home|opt|var|etc)\/[^\s]+/ },
  { tag: 'url', pattern: /https?:\/\/[^\s]+/ },
  { tag: 'version', pattern: /\b\d+\.\d+\.\d+\b/ },
  { tag: 'command', pattern: /--[a-z][a-z0-9-]+|\bnpm\s|\bnode\s|\bpwsh\b|\bgit\s/ },
  { tag: 'port', pattern: /localhost:\d+|\bport\s*\d+/i },
]

/**
 * The rule table. `weight` is the base confidence before role and shape
 * adjustments; `target` decides which store receives the result.
 */
export const RULES = [
  {
    id: 'profile.identity',
    label: '关于你是谁',
    target: 'profile',
    category: 'identity',
    kind: 'fact',
    weight: 0.95,
    importance: 5,
    pattern:
      /我(?:是|叫)(?!说|想|问|指|在)|我的(?:名字|职业|工作|岗位|公司|团队|角色)|我(?:目前|现在)(?:在|做|负责|从事)|我(?:在|正)(?:做|开发|写|研究|设计|负责)|\b(?:i am|i'm|my name is|i work|i'm a)\b/i,
  },
  {
    id: 'profile.work',
    label: '关于你的工作',
    target: 'profile',
    category: 'work',
    kind: 'fact',
    weight: 0.85,
    importance: 4,
    pattern: /我(?:们)?(?:的)?(?:项目|产品|团队|客户|业务|系统)(?:是|叫|做|在)|(?:our|my) (?:project|product|team|company) (?:is|does)/i,
  },
  {
    id: 'profile.tooling',
    label: '你的工具与环境',
    target: 'profile',
    category: 'tooling',
    kind: 'fact',
    weight: 0.8,
    importance: 4,
    pattern: /我(?:平时|主要|一般)?(?:用|在用|习惯用)|我的(?:技术栈|开发环境|电脑|机器|系统|配置)|\b(?:i use|i'm on|my stack|my setup)\b/i,
  },
  {
    id: 'profile.preference',
    label: '你的偏好',
    target: 'profile',
    category: 'preference',
    kind: 'preference',
    weight: 0.9,
    importance: 4,
    pattern:
      /我(?:更|比较|最|特别)?(?:喜欢|偏好|习惯|不喜欢|讨厌|希望|想要)|(?:以后|今后|之后|下次)(?:都|请|要|别|不要|一律|直接)|(?:请|务必|千万|一定)(?:要|别|不要)|from now on|i(?:'d| would) (?:prefer|like)|always use|never use/i,
  },
  {
    id: 'profile.constraint',
    label: '你的限制条件',
    target: 'profile',
    category: 'constraint',
    kind: 'fact',
    weight: 0.8,
    importance: 4,
    pattern:
      /(?:不能|不支持|无法|不许|禁止|只能|仅支持|必须支持|离线|不联网|没有网络|不要用|别用)|must (?:not )?support|cannot|offline only|no network/i,
  },
  {
    id: 'profile.goal',
    label: '你的目标',
    target: 'profile',
    category: 'goal',
    kind: 'goal',
    weight: 0.78,
    importance: 4,
    pattern: /我的目标|我想要(?:做|实现|达到|完成)|计划(?:做|实现|上线|发布)|打算(?:做|实现|用)|(?:my|the) goal is/i,
  },
  {
    id: 'decision',
    label: '决定与理由',
    target: 'memory',
    category: '',
    kind: 'decision',
    weight: 0.88,
    importance: 4,
    pattern:
      /(?:决定|定了|就(?:用|选|按|这么)|采用|改成|换成|选择(?:了)?|定为)|(?:而不是|而非|替代|代替)|(?:we|i) (?:decided|chose|will use)/i,
  },
  {
    id: 'todo',
    label: '待办',
    target: 'memory',
    category: '',
    kind: 'todo',
    weight: 0.8,
    importance: 3,
    pattern:
      /(?:待办|todo|下一步|回头|稍后|还需要|需要(?:加|改|做|补|写)|记得(?:要|去)|别忘了)|next step|follow[- ]?up|still need to/i,
  },
  {
    id: 'insight',
    label: '结论与教训',
    target: 'memory',
    category: '',
    kind: 'insight',
    weight: 0.75,
    importance: 3,
    pattern:
      /(?:发现|原来|其实|问题(?:在于|是)|根因|根本原因|教训|踩坑|坑(?:在|是)|关键在于)|turns out|the (?:root cause|problem) is/i,
  },
  {
    id: 'fact',
    label: '项目事实',
    target: 'memory',
    category: '',
    kind: 'fact',
    weight: 0.62,
    importance: 3,
    pattern: /[A-Za-z]:\\[^\s]+|https?:\/\/[^\s]+|\b\d+\.\d+\.\d+\b|localhost:\d+|\bport\s*\d+|--[a-z][a-z0-9-]+/i,
  },
]

function entityTags(sentence) {
  const tags = []
  for (const entry of ENTITY_TAGS) if (entry.pattern.test(sentence)) tags.push(entry.tag)
  return tags
}

function isDroppable(sentence, role) {
  const text = normalizeText(sentence)
  if (text === '') return 'empty'
  if (CONFIRMATION.test(text)) return 'confirmation'
  if (HARNESS_CONTEXT.test(text) || MARKUP.test(text) || ENV_NAME.test(text)) return 'runtime-context'
  if (LOG_LINE.test(text)) return 'log'
  if (CODE_SHAPE.test(text)) return 'code'
  const cjk = /[\u4e00-\u9fff]/.test(text)
  if (cjk ? text.length < 4 : text.length < 12) return 'too-short'
  if (text.length > 600) return 'too-long'
  if (role === 'assistant') return 'agent-narration'
  if (REQUEST.test(text) && !PERSISTENT.test(text)) return 'request'
  return ''
}

/**
 * Score one turn set into candidates.
 *
 * @param {Array<{role: string, text: string, turn?: number, seq?: number}>} turns
 * @param {{existing?: Array<{title?: string, content?: string}>, maxPerBatch?: number}} options
 * @returns {{candidates: Array<object>, dropped: Array<{quote: string, reason: string}>, scanned: number}}
 */
export function extractCandidates(turns = [], options = {}) {
  const existing = (Array.isArray(options.existing) ? options.existing : []).map((item) => features(`${item.title ?? ''} ${item.content ?? ''}`))
  const maxPerBatch = Math.max(1, Math.min(40, options.maxPerBatch ?? THRESHOLDS.maxPerBatch))
  const candidates = []
  const dropped = []
  const seen = []
  let scanned = 0

  for (const turn of turns) {
    if (!turn || typeof turn.text !== 'string') continue
    const role = turn.role === 'assistant' ? 'assistant' : 'user'
    let perTurn = 0
    for (const sentence of splitSentences(stripCodeBlocks(turn.text))) {
      scanned += 1
      const reason = isDroppable(sentence, role)
      if (reason !== '') {
        dropped.push({ quote: sentence.slice(0, 80), reason })
        continue
      }
      const rule = RULES.find((entry) => entry.pattern.test(sentence))
      if (!rule) {
        dropped.push({ quote: sentence.slice(0, 80), reason: 'no-rule' })
        continue
      }
      // A question is a request for information, not a durable fact — unless it
      // is phrased as a preference ("你以后能不能都用中文？").
      if (QUESTION_TAIL.test(sentence) && rule.target !== 'profile') {
        dropped.push({ quote: sentence.slice(0, 80), reason: 'question' })
        continue
      }
      const text = normalizeText(sentence)
      const feature = features(text)
      if (seen.some((other) => similarity(other, feature) >= THRESHOLDS.duplicate)) {
        dropped.push({ quote: sentence.slice(0, 80), reason: 'duplicate' })
        continue
      }
      if (existing.some((other) => similarity(other, feature) >= THRESHOLDS.duplicate)) {
        dropped.push({ quote: sentence.slice(0, 80), reason: 'known' })
        continue
      }
      if (perTurn >= THRESHOLDS.maxPerTurn) {
        dropped.push({ quote: sentence.slice(0, 80), reason: 'turn-quota' })
        continue
      }
      let confidence = rule.weight + 0.06
      const tags = entityTags(text)
      if (tags.length > 0) confidence += 0.03
      confidence = Math.max(0.05, Math.min(0.99, Number(confidence.toFixed(2))))
      seen.push(feature)
      perTurn += 1
      candidates.push({
        rule: rule.id,
        label: rule.label,
        kind: rule.kind,
        target: rule.target,
        category: rule.category,
        title: toTitle(text, 56),
        content: text,
        tags: [...new Set([toTag(rule.category || rule.id), ...tags].filter((tag) => tag !== ''))],
        importance: rule.importance,
        confidence,
        role,
        turn: Number.isFinite(turn.turn) ? turn.turn : undefined,
        seq: Number.isFinite(turn.seq) ? turn.seq : undefined,
        quote: text.slice(0, 400),
      })
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence)
  return { candidates: candidates.slice(0, maxPerBatch), dropped, scanned }
}
