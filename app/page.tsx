"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Dumbbell, Sparkles } from "lucide-react"
import DataPage from "@/app/data/page"
import StatsPage from "@/app/stats/page"
import { type AppTab, AppTabProvider } from "@/components/app-tab-context"
import { AppUpdateControl } from "@/components/app-update-control"
import { BottomNav } from "@/components/bottom-nav"
import { SuccessToast } from "@/components/success-toast"
import { createOptimisticWorkout, createWorkout, getWorkouts, WORKOUTS_CHANGED_EVENT } from "@/lib/workouts-api"
import { formatLocalDate, getDailyStats, getRecords, getWorkoutOperations, mergeRecordLists, reloadStoredRecords } from "@/lib/storage"
import type { CheckInRecord } from "@/types"

const weekDayLabels = ["一", "二", "三", "四", "五", "六", "日"]

function getMonday(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7))
  return result
}

function getWeekDays(start: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function RecentWeeks({ records, kind }: { records: CheckInRecord[]; kind: "workout" | "stretch" }) {
  const dailyStats = useMemo(() => getDailyStats(records), [records])
  const today = new Date()
  const thisWeekStart = getMonday(today)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(thisWeekStart.getDate() - 7)
  const twoWeeksAgoStart = new Date(thisWeekStart)
  twoWeeksAgoStart.setDate(thisWeekStart.getDate() - 14)
  const weeks = [getWeekDays(twoWeeksAgoStart), getWeekDays(lastWeekStart), getWeekDays(thisWeekStart)]
  const isWorkout = kind === "workout"

  const getValue = (date: Date) => {
    const stats = dailyStats.get(formatLocalDate(date))
    return isWorkout ? (stats?.workout ?? 0) : (stats?.stretch ?? 0)
  }

  const getCellClass = (value: number, isToday: boolean) => {
    if (isWorkout) {
      if (value >= 120) return "bg-red-500 text-white"
      if (value >= 90) return "bg-orange-400 text-white"
      if (value >= 60) return "bg-orange-300 text-white"
      if (value >= 30) return "bg-orange-200 text-white"
      if (value > 0) return "bg-orange-100 text-orange-800"
    } else if (value >= 2) {
      return "bg-[#009360] text-white"
    } else if (value >= 1) {
      return "bg-teal-100 text-teal-900"
    }

    return isToday
      ? "border-2 border-foreground/45 text-foreground"
      : "border border-dashed border-muted-foreground/25 text-muted-foreground"
  }

  return (
    <div className="mb-3 w-full">
      <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[9px] text-muted-foreground">
        {weekDayLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="space-y-2.5">
        {weeks.map((days) => (
          <div key={formatLocalDate(days[0])} className="grid grid-cols-7 gap-1.5">
            {days.map((date) => {
              const value = getValue(date)
              const isToday = formatLocalDate(date) === formatLocalDate(today)

              return (
                <span
                  key={formatLocalDate(date)}
                  className={`flex aspect-[1.18/1] w-[70%] justify-self-center items-center justify-center rounded-md text-[10px] font-semibold ${getCellClass(value, isToday)}`}
                >
                  {value > 0 ? (isWorkout ? value : `x${value}`) : date.getDate()}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function HomeView({ records, onRecordCreated, syncMessage }: { records: CheckInRecord[]; onRecordCreated: (record: CheckInRecord) => void; syncMessage: string | null }) {
  const [toast, setToast] = useState({ visible: false, message: "" })
  const [animatingButton, setAnimatingButton] = useState<string | null>(null)

  const showToast = useCallback((message: string) => {
    setToast({ visible: true, message })
    window.setTimeout(() => setToast({ visible: false, message: "" }), 2000)
  }, [])

  const handleWorkoutCheckIn = useCallback(
    (duration: number) => {
      const record = createOptimisticWorkout("锻炼", duration)
      onRecordCreated(record)
      setAnimatingButton(`workout-${duration}`)
      window.setTimeout(() => setAnimatingButton(null), 600)
      showToast(`锻炼 ${duration} 分钟`)

      createWorkout(record).catch(() => {
        showToast("已保存到本机，联网后会自动同步")
      })
    },
    [onRecordCreated, showToast]
  )

  const handleStretchCheckIn = useCallback(
    (count: 1) => {
      const record = createOptimisticWorkout("拉伸", count)
      onRecordCreated(record)
      setAnimatingButton(`stretch-${count}`)
      window.setTimeout(() => setAnimatingButton(null), 600)
      showToast(`拉伸 x${count}`)

      createWorkout(record).catch(() => {
        showToast("已保存到本机，联网后会自动同步")
      })
    },
    [onRecordCreated, showToast]
  )

  const WorkoutButton = ({ duration }: { duration: number }) => {
    const isAnimating = animatingButton === `workout-${duration}`
    const colorClass =
      duration >= 120
        ? "bg-gradient-to-br from-red-500 to-rose-600"
        : duration >= 90
          ? "bg-gradient-to-br from-orange-500 to-rose-500"
          : duration >= 60
            ? "bg-gradient-to-br from-orange-400 to-orange-500"
            : "bg-gradient-to-br from-orange-300 to-orange-400"

    return (
      <button
        onClick={() => handleWorkoutCheckIn(duration)}
        className={`relative h-14 overflow-hidden rounded-xl ${colorClass} flex flex-col items-center justify-center text-white font-semibold shadow-sm transition-all duration-200 hover:scale-[1.02] active:scale-95 ${
          isAnimating ? "ring-4 ring-white/50" : ""
        }`}
      >
        <span className="text-xl font-bold">{duration}</span>
        <span className="text-[10px] opacity-80">分钟</span>
        {isAnimating && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/20">
            <Check className="h-7 w-7 animate-bounce text-white" />
          </div>
        )}
      </button>
    )
  }

  const StretchButton = ({ count }: { count: 1 }) => {
    const isAnimating = animatingButton === `stretch-${count}`

    return (
      <button
        onClick={() => handleStretchCheckIn(count)}
        className={`relative h-14 w-full overflow-hidden rounded-xl bg-gradient-to-br from-teal-400 to-teal-500 text-white font-semibold shadow-sm transition-all duration-200 hover:scale-[1.01] active:scale-95 ${
          isAnimating ? "ring-4 ring-white/50" : ""
        }`}
      >
        <span className="text-2xl font-bold">x{count}</span>
        {isAnimating && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/20">
            <Check className="h-7 w-7 animate-bounce text-white" />
          </div>
        )}
      </button>
    )
  }

  return (
    <main className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-lg">
        <div className="mx-auto max-w-md px-4 py-3">
          <h1 className="text-center text-xl font-bold text-foreground">每日打卡</h1>
        </div>
      </header>

      <div className="mx-auto w-full max-w-md space-y-3 px-2.5 py-3">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-2.5 flex items-center justify-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100">
              <Dumbbell className="h-5 w-5 text-orange-600" />
            </div>
            <h2 className="text-base font-bold text-foreground">锻炼</h2>
          </div>
          <RecentWeeks records={records} kind="workout" />
          <div className="grid grid-cols-4 gap-2">
            <WorkoutButton duration={30} />
            <WorkoutButton duration={60} />
            <WorkoutButton duration={90} />
            <WorkoutButton duration={120} />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-2.5 flex items-center justify-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100">
              <Sparkles className="h-5 w-5 text-teal-600" />
            </div>
            <h2 className="text-base font-bold text-foreground">拉伸</h2>
          </div>
          <RecentWeeks records={records} kind="stretch" />
          <div className="w-full">
            <StretchButton count={1} />
          </div>
        </section>

        <div>
          {syncMessage && <p role="status" className="text-center text-[11px] text-muted-foreground">{syncMessage}</p>}
          <AppUpdateControl />
        </div>
      </div>

      <SuccessToast message={toast.message} isVisible={toast.visible} />
      <BottomNav />
    </main>
  )
}

export default function HomePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [activeTab, setActiveTab] = useState<AppTab>("home")
  const [records, setRecords] = useState<CheckInRecord[]>(() => getRecords())
  const [syncMessage, setSyncMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          window.location.replace("/login?next=/")
          return
        }
        setIsAuthenticated(true)
      })
      .catch(() => {
        if (getRecords().length > 0) setIsAuthenticated(true)
        else window.location.replace("/login?next=/")
      })
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return

    let isMounted = true

    const updateLocal = () => {
      if (isMounted) setRecords(getRecords())
    }
    const refresh = () => {
      if (document.visibilityState === "hidden") return
      getWorkouts()
        .then(() => {
          if (!isMounted) return
          setRecords(getRecords())
          setSyncMessage(getWorkoutOperations().some((operation) => !operation.syncedAt) ? "有修改待同步，联网后会自动重试" : null)
        })
        .catch(() => {
          if (!isMounted) return
          setRecords(getRecords())
          setSyncMessage("同步暂未完成，本机数据已保留")
        })
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith("check-in-records")) setRecords(reloadStoredRecords())
    }
    refresh()
    window.addEventListener(WORKOUTS_CHANGED_EVENT, updateLocal)
    window.addEventListener("online", refresh)
    window.addEventListener("focus", refresh)
    window.addEventListener("storage", onStorage)
    document.addEventListener("visibilitychange", refresh)
    const timer = window.setInterval(refresh, 30_000)

    return () => {
      isMounted = false
      window.removeEventListener(WORKOUTS_CHANGED_EVENT, updateLocal)
      window.removeEventListener("online", refresh)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("storage", onStorage)
      document.removeEventListener("visibilitychange", refresh)
      window.clearInterval(timer)
    }
  }, [isAuthenticated])

  const handleRecordCreated = useCallback((record: CheckInRecord) => {
    setRecords((current) => mergeRecordLists([record], current))
  }, [])

  if (!isAuthenticated) return <main className="min-h-[100dvh] bg-background" />

  return (
    <AppTabProvider value={{ activeTab, setActiveTab }}>
      {activeTab === "home" ? (
        <HomeView records={records} onRecordCreated={handleRecordCreated} syncMessage={syncMessage} />
      ) : activeTab === "stats" ? (
        <StatsPage records={records} />
      ) : (
        <DataPage records={records} onRecordsChange={setRecords} />
      )}
    </AppTabProvider>
  )
}
