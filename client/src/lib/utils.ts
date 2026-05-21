import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** API timestamps are UTC (ISO with Z, or SQLite `YYYY-MM-DD HH:MM:SS`). */
export function parseApiTimestamp(value: string): Date {
  const s = value.trim()
  if (!s) return new Date(NaN)
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s)
  }
  const normalized = s.includes('T') ? s : s.replace(' ', 'T')
  return new Date(`${normalized}Z`)
}

export function formatLocalTime(value: string): string {
  const d = parseApiTimestamp(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatLocalDateTime(value: string): string {
  const d = parseApiTimestamp(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Daily timeline buckets are civil dates (YYYY-MM-DD), not UTC midnight. */
function parseTimelineDayBucket(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return parseApiTimestamp(value)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function formatTimelineLabel(value: string, hourly: boolean): string {
  const d = hourly ? parseApiTimestamp(value) : parseTimelineDayBucket(value)
  if (Number.isNaN(d.getTime())) return value
  if (hourly) {
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
