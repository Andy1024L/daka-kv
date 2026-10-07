import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { webcrypto, createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const compile = (file) => ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const storageSource = compile("lib/storage.ts")
const apiSource = compile("lib/workouts-api.ts")
const edgeSource = compile("edge-functions/api/records/index.js")
const legacySource = compile("app/api/records/[id]/route.ts")
const cookie = "daka_auth=" + createHash("sha256").update("test-password:test-secret").digest("hex")
const workout = { id: "workout-1", date: "2026-09-27", timestamp: 100, category: "锻炼", duration: 120 }
const stretch = { id: "stretch-1", date: "2026-09-26", timestamp: 200, category: "拉伸", duration: 1 }
const copy = (value) => JSON.parse(JSON.stringify(value))

function evaluate(source, context, imports = {}) {
  const compiledModule = { exports: {} }
  vm.runInNewContext(source, { ...context, module: compiledModule, exports: compiledModule.exports, require: (name) => {
    if (imports[name]) return imports[name]
    throw new Error("Unexpected test import: " + name)
  } })
  return compiledModule.exports
}

function server(initial = []) {
  const values = new Map([["workouts_all", copy(initial)]])
  const kv = {
    get: async (key) => copy(values.get(key) ?? null),
    put: async (key, value) => { values.set(key, JSON.parse(value)) },
    delete: async (key) => { values.delete(key) },
  }
  const handlers = evaluate(edgeSource, { Response, Request, TextEncoder, crypto: webcrypto })
  const env = { APP_PASSWORD: "test-password", AUTH_SECRET: "test-secret", WORKOUT_KV: kv }
  const requests = []
  const request = async (url, init = {}, params = {}) => {
    requests.push({ url: String(url), method: init.method || "GET", body: init.body })
    const method = (init.method || "GET").toLowerCase()
    const handler = handlers["onRequest" + method[0].toUpperCase() + method.slice(1)]
    return handler({ request: new Request(new URL(url, "https://app.example"), init), env, params })
  }
  return { request, requests, records: () => copy(values.get("workouts_all") ?? []), setRecords: (next) => { values.set("workouts_all", copy(next)) } }
}

function client(remote, initial = [], existingStorage) {
  const values = existingStorage || new Map([["check-in-records", JSON.stringify(initial)]])
  const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  let now = Date.now()
  class Clock extends Date { static now() { return now } }
  const state = { offline: false, staleRead: null, hold: null, redirected: null }
  const window = Object.assign(new EventTarget(), { localStorage, location: { pathname: "/", search: "", replace: (url) => { state.redirected = url } } })
  const context = { window, Event, Date: Clock, crypto: webcrypto, URL, AbortSignal, console }
  const storage = evaluate(storageSource, context)
  const fetch = async (url, init = {}) => {
    if (state.offline) throw new Error("offline")
    if (state.hold) await state.hold(url, init)
    if (!init.method && state.staleRead) return Response.json({ records: state.staleRead })
    return remote.request(url, { ...init, headers: { ...init.headers, cookie } })
  }
  const api = evaluate(apiSource, { ...context, fetch }, { "@/lib/storage": storage })
  return { api, storage, state, values, advance: (ms) => { now += ms } }
}

test("cloud edits replace stale caches without uploading old local records", async () => {
  const remote = server([{ ...workout, duration: 180 }])
  const browser = client(remote, [workout, stretch])
  assert.deepEqual(copy(await browser.api.getWorkouts()), [{ ...workout, duration: 180 }])
  assert.equal(remote.requests.filter((r) => r.method !== "GET").length, 0)
  assert.equal(JSON.parse(browser.values.get("check-in-records-before-sync-v2")).length, 2)
})

test("offline edits persist across restart and retry with the same record ID", async () => {
  const remote = server([workout])
  const browser = client(remote, [workout])
  browser.state.offline = true
  await assert.rejects(browser.api.updateWorkout(workout.id, { duration: 180 }))
  assert.equal(browser.storage.getRecords()[0].duration, 180)
  const restarted = client(remote, [], browser.values)
  assert.equal((await restarted.api.getWorkouts())[0].duration, 180)
  assert.equal(remote.records()[0].id, workout.id)
  assert.equal(restarted.storage.getWorkoutOperations().length, 0)
})

test("offline deletion survives restart and cannot be resurrected by another stale client", async () => {
  const remote = server([stretch])
  const phone = client(remote, [stretch])
  const computer = client(remote, [stretch])
  phone.state.offline = true
  await assert.rejects(phone.api.deleteWorkout(stretch.id))
  assert.equal(phone.storage.getRecords().length, 0)
  const restarted = client(remote, [], phone.values)
  await restarted.api.getWorkouts()
  await computer.api.getWorkouts()
  assert.equal(remote.records().length, 0)
  assert.equal(computer.storage.getRecords().length, 0)
})

test("an older save response cannot clear a newer edit", async () => {
  const remote = server([workout])
  const browser = client(remote, [workout])
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let started
  const firstStarted = new Promise((resolve) => { started = resolve })
  let first = true
  browser.state.hold = async (_url, init) => { if (first && init.method === "POST") { first = false; started(); await gate } }
  const older = browser.api.updateWorkout(workout.id, { duration: 180 })
  await firstStarted
  const newer = browser.api.updateWorkout(workout.id, { duration: 90 })
  release()
  await Promise.all([older, newer])
  assert.equal(remote.records()[0].duration, 90)
  assert.equal(browser.storage.getRecords()[0].duration, 90)
  assert.equal(browser.storage.getWorkoutOperations().filter((op) => !op.syncedAt).length, 0)
})

test("deleting during an in-flight save cannot restore the deleted record", async () => {
  const remote = server([workout])
  const browser = client(remote, [workout])
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let started
  const firstStarted = new Promise((resolve) => { started = resolve })
  let first = true
  browser.state.hold = async (_url, init) => { if (first && init.method === "POST") { first = false; started(); await gate } }
  const saving = browser.api.updateWorkout(workout.id, { duration: 180 })
  await firstStarted
  const deleting = browser.api.deleteWorkout(workout.id)
  release()
  await Promise.all([saving, deleting])
  assert.equal(remote.records().length, 0)
  assert.equal(browser.storage.getRecords().length, 0)
})

test("KV read lag does not undo an acknowledged edit or deletion", async () => {
  const remote = server([workout, stretch])
  const browser = client(remote, [workout, stretch])
  await browser.api.updateWorkout(workout.id, { duration: 180 })
  await browser.api.deleteWorkout(stretch.id)
  browser.state.staleRead = [workout, stretch]
  const lagged = await browser.api.getWorkouts()
  assert.equal(lagged.length, 1)
  assert.equal(lagged[0].duration, 180)
  browser.state.staleRead = null
  await browser.api.getWorkouts()
  assert.equal(browser.storage.getWorkoutOperations().length, 0)
  remote.setRecords([{ ...workout, duration: 60 }])
  assert.equal((await browser.api.getWorkouts())[0].duration, 60)
})

test("a cloud read started before a new check-in cannot remove that check-in", async () => {
  const remote = server([workout])
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let started
  const readStarted = new Promise((resolve) => { started = resolve })
  let first = true
  const delayed = { request: async (url, init) => {
    const response = await remote.request(url, init)
    if (first && !init.method) { first = false; started(); await gate }
    return response
  } }
  const browser = client(delayed, [workout])
  const loading = browser.api.getWorkouts()
  await readStarted
  await browser.api.createWorkout(stretch)
  release()
  const loaded = await loading
  assert.equal(loaded.length, 2)
  assert.equal(browser.storage.getRecords().length, 2)
})

test("acknowledged overlays expire so later cloud edits can replace them", async () => {
  const remote = server([workout])
  const browser = client(remote, [workout])
  await browser.api.updateWorkout(workout.id, { duration: 180 })
  browser.state.staleRead = [workout]
  assert.equal((await browser.api.getWorkouts())[0].duration, 180)
  browser.advance(66_000)
  browser.state.staleRead = [{ ...workout, duration: 60 }]
  assert.equal((await browser.api.getWorkouts())[0].duration, 60)
  assert.equal(browser.storage.getWorkoutOperations().length, 0)
})

test("old pending additions migrate once and are not duplicated", async () => {
  const remote = server([])
  const browser = client(remote, [stretch])
  browser.values.set("check-in-records-pending-sync", JSON.stringify([stretch]))
  await browser.api.getWorkouts()
  await browser.api.getWorkouts()
  assert.equal(remote.records().length, 1)
  assert.equal(browser.values.has("check-in-records-pending-sync"), false)
  assert.equal(remote.requests.filter((r) => r.method === "POST").length, 1)
})

test("offline clear followed by a new record replays in order", async () => {
  const remote = server([workout])
  const browser = client(remote, [workout])
  browser.state.offline = true
  await assert.rejects(browser.api.clearWorkouts())
  await assert.rejects(browser.api.createWorkout(stretch))
  browser.state.offline = false
  assert.deepEqual(copy(await browser.api.getWorkouts()), [stretch])
  assert.deepEqual(remote.requests.filter((r) => r.method !== "GET").map((r) => r.method), ["DELETE", "POST"])
})

test("root PATCH uses the KV binding, and root DELETE only removes the requested ID", async () => {
  const remote = server([workout, stretch])
  const patch = await remote.request("/api/records", { method: "PATCH", headers: { cookie }, body: JSON.stringify({ id: workout.id, updates: { duration: 180 } }) })
  assert.equal(patch.status, 200)
  assert.equal((await patch.json()).record.duration, 180)
  const deletion = await remote.request("/api/records", { method: "DELETE", headers: { cookie }, body: JSON.stringify({ id: stretch.id }) })
  assert.equal(deletion.status, 200)
  assert.deepEqual(remote.records(), [{ ...workout, duration: 180 }])
  const malformed = await remote.request("/api/records", { method: "DELETE", headers: { cookie }, body: "{" })
  assert.equal(malformed.status, 400)
  assert.equal(remote.records().length, 1)
})

test("legacy dynamic PATCH forwards to the bound Edge Function", async () => {
  const remote = server([workout])
  const route = evaluate(legacySource, { Response, URL, fetch: remote.request })
  const response = await route.PATCH(new Request("https://app.example/api/records/" + workout.id, {
    method: "PATCH", headers: { cookie }, body: JSON.stringify({ duration: 180 }),
  }), { params: Promise.resolve({ id: workout.id }) })
  assert.equal(response.status, 200)
  assert.equal(remote.records()[0].duration, 180)
})

test("unauthenticated mutations leave KV data unchanged", async () => {
  const remote = server([workout])
  for (const method of ["POST", "PATCH", "DELETE"]) {
    const response = await remote.request("/api/records", { method, body: JSON.stringify({ clear: true }) })
    assert.equal(response.status, 401)
  }
  assert.deepEqual(remote.records(), [workout])
})

test("an old client cannot re-upload a record deleted on another device", async () => {
  const remote = server([workout, stretch])
  await remote.request("/api/records", { method: "DELETE", headers: { cookie }, body: JSON.stringify({ id: stretch.id }) })
  const oldUpload = await remote.request("/api/records", { method: "POST", headers: { cookie }, body: JSON.stringify({ records: [stretch] }) })
  assert.equal(oldUpload.status, 409)
  assert.deepEqual(remote.records(), [workout])
  const stalePhone = client(remote, [workout, stretch])
  stalePhone.state.offline = true
  await assert.rejects(stalePhone.api.updateWorkout(stretch.id, { date: "2026-09-23" }))
  stalePhone.state.offline = false
  assert.deepEqual(copy(await stalePhone.api.getWorkouts()), [workout])
  assert.equal(stalePhone.storage.getWorkoutOperations().length, 0)
})

test("an expired login redirects while preserving queued changes", async () => {
  const remote = server([workout])
  const unauthenticated = { request: (_url, init) => remote.request(_url, { ...init, headers: {} }) }
  const browser = client(unauthenticated, [workout])
  await assert.rejects(browser.api.updateWorkout(workout.id, { duration: 180 }))
  assert.match(browser.state.redirected, /^\/login\?next=/)
  assert.equal(browser.storage.getRecords()[0].duration, 180)
  assert.equal(browser.storage.getWorkoutOperations().filter((op) => !op.syncedAt).length, 1)
})
