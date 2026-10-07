const WORKOUTS_KEY = "workouts_all"
const DELETED_IDS_KEY = "workouts_deleted"
const AUTH_COOKIE = "daka_auth"

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  })
}

function getKv(context) {
  const env = getRuntimeEnv(context)
  const names = [env.EDGEONE_KV_BINDING_NAME, "WORKOUT_KV", "workout_kv", "my_kv"].filter(Boolean)
  for (const name of names) {
    const binding = env[name] || globalThis[name]
    if (binding && typeof binding.get === "function" && typeof binding.put === "function") return binding
  }
  return null
}

function getRuntimeEnv(context) {
  return context?.env || {}
}

async function sha256(value) {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || ""
  const cookies = cookieHeader.split(";").map((item) => item.trim())
  const cookie = cookies.find((item) => item.startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : ""
}

async function assertAuthenticated(request, context) {
  const runtimeEnv = getRuntimeEnv(context)
  const password = runtimeEnv.APP_PASSWORD
  const secret = runtimeEnv.AUTH_SECRET

  if (!password || !secret) {
    return json({ error: "密码环境变量还没有配置" }, { status: 500 })
  }

  const expectedToken = await sha256(`${password}:${secret}`)
  if (getCookie(request, AUTH_COOKIE) !== expectedToken) {
    return json({ error: "请先登录" }, { status: 401 })
  }

  return null
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object") return null

  const category = value.category === "锻炼" || value.category === "拉伸" ? value.category : null
  const duration = Number(value.duration)
  const timestamp = Number(value.timestamp)
  const date = typeof value.date === "string" ? value.date : ""
  const id = typeof value.id === "string" ? value.id : ""

  if (!id || !category || !date || Number.isNaN(duration) || duration <= 0 || Number.isNaN(timestamp)) {
    return null
  }

  return { id, timestamp, date, category, duration }
}

function mergeRecords(...recordLists) {
  const recordsById = new Map()

  for (const records of recordLists) {
    for (const record of records) {
      const normalized = normalizeRecord(record)
      if (normalized) recordsById.set(normalized.id, normalized)
    }
  }

  return [...recordsById.values()].sort((a, b) => b.timestamp - a.timestamp)
}

async function getWorkouts(kv) {
  const [rawRecords, deletedIds] = await Promise.all([kv.get(WORKOUTS_KEY, { type: "json" }), getDeletedIds(kv)])
  if (!Array.isArray(rawRecords)) return []
  const deleted = new Set(deletedIds)
  return mergeRecords(rawRecords).filter((record) => !deleted.has(record.id))
}

async function getDeletedIds(kv) {
  const value = await kv.get(DELETED_IDS_KEY, { type: "json" })
  return Array.isArray(value) ? value.filter((id) => typeof id === "string") : []
}

async function markDeleted(kv, ids) {
  await kv.put(DELETED_IDS_KEY, JSON.stringify([...new Set([...(await getDeletedIds(kv)), ...ids])]))
}

async function saveWorkouts(kv, records) {
  const cleanRecords = mergeRecords(records)
  await kv.put(WORKOUTS_KEY, JSON.stringify(cleanRecords))
  return cleanRecords
}

function requireKv(context) {
  const kv = getKv(context)
  if (!kv) throw new Error("EdgeOne KV 还没有绑定，请绑定变量 WORKOUT_KV")
  return kv
}

export async function onRequestGet(context) {
  const { request } = context
  const authError = await assertAuthenticated(request, context)
  if (authError) return authError

  try {
    const kv = requireKv(context)
    return json({ records: await getWorkouts(kv), deletedIds: await getDeletedIds(kv) })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "读取失败" }, { status: 503 })
  }
}

export async function onRequestPost(context) {
  const { request } = context
  const authError = await assertAuthenticated(request, context)
  if (authError) return authError

  try {
    const kv = requireKv(context)
    const body = await request.json().catch(() => null)
    const recordsInput = Array.isArray(body?.records) ? body.records : [body]
    const records = recordsInput.map(normalizeRecord).filter(Boolean)

    if (records.length === 0) {
      return json({ error: "没有有效记录" }, { status: 400 })
    }
    const deleted = new Set(await getDeletedIds(kv))
    const deletedIds = records.filter((record) => deleted.has(record.id)).map((record) => record.id)
    const validRecords = records.filter((record) => !deleted.has(record.id))
    if (validRecords.length === 0) return json({ error: "记录已在其他设备删除", deletedIds }, { status: 409 })
    return json({ records: await saveWorkouts(kv, mergeRecords(await getWorkouts(kv), validRecords)), deletedIds })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 })
  }
}

export async function onRequestDelete(context) {
  const { request } = context
  const authError = await assertAuthenticated(request, context)
  if (authError) return authError

  try {
    const kv = requireKv(context)
    const rawBody = await request.text()
    let body = null
    if (rawBody) {
      try { body = JSON.parse(rawBody) } catch { return json({ error: "请求格式异常" }, { status: 400 }) }
    }
    const id = context.params?.id || body?.id
    if (typeof id === "string" && id) {
      await markDeleted(kv, [id])
      await saveWorkouts(kv, (await getWorkouts(kv)).filter((record) => record.id !== id))
    } else if (body === null || body?.clear === true) {
      await markDeleted(kv, (await getWorkouts(kv)).map((record) => record.id))
      await kv.delete(WORKOUTS_KEY)
    } else {
      return json({ error: "没有有效记录" }, { status: 400 })
    }
    return json({ ok: true })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "清除失败" }, { status: 500 })
  }
}

export async function onRequestPatch(context) {
  const { request } = context
  const authError = await assertAuthenticated(request, context)
  if (authError) return authError

  try {
    const kv = requireKv(context)
    const body = await request.json().catch(() => null)
    const id = context.params?.id || body?.id
    const updates = body?.updates || body
    if (typeof id !== "string" || !id || (!updates?.date && !(updates?.duration > 0))) {
      return json({ error: "没有有效更新" }, { status: 400 })
    }
    const records = await getWorkouts(kv)
    const previous = records.find((record) => record.id === id)
    if (!previous) return json({ error: "记录不存在" }, { status: 404 })
    const record = normalizeRecord({
      ...previous,
      date: typeof updates.date === "string" ? updates.date : previous.date,
      duration: typeof updates.duration === "number" ? updates.duration : previous.duration,
    })
    if (!record) return json({ error: "没有有效更新" }, { status: 400 })
    await saveWorkouts(kv, mergeRecords(records, [record]))
    return json({ record })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 500 })
  }
}
