import type { CheckInRecord } from "@/types"

const STORAGE_KEY = "check-in-records"
const LEGACY_CACHE_KEY = "check-in-records-cache"
const PENDING_SYNC_KEY = "check-in-records-pending-sync"
const PENDING_OPERATIONS_KEY = "check-in-records-pending-operations"
const SYNC_BACKUP_KEY = "check-in-records-before-sync-v2"

export type WorkoutOperation = {
  operationId: string
  syncedAt?: number
} & ({ kind: "save"; record: CheckInRecord } | { kind: "delete"; id: string } | { kind: "clear" })

let xlsxModule: typeof import("@e965/xlsx") | null = null
let memoryCache: CheckInRecord[] | null = null

async function getXLSX() {
  if (!xlsxModule) {
    xlsxModule = await import("@e965/xlsx")
  }
  return xlsxModule
}

function canUseLocalStorage(): boolean {
  if (typeof window === "undefined") return false

  try {
    const testKey = "__storage_test__"
    window.localStorage.setItem(testKey, testKey)
    window.localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

function getItem(key: string): string | null {
  if (!canUseLocalStorage()) return null

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function setItem(key: string, value: string): boolean {
  if (!canUseLocalStorage()) return false

  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function removeItem(key: string): boolean {
  if (!canUseLocalStorage()) return false

  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function normalizeCategory(value: unknown): CheckInRecord["category"] | null {
  if (value === "锻炼" || value === "閿荤偧" || value === "体能训练" || value === "浣撹兘璁粌") {
    return "锻炼"
  }

  if (value === "拉伸" || value === "鎷変几") {
    return "拉伸"
  }

  return null
}

function normalizeRecord(record: unknown): CheckInRecord | null {
  if (!record || typeof record !== "object") return null

  const raw = record as Record<string, unknown>
  const category = normalizeCategory(raw.category)
  const timestamp = Number(raw.timestamp)
  const duration = Number(raw.duration)
  const date = typeof raw.date === "string" ? raw.date : ""
  const id = typeof raw.id === "string" ? raw.id : ""

  if (!id || !category || !date || Number.isNaN(timestamp) || Number.isNaN(duration) || duration <= 0) {
    return null
  }

  return {
    id,
    timestamp,
    date,
    category,
    duration,
  }
}

function readStoredRecords(): CheckInRecord[] {
  const rawData = getItem(STORAGE_KEY) ?? getItem(LEGACY_CACHE_KEY)
  if (!rawData) return []

  try {
    const parsed = JSON.parse(rawData)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map(normalizeRecord)
      .filter((record): record is CheckInRecord => Boolean(record))
  } catch {
    return []
  }
}

function persistRecords(records: CheckInRecord[]): boolean {
  const cleanRecords = records
    .map(normalizeRecord)
    .filter((record): record is CheckInRecord => Boolean(record))
  const saved = setItem(STORAGE_KEY, JSON.stringify(cleanRecords))

  removeItem(LEGACY_CACHE_KEY)
  memoryCache = cleanRecords

  return saved
}

export function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map((part) => Number(part))
  return new Date(year, (month || 1) - 1, day || 1)
}

export function mergeRecordLists(...recordLists: CheckInRecord[][]): CheckInRecord[] {
  const recordsById = new Map<string, CheckInRecord>()

  for (const records of recordLists) {
    for (const record of records) {
      const normalized = normalizeRecord(record)
      if (normalized) recordsById.set(normalized.id, normalized)
    }
  }

  return [...recordsById.values()].sort((a, b) => b.timestamp - a.timestamp)
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return "00:00:00"

  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":")
}

function parseDate(value: unknown): string | null {
  if (typeof value === "number") return null

  const text = String(value ?? "").trim()
  if (!text) return null

  const normalized = text.replace(/\//g, "-")
  const parts = normalized.split("-").map((part) => Number(part))
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null

  let [year] = parts
  const [, month, day] = parts
  if (year < 100) year = year > 50 ? 1900 + year : 2000 + year

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function parseTimestamp(date: string, time: unknown): number {
  const [hours = 0, minutes = 0, seconds = 0] = String(time ?? "00:00:00")
    .split(":")
    .map((part) => Number(part))
  const value = parseLocalDate(date)

  if (Number.isNaN(value.getTime())) return Date.now()

  value.setHours(hours || 0, minutes || 0, seconds || 0, 0)
  return value.getTime()
}

function generateId(records: CheckInRecord[], date: string): string {
  const datePrefix = date.replace(/-/g, "")
  const count = records.filter((record) => record.id.startsWith(datePrefix)).length + 1
  return `${datePrefix}-${String(count).padStart(3, "0")}-${Date.now() % 10000}`
}

export function getRecords(): CheckInRecord[] {
  if (typeof window === "undefined") return []

  if (memoryCache) return [...memoryCache]

  const records = readStoredRecords()
  memoryCache = records
  persistRecords(records)

  return [...records]
}

export function saveRecords(records: CheckInRecord[]): boolean {
  if (typeof window === "undefined") return false
  return persistRecords(records)
}

export function reloadStoredRecords(): CheckInRecord[] {
  memoryCache = null
  return getRecords()
}

export function backupRecordsBeforeSync(): void {
  if (getItem(SYNC_BACKUP_KEY) === null) setItem(SYNC_BACKUP_KEY, JSON.stringify(getRecords()))
}

function saveWorkoutOperations(operations: WorkoutOperation[]): boolean {
  return setItem(PENDING_OPERATIONS_KEY, JSON.stringify(operations))
}

export function getWorkoutOperations(): WorkoutOperation[] {
  let operations: WorkoutOperation[] = []
  try {
    const parsed = JSON.parse(getItem(PENDING_OPERATIONS_KEY) ?? "[]")
    if (Array.isArray(parsed)) {
      operations = parsed.flatMap((value): WorkoutOperation[] => {
        if (!value || typeof value.operationId !== "string") return []
        const base = { operationId: value.operationId, syncedAt: typeof value.syncedAt === "number" ? value.syncedAt : undefined }
        if (value.kind === "clear") return [{ ...base, kind: "clear" }]
        if (value.kind === "delete" && typeof value.id === "string") return [{ ...base, kind: "delete", id: value.id }]
        const record = value.kind === "save" ? normalizeRecord(value.record) : null
        return record ? [{ ...base, kind: "save", record }] : []
      })
    }
  } catch {
    // Keep the existing records available if the queue is unreadable.
  }

  const legacyPending = getPendingSyncRecords()
  if (legacyPending.length > 0) {
    for (const record of legacyPending) {
      if (!operations.some((operation) => operation.kind === "clear" || (operation.kind === "save" ? operation.record.id === record.id : operation.id === record.id))) {
        operations.push({ operationId: crypto.randomUUID(), kind: "save", record })
      }
    }
    if (saveWorkoutOperations(operations)) savePendingSyncRecords([])
  }
  return operations
}

export function queueWorkoutOperation(operation: WorkoutOperation): void {
  const current = getWorkoutOperations()
  const id = operation.kind === "save" ? operation.record.id : operation.kind === "delete" ? operation.id : null
  const next = operation.kind === "clear" ? [] : current.filter((item) =>
    item.kind === "clear" || (item.kind === "save" ? item.record.id : item.id) !== id
  )
  if (!saveWorkoutOperations([...next, operation])) throw new Error("本机保存失败，请检查剩余空间")
}

export function markWorkoutOperationSynced(operationId: string): void {
  saveWorkoutOperations(getWorkoutOperations().map((operation) =>
    operation.operationId === operationId ? { ...operation, syncedAt: Date.now() } : operation
  ))
}

export function discardDeletedWorkoutOperations(ids: string[]): void {
  const deleted = new Set(ids)
  saveWorkoutOperations(getWorkoutOperations().filter((operation) =>
    operation.kind === "clear" || !deleted.has(operation.kind === "save" ? operation.record.id : operation.id)
  ))
}

export function reconcileWorkoutOperations(cloudRecords: CheckInRecord[]): WorkoutOperation[] {
  // Keep a short overlay while KV reads catch up with acknowledged writes.
  const active = getWorkoutOperations().filter((operation) => !operation.syncedAt || Date.now() - operation.syncedAt <= 65_000)
  const cloud = mergeRecordLists(cloudRecords)
  const reflected = JSON.stringify(applyWorkoutOperations(cloud, active)) === JSON.stringify(cloud)
  // Reconcile the complete sequence: a clear followed by a save must stay together.
  const operations = reflected ? active.filter((operation) => !operation.syncedAt) : active
  saveWorkoutOperations(operations)
  return operations
}

export function applyWorkoutOperations(records: CheckInRecord[], operations = getWorkoutOperations()): CheckInRecord[] {
  let next = records
  for (const operation of operations) {
    if (operation.kind === "clear") next = []
    else if (operation.kind === "delete") next = next.filter((record) => record.id !== operation.id)
    else next = mergeRecordLists(next, [operation.record])
  }
  return next
}

export function getPendingSyncRecords(): CheckInRecord[] {
  const rawData = getItem(PENDING_SYNC_KEY)
  if (!rawData) return []

  try {
    const parsed = JSON.parse(rawData)
    if (!Array.isArray(parsed)) return []

    return parsed
      .map(normalizeRecord)
      .filter((record): record is CheckInRecord => Boolean(record))
  } catch {
    return []
  }
}

export function savePendingSyncRecords(records: CheckInRecord[]): boolean {
  const cleanRecords = mergeRecordLists(records)

  if (cleanRecords.length === 0) {
    return removeItem(PENDING_SYNC_KEY)
  }

  return setItem(PENDING_SYNC_KEY, JSON.stringify(cleanRecords))
}

export function queuePendingSyncRecord(record: CheckInRecord): void {
  savePendingSyncRecords(mergeRecordLists(getPendingSyncRecords(), [record]))
}

export function removePendingSyncRecords(ids: string[]): void {
  if (ids.length === 0) return

  const idsToRemove = new Set(ids)
  savePendingSyncRecords(getPendingSyncRecords().filter((record) => !idsToRemove.has(record.id)))
}

export function addRecord(category: CheckInRecord["category"], duration: number): CheckInRecord | null {
  if (duration <= 0) return null

  const records = getRecords()
  const now = new Date()
  const date = formatLocalDate(now)
  const record: CheckInRecord = {
    id: generateId(records, date),
    timestamp: now.getTime(),
    date,
    category,
    duration,
  }

  return saveRecords([...records, record]) ? record : null
}

export function updateRecord(id: string, updates: Partial<Pick<CheckInRecord, "date" | "duration">>): boolean {
  const records = getRecords()
  const nextRecords = records.map((record) => {
    if (record.id !== id) return record

    return {
      ...record,
      date: updates.date || record.date,
      duration: typeof updates.duration === "number" && updates.duration > 0 ? updates.duration : record.duration,
    }
  })

  return saveRecords(nextRecords)
}

export function deleteRecord(id: string): boolean {
  const records = getRecords()
  const nextRecords = records.filter((record) => record.id !== id)
  if (nextRecords.length === records.length) return false

  return saveRecords(nextRecords)
}

export function clearRecords(): boolean {
  memoryCache = []
  removeItem(LEGACY_CACHE_KEY)
  return removeItem(STORAGE_KEY)
}

export async function downloadXLSX(records = getRecords()): Promise<void> {
  if (typeof window === "undefined") return

  const XLSX = await getXLSX()
  const rows = records
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((record) => [
      record.date.replace(/-/g, "/"),
      formatTime(record.timestamp),
      record.category,
      record.category === "拉伸" ? `*${record.duration}` : String(record.duration),
      record.category === "拉伸" ? "次数" : "分钟",
    ])

  const worksheet = XLSX.utils.aoa_to_sheet([["日期", "时间", "习惯名称", "数值", "量词"], ...rows])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "打卡记录")

  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" })
  const blob = new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = `打卡记录_${formatLocalDate(new Date())}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export async function importFromXLSX(buffer: ArrayBuffer, mode: "replace" | "merge"): Promise<number> {
  const importedRecords = await parseRecordsFromXLSX(buffer, mode === "merge" ? getRecords() : [])

  saveRecords(mode === "replace" ? importedRecords : [...getRecords(), ...importedRecords])

  return importedRecords.length
}

export async function parseRecordsFromXLSX(buffer: ArrayBuffer, existingRecords: CheckInRecord[] = []): Promise<CheckInRecord[]> {
  const XLSX = await getXLSX()
  const workbook = XLSX.read(buffer, { type: "array" })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  const worksheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as unknown[][]
  const importedRecords: CheckInRecord[] = []

  for (const row of data.slice(1)) {
    if (!row || row.length < 4) continue

    const date = parseDate(row[0])
    const category = normalizeCategory(row[2])
    const duration = Number(String(row[3] ?? "").replace("*", ""))

    if (!date || !category || Number.isNaN(duration) || duration <= 0) continue

    importedRecords.push({
      id: generateId([...existingRecords, ...importedRecords], date),
      timestamp: parseTimestamp(date, row[1]),
      date,
      category,
      duration,
    })
  }

  return importedRecords
}

export interface StatsData {
  totalDays: number
  totalMinutes: number
  avgMinutesPerDay: number
  yearTotalDays: number
  workoutMinutes: number
  stretchCount: number
}

export function getMonthlyStats(
  records: CheckInRecord[],
  year: number,
  month: number,
  category?: CheckInRecord["category"]
): StatsData {
  const filtered = records.filter((record) => {
    const date = parseLocalDate(record.date)
    return date.getFullYear() === year && date.getMonth() === month && (!category || record.category === category)
  })
  const yearlyRecords = records.filter((record) => {
    const date = parseLocalDate(record.date)
    return date.getFullYear() === year && (!category || record.category === category)
  })
  const workoutMinutes = filtered
    .filter((record) => record.category === "锻炼")
    .reduce((sum, record) => sum + record.duration, 0)
  const stretchCount = filtered
    .filter((record) => record.category === "拉伸")
    .reduce((sum, record) => sum + record.duration, 0)
  const totalDays = new Set(filtered.map((record) => record.date)).size

  return {
    totalDays,
    totalMinutes: workoutMinutes,
    avgMinutesPerDay: totalDays > 0 ? Math.round(workoutMinutes / totalDays) : 0,
    yearTotalDays: new Set(yearlyRecords.map((record) => record.date)).size,
    workoutMinutes,
    stretchCount,
  }
}

export function getDailyStats(records: CheckInRecord[]): Map<string, { total: number; workout: number; stretch: number }> {
  const stats = new Map<string, { total: number; workout: number; stretch: number }>()

  for (const record of records) {
    const current = stats.get(record.date) ?? { total: 0, workout: 0, stretch: 0 }

    if (record.category === "锻炼") {
      current.workout += record.duration
      current.total += record.duration
    } else {
      current.stretch += record.duration
      current.total += 1
    }

    stats.set(record.date, current)
  }

  return stats
}

export function getYearlyMonthlyStats(
  records: CheckInRecord[],
  year: number,
  category?: CheckInRecord["category"]
): number[] {
  const monthlyData = new Array(12).fill(0)

  for (const record of records) {
    const date = parseLocalDate(record.date)
    if (date.getFullYear() !== year) continue
    if (category && record.category !== category) continue

    monthlyData[date.getMonth()] += record.duration
  }

  return monthlyData
}
