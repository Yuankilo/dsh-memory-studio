/**
 * Retrieval: a small, dependency-free embedder plus a hybrid ranker.
 *
 * The embedder is a hashed n-gram model, not a neural one:
 *
 *   - tokens are Latin words (2+ chars) and CJK uni/bi-grams, so Chinese
 *     queries match on overlapping characters instead of whole sentences;
 *   - each token is signed-hashed into a fixed 384-dim float vector;
 *   - weights are `(1 + log tf) * idf`, with title/tags/kind up-weighted, so a
 *     term that appears in one memory says more than one that appears in fifty;
 *   - vectors are L2-normalised, so cosine is a plain dot product.
 *
 * That keeps the store offline and deterministic (no model download, no API
 * key), while still answering paraphrase-ish queries: "导出按钮" lands on a
 * memory that says "加一个导出功能" through shared 导出 characters, and the
 * lexical channel keeps exact hits on top.
 *
 * Parent and child: a memory is the parent (what the user is shown, what the
 * Agent reads), and its content is split into sentence-sized child chunks. We
 * index the children, so a long note is not diluted by its own length — but we
 * always return the parent, plus the one child that actually matched. That is
 * the small-to-big pattern: precision from the child, context from the parent.
 */

const DIM = 384
const TITLE_WEIGHT = 2
const TAG_WEIGHT = 1.5
const KIND_WEIGHT = 0.8
const MIN_LATIN = 2
const CHUNK_CHARS = 180

/** FNV-1a, 32-bit. Stable across runs, which is all we need for hashing. */
function fnv1a(value) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function signOf(value) {
  return (fnv1a(`${value}#sign`) & 1) === 0 ? 1 : -1
}

const TOKEN_RE = /[a-z0-9_]+|[\u3400-\u9fff]+/g

/**
 * Split text into embedding tokens.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function tokenize(value) {
  const text = String(value ?? '').toLowerCase()
  const tokens = []
  TOKEN_RE.lastIndex = 0
  let match
  while ((match = TOKEN_RE.exec(text)) !== null) {
    const chunk = match[0]
    if (chunk.charCodeAt(0) < 128) {
      if (chunk.length >= MIN_LATIN) tokens.push(chunk)
      continue
    }
    for (let index = 0; index < chunk.length; index += 1) {
      tokens.push(chunk[index])
      if (index + 1 < chunk.length) tokens.push(chunk.slice(index, index + 2))
    }
  }
  return tokens
}

/**
 * Split one memory's body into child chunks on sentence boundaries.
 *
 * Sentences stay whole up to CHUNK_CHARS; a single run-on sentence is hard-cut
 * so one paragraph can never swallow the whole budget.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function splitChunks(content) {
  const text = String(content ?? '').replace(/\r\n/g, '\n').trim()
  if (text === '') return ['']
  const sentences = text.match(/[^。！？；!?;\n]+[。！？；!?;\n]?/g) ?? [text]
  const chunks = []
  let current = ''
  const push = () => {
    if (current.trim() !== '') chunks.push(current.trim())
    current = ''
  }
  for (const raw of sentences) {
    const sentence = raw.trim()
    if (sentence === '') continue
    if (sentence.length > CHUNK_CHARS) {
      push()
      for (let start = 0; start < sentence.length; start += CHUNK_CHARS) {
        chunks.push(sentence.slice(start, start + CHUNK_CHARS))
      }
      continue
    }
    if (current !== '' && current.length + sentence.length > CHUNK_CHARS) push()
    current += sentence
  }
  push()
  return chunks.length === 0 ? [''] : chunks
}

function chunkFrequency(item, text, index) {
  const tf = new Map()
  const bump = (tokens, weight) => {
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + weight)
  }
  bump(tokenize(text), 1)
  bump(tokenize((item?.tags ?? []).join(' ')), TAG_WEIGHT)
  bump(tokenize(item?.kind ?? ''), KIND_WEIGHT)
  bump(tokenize(item?.scope ?? ''), 0.5)
  // The title describes the parent, so it belongs to the first child only; if
  // every child carried it, a long note would look like a hundred title hits.
  if (index === 0) bump(tokenize(item?.title ?? ''), TITLE_WEIGHT)
  return tf
}

function vectorize(tf, idf) {
  const vector = new Float32Array(DIM)
  for (const [token, count] of tf) {
    const weight = (1 + Math.log(count)) * (idf.get(token) ?? 1)
    const index = fnv1a(token) % DIM
    vector[index] += signOf(token) * weight
  }
  return normalize(vector)
}

function normalize(vector) {
  let sum = 0
  for (let index = 0; index < vector.length; index += 1) sum += vector[index] * vector[index]
  const norm = Math.sqrt(sum)
  if (norm > 0) for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
  return vector
}

/**
 * Build the searchable index for a set of memories.
 *
 * The unit of indexing is the child chunk; `byItem` maps a parent back to the
 * children that came from it, so ranking can score children and report parents.
 *
 * @param {Array<object>} items
 * @returns {{dim: number, n: number, idf: Map<string, number>, vectors: Map<string, Float32Array>, docs: Array<object>, byItem: Map<string, string[]>, items: Array<object>, avgdl: number}}
 */
export function buildIndex(items = []) {
  const docs = []
  const documentFrequency = new Map()
  const byItem = new Map()
  for (const item of items) {
    if (!item || typeof item.id !== 'string') continue
    const chunks = splitChunks(item.content)
    byItem.set(item.id, [])
    chunks.forEach((text, index) => {
      const tf = chunkFrequency(item, text, index)
      for (const token of tf.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1)
      const id = `${item.id}#${index}`
      byItem.get(item.id).push(id)
      docs.push({ id, item, index, text, tf })
    })
  }
  const n = docs.length
  const idf = new Map()
  for (const [token, df] of documentFrequency) idf.set(token, Math.log((n + 1) / (df + 0.5)) + 1)
  const vectors = new Map()
  let totalLength = 0
  for (const doc of docs) {
    let length = 0
    for (const count of doc.tf.values()) length += count
    doc.length = length
    totalLength += length
    vectors.set(doc.id, vectorize(doc.tf, idf))
  }
  return { dim: DIM, n, idf, vectors, docs, byItem, items, avgdl: n === 0 ? 0 : totalLength / n }
}

/**
 * Embed a free-text query against the corpus idf.
 *
 * @param {string} query
 * @param {{idf: Map<string, number>}} index
 * @returns {Float32Array}
 */
export function queryVector(query, index) {
  const tf = new Map()
  for (const token of tokenize(query)) tf.set(token, (tf.get(token) ?? 0) + 1)
  return vectorize(tf, index?.idf ?? new Map())
}

/** Cosine similarity of two normalised vectors is their dot product. */
export function cosine(a, b) {
  if (!a || !b) return 0
  let sum = 0
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) sum += a[index] * b[index]
  return sum
}

/**
 * BM25 over the same tokens the embedder uses, normalised to 0..1 by the best
 * possible score for this query (every query term saturating in the document).
 *
 * @param {ReturnType<typeof buildIndex>} index
 * @param {string[]} tokens
 * @param {{tf: Map<string, number>, length: number}|undefined} doc
 * @returns {number}
 */
export function bm25(index, tokens, doc) {
  if (!doc || tokens.length === 0) return 0
  const k1 = 1.4
  const b = 0.72
  const average = index.avgdl > 0 ? index.avgdl : 1
  let sum = 0
  let ceiling = 0
  for (const token of tokens) {
    const idf = index.idf.get(token)
    if (idf === undefined) continue
    ceiling += idf * (k1 + 1)
    const frequency = doc.tf.get(token) ?? 0
    if (frequency === 0) continue
    const denominator = frequency + k1 * (1 - b + b * (doc.length / average))
    sum += (idf * frequency * (k1 + 1)) / denominator
  }
  if (ceiling === 0) return 0
  return sum / ceiling
}

/**
 * Hybrid ranking: vector similarity, BM25, exact substring and a prior, blended.
 *
 * Children are scored, parents are returned. When several children of the same
 * memory match, the parent gets a small coverage bonus — a memory that touches
 * the query in three places is more likely to be about it than one lucky line.
 *
 * @param {ReturnType<typeof buildIndex>} index
 * @param {string} query
 * @param {{weights?: {vector?: number, lexical?: number, prior?: number, exact?: number}, lexical?: (item: object) => number, prior?: (item: object) => number, floor?: number}} options
 * @returns {Array<{item: object, score: number, vector: number, lexical: number, exact: number, prior: number, match: {index: number, text: string}|null, matches: number}>}
 */
export function rank(index, query, options = {}) {
  const weights = {
    vector: 0.42,
    lexical: 0.4,
    prior: 0.13,
    exact: 0.05,
    ...(options.weights ?? {}),
  }
  const exactOf = typeof options.lexical === 'function' ? options.lexical : () => 0
  const priorOf = typeof options.prior === 'function' ? options.prior : () => 0
  const floor = typeof options.floor === 'number' ? options.floor : 0.02
  const text = String(query ?? '').trim()

  if (text === '') {
    return index.items
      .map((item) => ({ item, score: priorOf(item), vector: 0, lexical: 0, exact: 0, prior: priorOf(item), match: null, matches: 0 }))
      .filter((row) => row.score >= floor && row.score > 0)
      .sort(byScore)
  }

  const tokens = tokenize(text)
  const qv = queryVector(text, index)
  const rows = new Map()
  for (const doc of index.docs) {
    const vectorScore = Math.max(0, cosine(qv, index.vectors.get(doc.id)))
    const lexicalScore = bm25(index, tokens, doc)
    if (vectorScore < 0.06 && lexicalScore < 0.02) continue
    const combined = weights.vector * vectorScore + weights.lexical * lexicalScore
    const best = rows.get(doc.item.id)
    if (!best || combined > best.combined) {
      rows.set(doc.item.id, {
        item: doc.item,
        combined,
        vector: vectorScore,
        lexical: lexicalScore,
        matches: (best?.matches ?? 0) + 1,
        match: { index: doc.index, text: doc.text },
      })
    } else {
      best.matches += 1
    }
  }

  const out = []
  for (const row of rows.values()) {
    const exact = Math.max(0, Math.min(1, exactOf(row.item)))
    const prior = priorOf(row.item)
    const coverage = Math.min(0.06, Math.max(0, row.matches - 1) * 0.03)
    const score = row.combined + weights.exact * exact + weights.prior * prior + coverage
    if (score < floor) continue
    out.push({
      item: row.item,
      score,
      vector: row.vector,
      lexical: row.lexical,
      exact,
      prior,
      match: row.match,
      matches: row.matches,
    })
  }
  return out.sort(byScore)
}

function byScore(a, b) {
  if (b.score !== a.score) return b.score - a.score
  if (Boolean(b.item.pinned) !== Boolean(a.item.pinned)) return b.item.pinned ? 1 : -1
  return String(b.item.updatedAt ?? '').localeCompare(String(a.item.updatedAt ?? ''))
}

export const EMBEDDING = {
  dim: DIM,
  titleWeight: TITLE_WEIGHT,
  tagWeight: TAG_WEIGHT,
  kindWeight: KIND_WEIGHT,
  chunkChars: CHUNK_CHARS,
}
