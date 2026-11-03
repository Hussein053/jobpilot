import { badRequest } from "@/common/errors";

export async function readBoundedBody(request: Request, limit: number) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" ||
    (request.headers.get("content-encoding") ?? "identity") !== "identity"
  )
    throw badRequest("Use uncompressed application/json");
  const reader = request.body?.getReader();
  if (!reader) throw badRequest("Missing batch");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw badRequest(`Batch exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
