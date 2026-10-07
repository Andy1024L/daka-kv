"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"
import { APP_UPDATED_AT, APP_VERSION } from "@/lib/app-version"

type VersionInfo = {
  version?: string
  updatedAt?: string
}

type UpdateState = "idle" | "checking" | "current" | "found" | "downloading" | "applying" | "complete" | "error"

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function waitForState(worker: ServiceWorker, state: ServiceWorkerState) {
  if (worker.state === state) return Promise.resolve()

  return new Promise<void>((resolve) => {
    worker.addEventListener("statechange", () => {
      if (worker.state === state) resolve()
    })
  })
}

async function activateWaitingWorker(registration: ServiceWorkerRegistration) {
  const waitingWorker = registration.waiting ?? registration.installing

  if (!waitingWorker) return false

  if (waitingWorker.state !== "installed") {
    await waitForState(waitingWorker, "installed")
  }

  waitingWorker.postMessage({ type: "ACTIVATE_UPDATE" })
  return true
}

async function reloadFreshAppShell() {
  if ("caches" in window) {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
  }

  const registration = await navigator.serviceWorker?.getRegistration()
  await registration?.unregister()

  const nextUrl = new URL(window.location.href)
  nextUrl.searchParams.set("__app_update", String(Date.now()))
  window.location.replace(nextUrl.toString())
}

async function updateCachedApp(onStateChange: (state: UpdateState) => void) {
  if (!("serviceWorker" in navigator)) {
    onStateChange("complete")
    await delay(900)
    await reloadFreshAppShell()
    return
  }

  let hasReloaded = false
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasReloaded) return
    hasReloaded = true
    onStateChange("complete")
    window.setTimeout(() => {
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set("__app_update", String(Date.now()))
      window.location.replace(nextUrl.toString())
    }, 900)
  })

  onStateChange("downloading")
  const registration =
    (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"))
  await registration.update()

  onStateChange("applying")
  const activated = await activateWaitingWorker(registration)

  if (!activated) {
    onStateChange("complete")
    await delay(900)
    await reloadFreshAppShell()
  }
}

export function AppUpdateControl() {
  const [state, setState] = useState<UpdateState>("idle")
  const [latestUpdatedAt, setLatestUpdatedAt] = useState<string | null>(null)

  const checkUpdate = async () => {
    if (state === "checking" || state === "downloading" || state === "applying" || state === "complete") return

    setState("checking")
    setLatestUpdatedAt(null)

    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error("更新信息读取失败")
      const latest = (await response.json()) as VersionInfo
      if (!latest.version) throw new Error("更新信息格式异常")
      setLatestUpdatedAt(latest.updatedAt ?? null)

      if (latest.version === APP_VERSION) {
        setState("current")
        return
      }

      setState("found")
      await delay(900)
      await updateCachedApp(setState)
    } catch {
      setState("error")
    }
  }

  const statusText =
    state === "checking"
      ? "正在检查更新..."
      : state === "current"
        ? "已是最新版本"
        : state === "found"
          ? "发现新版，正在准备更新..."
          : state === "downloading"
            ? "正在下载更新..."
            : state === "applying"
              ? "正在应用更新..."
              : state === "complete"
                ? "更新完成，正在重启..."
                : state === "error"
                  ? "检查失败，请稍后重试"
                  : null

  const buttonText = state === "idle" ? "检查更新" : state === "current" || state === "error" ? "重新检查" : "更新中..."
  const isBusy = state === "checking" || state === "found" || state === "downloading" || state === "applying" || state === "complete"
  const progress =
    state === "checking"
      ? 25
      : state === "found"
        ? 40
        : state === "downloading"
          ? 65
          : state === "applying"
            ? 85
            : state === "complete"
              ? 100
              : state === "current"
                ? 100
                : state === "error"
                  ? 100
                  : 0

  return (
    <div className="flex flex-col items-center gap-1 pt-1">
      {statusText && (
        <div className="w-full max-w-xs space-y-1 px-4">
          <p className="text-center text-[11px] leading-4 text-muted-foreground">
            最近更新：{latestUpdatedAt ?? APP_UPDATED_AT} · {statusText}
          </p>
          {progress > 0 && isBusy && (
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-muted-foreground/45 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={checkUpdate}
        disabled={isBusy}
        className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-60"
      >
        <RefreshCw className={`h-3 w-3 ${isBusy ? "animate-spin" : ""}`} />
        {buttonText}
      </button>
    </div>
  )
}
