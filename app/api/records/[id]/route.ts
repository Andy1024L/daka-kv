export const dynamic = "force-dynamic"

interface Params {
  params: Promise<{ id: string }>
}

// EdgeOne routes some dynamic paths through Next.js, where KV globals are absent.
// Forward legacy clients to the static Edge Function that owns the KV binding.
async function forwardOperation(request: Request, id: string, method: "PATCH" | "DELETE") {
  const updates = method === "PATCH" ? await request.json().catch(() => null) : null
  if (method === "PATCH" && (!updates || typeof updates !== "object")) {
    return Response.json({ error: "没有有效更新" }, { status: 400 })
  }
  const response = await fetch(new URL("/api/records", request.url), {
    method,
    cache: "no-store",
    redirect: "manual",
    headers: { "Content-Type": "application/json", cookie: request.headers.get("cookie") ?? "" },
    body: JSON.stringify(method === "PATCH" ? { id, updates } : { id }),
  })
  return new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  })
}

export async function PATCH(request: Request, { params }: Params) {
  return forwardOperation(request, (await params).id, "PATCH")
}

export async function DELETE(request: Request, { params }: Params) {
  return forwardOperation(request, (await params).id, "DELETE")
}
