/**
 * Tiny atomic JSON files.
 *
 * Every store in this plugin owns one file and writes it the same way: serialize
 * to a temp sibling, then rename over the target. A crash mid-write leaves the
 * previous good file intact; a parse error moves the broken file aside so the
 * next save cannot silently destroy evidence.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Modification time of a store file, or 0 when it does not exist yet.
 *
 * Two plugin instances can end up sharing one directory (a host reload, or the
 * desktop app and the tool host both loading the package). Each keeps its own
 * copy in memory, so a read has to notice that another instance has written —
 * otherwise the UI shows what the agent saw an hour ago.
 */
export function stampOf(file) {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    try {
      renameSync(file, `${file}.corrupt-${Date.now()}`)
    } catch {
      /* the caller still gets the fallback */
    }
    console.warn('[dsh-memory-studio] unreadable json moved aside:', file, error?.message ?? error)
    return fallback
  }
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function nowIso() {
  return new Date().toISOString()
}
