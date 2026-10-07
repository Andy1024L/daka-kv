"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, Download, Pencil, Trash2, Upload, X } from "lucide-react"
import { BottomNav } from "@/components/bottom-nav"
import { SuccessToast } from "@/components/success-toast"
import { Button } from "@/components/ui/button"
import { downloadXLSX, getRecords, parseRecordsFromXLSX } from "@/lib/storage"
import {
  clearWorkouts,
  deleteWorkout,
  getWorkouts,
  importWorkouts,
  updateWorkout,
} from "@/lib/workouts-api"
import type { CheckInRecord } from "@/types"

export default function DataPage({
  records: externalRecords,
  onRecordsChange,
}: {
  records?: CheckInRecord[]
  onRecordsChange?: (records: CheckInRecord[]) => void
} = {}) {
  const [records, setRecords] = useState<CheckInRecord[]>(() => externalRecords ?? getRecords())
  const [toast, setToast] = useState({ visible: false, message: "" })
  const [showConfirm, setShowConfirm] = useState(false)
  const [editingRecord, setEditingRecord] = useState<CheckInRecord | null>(null)
  const [editDate, setEditDate] = useState("")
  const [editDuration, setEditDuration] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showToast = useCallback((message: string) => {
    setToast({ visible: true, message })
    window.setTimeout(() => setToast({ visible: false, message: "" }), 2000)
  }, [])

  const refreshRecords = useCallback(async () => {
    try {
      await getWorkouts()
      const data = getRecords()
      setRecords(data)
      onRecordsChange?.(data)
      setError(null)
    } catch (err) {
      setRecords((current) => {
        const fallback = current.length > 0 ? current : getRecords()
        onRecordsChange?.(fallback)
        return fallback
      })
      setError(err instanceof Error ? err.message : "云端数据加载失败")
    }
  }, [onRecordsChange])

  useEffect(() => {
    if (externalRecords) {
      setRecords(externalRecords)
      setIsLoading(false)
      return
    }

    refreshRecords().finally(() => setIsLoading(false))
  }, [externalRecords, refreshRecords])

  const handleExport = async () => {
    if (isExporting) return

    setIsExporting(true)
    try {
      await downloadXLSX(records)
      showToast("表格导出成功")
    } catch {
      showToast("导出失败，请重试")
    } finally {
      setIsExporting(false)
    }
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    try {
      const buffer = await file.arrayBuffer()
      const mode = records.length > 0 ? "merge" : "replace"
      const importedRecords = await parseRecordsFromXLSX(buffer, mode === "merge" ? records : [])
      const nextRecords = mode === "replace" ? importedRecords : [...records, ...importedRecords]

      if (mode === "replace") {
        await clearWorkouts()
      }
      await importWorkouts(nextRecords)
      await refreshRecords()
      showToast(`导入 ${importedRecords.length} 条记录`)
    } catch {
      showToast("导入失败，请检查文件格式")
    } finally {
      setIsImporting(false)
      event.target.value = ""
    }
  }

  const handleClear = async () => {
    setShowConfirm(false)
    try {
      await clearWorkouts()
      await refreshRecords()
      showToast("数据已清除")
    } catch {
      const localRecords = getRecords()
      setRecords(localRecords)
      onRecordsChange?.(localRecords)
      showToast("已在本机清除，联网后会自动同步")
    }
  }

  const handleDeleteRecord = (id: string) => {
    const nextRecords = records.filter((record) => record.id !== id)
    setRecords(nextRecords)
    onRecordsChange?.(nextRecords)

    deleteWorkout(id)
      .then(() => showToast("记录已删除"))
      .catch(() => {
        setRecords(getRecords())
        onRecordsChange?.(getRecords())
        showToast("已在本机删除，联网后会自动同步")
      })
  }

  const handleEditClick = (record: CheckInRecord) => {
    setEditingRecord(record)
    setEditDate(record.date)
    setEditDuration(String(record.duration))
  }

  const handleEditSave = () => {
    if (!editingRecord) return

    const duration = Number(editDuration)
    if (!editDate || Number.isNaN(duration) || duration <= 0) {
      showToast("请输入有效数据")
      return
    }

    const nextRecords = records.map((record) =>
      record.id === editingRecord.id ? { ...record, date: editDate, duration } : record
    )
    setRecords(nextRecords)
    onRecordsChange?.(nextRecords)
    setEditingRecord(null)
    showToast("记录已更新")

    updateWorkout(editingRecord.id, { date: editDate, duration }).catch(() => {
      setRecords(getRecords())
      onRecordsChange?.(getRecords())
      showToast("已保存到本机，联网后会自动同步")
    })
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return "00:00"

    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  }

  const sortedRecords = [...records].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <main className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-lg">
        <div className="mx-auto max-w-md px-4 py-4">
          <h1 className="text-center text-xl font-bold text-foreground">数据管理</h1>
        </div>
      </header>

      <div className="mx-auto max-w-md space-y-4 px-4 py-4">
        {error && (
          <div className="flex items-center gap-3 rounded-xl bg-destructive/10 p-4 text-destructive">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">数据管理</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={handleExport} variant="outline" disabled={isExporting || records.length === 0} className="h-11 gap-2 text-sm">
              <Download className="h-4 w-4" />
              {isExporting ? "导出中..." : "导出表格"}
            </Button>
            <Button onClick={() => fileInputRef.current?.click()} variant="outline" disabled={isImporting} className="h-11 gap-2 text-sm">
              <Upload className="h-4 w-4" />
              {isImporting ? "导入中..." : "导入表格"}
            </Button>
          </div>

          {!showConfirm ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={records.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                清除所有数据
              </button>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
              <p className="text-xs text-muted-foreground">会清空云端全部记录，导入备份前请确认。</p>
              <div className="mt-3 flex justify-end gap-2">
                <Button onClick={() => setShowConfirm(false)} variant="ghost" className="h-8 px-3 text-xs">
                  取消
                </Button>
                <Button onClick={handleClear} variant="destructive" className="h-8 px-3 text-xs">
                  确认清除
                </Button>
              </div>
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium text-muted-foreground">记录列表</h2>
            <span className="text-xs text-muted-foreground">共 {sortedRecords.length} 条</span>
          </div>

          <div className="max-h-[50vh] divide-y divide-border overflow-y-auto">
            {isLoading && sortedRecords.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
            ) : sortedRecords.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">暂无记录</div>
            ) : (
              sortedRecords.map((record) => (
                <div key={record.id} className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
                  <div className="flex flex-1 items-center gap-3">
                    <div
                      className={`
                        flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold
                        ${
                          record.category === "锻炼"
                            ? "bg-orange-100 text-orange-600"
                            : record.duration >= 2
                              ? "bg-[#009360] text-white"
                              : "bg-teal-100 text-teal-700"
                        }
                      `}
                    >
                      {record.category === "锻炼" ? record.duration : `x${record.duration}`}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{record.category}</div>
                      <div className="text-xs text-muted-foreground">
                        {record.date.replace(/-/g, "/")} {formatTime(record.timestamp)}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleEditClick(record)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteRecord(record.id)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive active:scale-90"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <SuccessToast message={toast.message} isVisible={toast.visible} />

      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h3 className="text-lg font-bold text-foreground">编辑记录</h3>
              <button onClick={() => setEditingRecord(null)} className="rounded-lg p-2 transition-colors hover:bg-muted">
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">类型</label>
                <div className="rounded-lg bg-muted px-3 py-2 font-medium text-foreground">{editingRecord.category}</div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">日期</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(event) => setEditDate(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-muted-foreground">
                  {editingRecord.category === "锻炼" ? "时长（分钟）" : "次数"}
                </label>
                <input
                  type="number"
                  value={editDuration}
                  onChange={(event) => setEditDuration(event.target.value)}
                  min="1"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="flex gap-3 p-4">
              <Button onClick={() => setEditingRecord(null)} variant="outline" className="flex-1">
                取消
              </Button>
              <Button onClick={handleEditSave} className="flex-1">
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  )
}
