import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it, mock } from "bun:test";

function worker(offline = false) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const addAll = mock(async (_paths: string[]) => undefined);
  const open = mock(async () => ({ addAll }));
  const cached = mock(async () => new Response("Generic offline page"));
  const fetcher = mock(async (_request: Request) => {
    if (offline) throw new Error("Offline fixture");
    return new Response("Private server-rendered content");
  });
  const openWindow = mock(async (_url: string) => undefined);
  new Script(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8")).runInNewContext({
    URL,
    Response,
    Promise,
    fetch: fetcher,
    caches: { open, match: cached, keys: async () => [], delete: async () => true },
    self: {
      location: { origin: "https://fixture.test" },
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) =>
        handlers.set(name, handler),
      registration: { showNotification: async () => undefined },
      clients: { matchAll: async () => [], openWindow },
    },
  });
  return { handlers, addAll, open, cached, fetcher, openWindow };
}

describe("PWA offline privacy boundary", () => {
  it("precaches only public shell assets", async () => {
    const w = worker();
    let pending: Promise<unknown> | undefined;
    w.handlers.get("install")!({
      waitUntil: (work: Promise<unknown>) => {
        pending = work;
      },
    });
    await pending;
    expect(w.addAll).toHaveBeenCalledWith(["/offline.html", "/icon-192.png"]);
  });

  it("leaves API requests and non-GET operations outside the offline handler", () => {
    const w = worker();
    const respond = mock();
    for (const request of [
      { method: "GET", mode: "cors", url: "https://fixture.test/api/information-bank" },
      { method: "PATCH", mode: "cors", url: "https://fixture.test/api/auto-apply/settings" },
      { method: "GET", mode: "navigate", url: "https://external.test" },
    ])
      w.handlers.get("fetch")!({ request, respondWith: respond });
    expect(respond).not.toHaveBeenCalled();
    expect(w.open).not.toHaveBeenCalled();
  });

  it("never writes a private navigation response to the cache", async () => {
    const w = worker();
    let pending: Promise<Response> | undefined;
    w.handlers.get("fetch")!({
      request: { method: "GET", mode: "navigate", url: "https://fixture.test/settings/auto-apply" },
      respondWith: (work: Promise<Response>) => {
        pending = work;
      },
    });
    expect(await (await pending)!.text()).toBe("Private server-rendered content");
    expect(w.open).not.toHaveBeenCalled();
    expect(w.cached).not.toHaveBeenCalled();
  });

  it("falls back to a generic page when navigation is offline", async () => {
    const w = worker(true);
    let pending: Promise<Response> | undefined;
    w.handlers.get("fetch")!({
      request: { method: "GET", mode: "navigate", url: "https://fixture.test/resumes/private" },
      respondWith: (work: Promise<Response>) => {
        pending = work;
      },
    });
    expect(await (await pending)!.text()).toBe("Generic offline page");
    expect(w.cached).toHaveBeenCalledWith("/offline.html");
    expect(w.open).not.toHaveBeenCalled();
  });

  it("keeps notification navigation on the app origin", async () => {
    const w = worker();
    let pending: Promise<unknown> | undefined;
    w.handlers.get("notificationclick")!({
      notification: { close: mock(), data: { url: "https://external.test/unsafe" } },
      waitUntil: (work: Promise<unknown>) => {
        pending = work;
      },
    });
    await pending;
    expect(w.openWindow).toHaveBeenCalledWith("/pilot");
  });

  it("handles a malformed notification URL without breaking navigation", async () => {
    const w = worker();
    let pending: Promise<unknown> | undefined;
    w.handlers.get("notificationclick")!({
      notification: { close: mock(), data: { url: "https://[malformed" } },
      waitUntil: (work: Promise<unknown>) => {
        pending = work;
      },
    });
    await pending;
    expect(w.openWindow).toHaveBeenCalledWith("/pilot");
  });
});
