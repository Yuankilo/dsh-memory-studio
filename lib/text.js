/**
 * Text helpers shared by the capture policy and the graph builder.
 *
 * Everything here is pure and dependency-free so the policy can be unit-tested
 * without a session, a model or a filesystem. The two jobs are:
 *   - turn a sentence into a comparable token set (CJK bigrams + latin words),
 *   - split a message into sentences that are worth scoring.
 */

/** Latin words, numbers and CJK runs, lowercased. */
const WORD = /[a-z0-9_]+|[\u4e00-\u9fff]+/gi

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** Fenced code blocks are context, not statements: they are never a memory. */
export function stripCodeBlocks(value) {
  return String(value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]{0,120}`/g, ' ')
}

/**
 * Bag of features for fuzzy comparison. Chinese has no spaces, so a run of
 * Chinese characters becomes overlapping bigrams; latin text becomes words.
 */
export function features(value) {
  const out = new Set()
  const source = stripCodeBlocks(normalizeText(value)).toLowerCase()
  for (const match of source.matchAll(WORD)) {
    const token = match[0]
    if (/^[a-z0-9_]+$/.test(token)) {
      if (token.length > 1) out.add(token)
      continue
    }
    if (token.length === 1) out.add(token)
    for (let i = 0; i < token.length - 1; i += 1) out.add(token.slice(i, i + 2))
  }
  return out
}

/** Sørensen–Dice over feature sets. 0 = unrelated, 1 = identical. */
export function similarity(a, b) {
  const left = a instanceof Set ? a : features(a)
  const right = b instanceof Set ? b : features(b)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

const SENTENCE_END = /[。！？!?；;\n]+/

/** Split into candidate statements, keeping sentence punctuation off the end. */
export function splitSentences(value) {
  return String(value ?? '')
    .split(SENTENCE_END)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** A single-line, bounded label for a captured statement. */
export function toTitle(value, max = 60) {
  const line = normalizeText(value).split('\n')[0]
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/** Crude but stable ISO-ish tag: lowercase, spaces and punctuation collapse to '-'. */
export function toTag(value, max = 24) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
}

/** Timestamps are compared a lot; keep one tolerant parser. */
export function timeOf(value) {
  const n = typeof value === 'number' ? value : Date.parse(String(value ?? ''))
  return Number.isFinite(n) ? n : 0
}
