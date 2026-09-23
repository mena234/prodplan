export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export async function readBody(
  request: Pick<Request, "body">,
  limit = 2_000_000,
) {
  if (!request.body) return "";
  const reader = request.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    result = "",
    oversized = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        // Drain without retaining additional bytes. Cancelling a Vinext request's
        // bridged stream can tear down the Worker before its response is sent.
        oversized = true;
        continue;
      }
      result += decoder.decode(value, { stream: true });
    }
    if (oversized)
      throw new HttpError(
        413,
        "This request is too large. Import up to 200 orders at a time.",
      );
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
export async function discardBody(request: Request) {
  await readBody(request).catch(() => undefined);
}
export async function readJson(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("application/json")) {
    await discardBody(request);
    throw new HttpError(415, "Send application/json.");
  }
  const raw = await readBody(request);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "The submitted data is not valid JSON.");
  }
}
export async function requireOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin) {
    await discardBody(request);
    throw new HttpError(403, "This request did not come from ProdPlan.");
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return Response.json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      { status: error.status },
    );
  console.error(
    "Platform request failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return Response.json(
    { error: "The change could not be saved. Please try again." },
    { status: 500 },
  );
}
