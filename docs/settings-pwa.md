# Settings UI and installable PWA

`/settings/auto-apply` edits the versioned preferences API. Save uses the last loaded version;
a 409 retains the draft and asks the user to reload explicitly. Cancel reverts the last saved
snapshot. The history shows server-recorded versions and changed fields. A dirty indicator and
the existing unload guard cover unsaved work; Next App Router navigation is not intercepted.

The execution banner and runtime chips show the enforced DRY_RUN boundary. Saving a preference
does not activate a worker or start a schedule. Daily quota accounting, approved-resume actions,
and the policy preview are separate milestones, so this screen does not invent daily counts.

The manifest preserves the existing root application identity and scope, opens settings, and
uses the existing scalable/raster icons and Apple metadata. Install from Safari's Share → Add
to Home Screen on iPhone, or the browser's install action on desktop. Installation requires a
secure origin (HTTPS, with localhost allowed for development). It installs the web app only.

Service-worker registration is independent of push permission. Only `/offline.html` and the
public icon are precached. Private HTML, API responses, resumes, answers, and credentials are
never written to Cache Storage. Offline navigation receives a generic reconnect page. Worker
updates do not force a reload while a form may be dirty. Notification links are confined to the
app origin, including malformed and external URL cases. There is no offline mutation queue.

Validation uses a synthetic loopback API, not a production service or account. Browser requests
are confined to the fixture frontend/API; terminal connections are blocked. Desktop (1280×900)
and phone (390×844) Chromium tests cover saves, reverts, stale conflicts, validation, responsive
width, and offline cache contents. This is not a physical iPhone/Safari installation test. The
fixture font responses avoid public font downloads. Test data and artifacts contain no real
applicant content. CI runs these checks on stacked PRs as well as PRs targeting main.

No deployment, installed-worker update, n8n mutation, unrestricted agent launch, or application
submission is part of this change. The PWA becomes available to an installation only after a
separately authorized release; merging a PR alone does not install it.
