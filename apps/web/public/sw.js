// Plain service worker (served from /sw.js, not bundled). Renders Pilot web-push
// notifications and routes clicks. Payload is JSON { title, body, url?, tag? }.

const SHELL_CACHE = "jobpilot-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/offline.html", "/icon-192.png"])),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("jobpilot-shell-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  // Never cache authenticated HTML, API responses, resumes, or answers.
  event.respondWith(
    fetch(event.request).catch(
      async () => (await caches.match("/offline.html")) || Response.error(),
    ),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }
  const title = payload.title || "JobPilot";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      // PNGs, not the manifest SVG: Android/Chrome don't render SVG notification icons.
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: payload.tag,
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = "/pilot";
  try {
    const requested = new URL(event.notification.data?.url || "/pilot", self.location.origin);
    if (requested.origin === self.location.origin) target = requested.pathname + requested.search;
  } catch {
    // A malformed push URL must still open the app safely.
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url === new URL(target, self.location.origin).href && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
