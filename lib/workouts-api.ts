import type { AppConfig, CheckInRecord } from "@/types"
import {
  applyWorkoutOperations,
  backupRecordsBeforeSync,
  discardDeletedWorkoutOperations,
  formatLocalDate,
  getRecords,
  getWorkoutOperations,
  markWorkoutOperationSynced,
  mergeRecordLists,
  queueWorkoutOperation,
  reconcileWorkoutOperations,
  saveRecords,
} from "@/lib/storage"

export const WORKOUTS_CHANGED_EVENT = "workouts-changed"
let syncPromise: Promise<CheckInRecord[]> | null = null
let loadPromise: Promise<CheckInRecord[]> | null = null

function persistAndNotify(records: CheckInRecord[]) {
  if (!saveRecords(records)) throw new Error("本机保存失败，请检查剩余空间")
  window.dispatchEvent(new Event(WORKOUTS_CHANGED_EVENT))
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (response.status === 401 || (response.redirected && new URL(response.url).pathname === "/login")) {
    const next = `${window.location.pathname}${window.location.search}`
    window.location.replace(`/login?next=${encodeURIComponent(next)}`)
    throw new Error("需要重新登录，本机记录已保留")
  }
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("云端响应异常，请稍后重试")
  const data = await response.json()
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "同步失败")
  return data as T
}

export async function getAppConfig(): Promise<AppConfig> {
  return requestJson<AppConfig>("/api/config")
}

export function syncPendingWorkouts(): Promise<CheckInRecord[]> {
  if (syncPromise) return syncPromise
  syncPromise = (async () => {
    const attempted = new Set<string>()
    while (true) {
      const operation = getWorkoutOperations().find((item) => !item.syncedAt && !attempted.has(item.operationId))
      if (!operation) break
      attempted.add(operation.operationId)
      if (operation.kind === "save") {
        const data = await requestJson<{ records: CheckInRecord[] }>("/api/records", { method: "POST", body: JSON.stringify(operation.record) })
        if (!data.records?.some((record) => record.id === operation.record.id)) throw new Error("云端未确认保存，请稍后重试")
      } else {
        const data = await requestJson<{ ok: boolean }>("/api/records", {
          method: "DELETE",
          body: JSON.stringify(operation.kind === "delete" ? { id: operation.id } : { clear: true }),
        })
        if (!data.ok) throw new Error("云端未确认删除，请稍后重试")
      }
      // Match the operation token so an older response cannot erase a newer edit.
      markWorkoutOperationSynced(operation.operationId)
      persistAndNotify(applyWorkoutOperations(getRecords()))
    }
    return getRecords()
  })().finally(() => { syncPromise = null })
  return syncPromise
}

export function getWorkouts(): Promise<CheckInRecord[]> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    backupRecordsBeforeSync()
    await syncPendingWorkouts().catch(() => undefined)
    const data = await requestJson<{ records: CheckInRecord[]; deletedIds?: string[] }>("/api/records")
    if (!Array.isArray(data.records)) throw new Error("云端记录格式异常，请稍后重试")
    if (Array.isArray(data.deletedIds)) discardDeletedWorkoutOperations(data.deletedIds)
    const records = applyWorkoutOperations(data.records, reconcileWorkoutOperations(data.records))
    persistAndNotify(records)
    return records
  })().finally(() => { loadPromise = null })
  return loadPromise
}

export function createOptimisticWorkout(category: CheckInRecord["category"], duration: number): CheckInRecord {
  const now = new Date()
  const date = formatLocalDate(now)
  return { id: `${date.replace(/-/g, "")}-${crypto.randomUUID()}`, timestamp: now.getTime(), date, category, duration }
}

export async function createWorkout(record: CheckInRecord): Promise<CheckInRecord> {
  queueWorkoutOperation({ operationId: crypto.randomUUID(), kind: "save", record })
  persistAndNotify(mergeRecordLists(getRecords(), [record]))
  await syncPendingWorkouts()
  return getRecords().find((item) => item.id === record.id) ?? record
}

export async function importWorkouts(records: CheckInRecord[]): Promise<CheckInRecord[]> {
  const current = new Map(getRecords().map((record) => [record.id, record]))
  for (const record of records) {
    const previous = current.get(record.id)
    if (!previous || previous.date !== record.date || previous.duration !== record.duration || previous.timestamp !== record.timestamp || previous.category !== record.category) {
      queueWorkoutOperation({ operationId: crypto.randomUUID(), kind: "save", record })
    }
  }
  persistAndNotify(mergeRecordLists(getRecords(), records))
  await syncPendingWorkouts()
  return getWorkouts()
}

export async function updateWorkout(id: string, updates: Partial<Pick<CheckInRecord, "date" | "duration">>): Promise<CheckInRecord> {
  const previous = getRecords().find((record) => record.id === id)
  if (!previous) throw new Error("记录不存在")
  const record = { ...previous, ...updates }
  queueWorkoutOperation({ operationId: crypto.randomUUID(), kind: "save", record })
  persistAndNotify(mergeRecordLists(getRecords(), [record]))
  await syncPendingWorkouts()
  return record
}

export async function deleteWorkout(id: string): Promise<void> {
  queueWorkoutOperation({ operationId: crypto.randomUUID(), kind: "delete", id })
  persistAndNotify(getRecords().filter((record) => record.id !== id))
  await syncPendingWorkouts()
}

export async function clearWorkouts(): Promise<void> {
  queueWorkoutOperation({ operationId: crypto.randomUUID(), kind: "clear" })
  persistAndNotify([])
  await syncPendingWorkouts()
}
