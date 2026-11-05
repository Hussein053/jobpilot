"""Start an expiring synthetic preview on an ephemeral public Actions runner."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import traceback
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path.cwd()
PRIVATE = Path('/tmp/jobpilot-preview')
PRIVATE.mkdir(mode=0o700, exist_ok=True)
os.chmod(PRIVATE, 0o700)
ARTIFACT = ROOT / 'preview-artifact'
ARTIFACT.mkdir(exist_ok=True)
STATE = PRIVATE / 'gateway-state.json'
ENV = os.environ.copy()
ENV.update({
    'NODE_ENV': 'development', 'PORT': '4101',
    'DATABASE_URL': 'postgresql://jobpilot_fixture:local_synthetic_only@127.0.0.1:15432/jobpilot_mvp_local',
    'SECRET_MASTER_KEY': base64.b64encode(os.urandom(32)).decode(),
    'STORAGE_ROOT': str(PRIVATE / 'storage'), 'APP_URL': 'http://127.0.0.1:4100',
    'CORS_ORIGINS': 'http://127.0.0.1:4100', 'LOG_LEVEL': 'warn',
    'NEXT_TELEMETRY_DISABLED': '1',
    'NEXT_FONT_GOOGLE_MOCKED_RESPONSES': str(ROOT / 'apps/web/e2e/font-responses.cjs'),
    'INTERNAL_API_URL': 'http://127.0.0.1:4101',
    'JOBPILOT_PREVIEW_STATE': str(STATE),
    'PLAYWRIGHT_BROWSERS_PATH': str(Path.home() / '.cache/ms-playwright'),
})
# No external-provider or mail credentials enter this synthetic server.
for key in ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'RESEND_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']:
    ENV[key] = ''
children = []

def run(args, folder='apps/api', log='command-private.log', env=None):
    with open(PRIVATE / log, 'w') as stream:
        os.chmod(PRIVATE / log, 0o600)
        result = subprocess.run(args, cwd=ROOT / folder, env=env or ENV, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'Preview command failed ({log}); no unverified URL will be published')


def start(args, folder, log):
    with open(PRIVATE / log, 'w') as stream:
        os.chmod(PRIVATE / log, 0o600)
        child = subprocess.Popen(args, cwd=ROOT / folder, env=ENV, stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
    children.append(child)
    return child


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'JobPilot-synthetic-preview'})
    with urllib.request.urlopen(req, timeout=15) as response:
        return response.read()


def wait_http(url, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            get(url)
            return
        except (OSError, urllib.error.URLError):
            time.sleep(1)
    raise RuntimeError('Preview service did not become healthy')


try:
    run(['bun', 'run', 'db:generate'], log='generate-private.log')
    run(['bun', 'run', 'db:migrate:apply'], log='migrate-private.log')
    api = start(['bun', 'run', 'src/app.ts'], 'apps/api', 'api-private.log')
    wait_http('http://127.0.0.1:4101/health')
    run(['bun', 'run', 'scripts/dry-run-demo.ts'], log='seed-private.log')
    demo = json.loads(Path('/tmp/jobpilot-mvp/demo.json').read_text())
    os.killpg(api.pid, signal.SIGTERM)
    api.wait(timeout=20)

    release = json.loads(get('https://api.github.com/repos/cloudflare/cloudflared/releases/latest'))
    asset = next(item for item in release['assets'] if item['name'] == 'cloudflared-linux-amd64')
    expected = asset.get('digest', '')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', expected):
        raise RuntimeError('Official tunnel binary lacks a verifiable release digest')
    if not asset['browser_download_url'].startswith('https://github.com/cloudflare/cloudflared/releases/download/'):
        raise RuntimeError('Unexpected tunnel binary release location')
    binary = get(asset['browser_download_url'])
    if 'sha256:' + hashlib.sha256(binary).hexdigest() != expected:
        raise RuntimeError('Tunnel binary integrity verification failed')
    executable = PRIVATE / 'cloudflared'
    executable.write_bytes(binary)
    executable.chmod(0o700)
    start(['bun', 'scripts/preview-gateway.ts'], 'apps/api', 'gateway-private.log')
    start([str(executable), 'tunnel', '--url', 'http://127.0.0.1:4190', '--no-autoupdate', '--protocol', 'http2'], '.', 'tunnel-private.log')
    deadline = time.monotonic() + 90
    origin = None
    while time.monotonic() < deadline:
        found = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', (PRIVATE / 'tunnel-private.log').read_text())
        if found:
            origin = found.group(0)
            break
        time.sleep(1)
    if not origin:
        raise RuntimeError('No free HTTPS tunnel origin was assigned')

    ENV.update({
        'NODE_ENV': 'production', 'APP_URL': origin, 'CORS_ORIGINS': origin,
        'AUTH_OAUTH_REDIRECT_BASE': origin, 'NEXT_PUBLIC_API_URL': origin,
        'NEXT_PUBLIC_TERMINAL_URL': origin + '/terminal-disabled',
        'NEXT_PUBLIC_SYNTHETIC_PREVIEW': '1',
    })
    start(['bun', 'run', 'src/app.ts'], 'apps/api', 'api-production-private.log')
    wait_http('http://127.0.0.1:4101/health')
    policy = json.loads(get('http://127.0.0.1:4101/api/execution/policy', {'Cookie': demo['cookie']}))
    if policy != {'submissionMode': 'DRY_RUN', 'liveSubmissionsEnabled': False, 'unrestrictedAgentsEnabled': False}:
        raise RuntimeError('Required server-owned execution boundary could not be verified')
    login = urllib.request.Request('http://127.0.0.1:4101/api/auth/login', data=json.dumps({'email': demo['email'], 'password': demo['password']}).encode(), headers={'Content-Type': 'application/json', 'Origin': origin})
    with urllib.request.urlopen(login, timeout=15) as response:
        cookie = ';'.join(response.headers.get_all('Set-Cookie') or []).lower()
        if not all(flag in cookie for flag in ['secure', 'httponly', 'samesite=lax']):
            raise RuntimeError('Production secure-session flags could not be verified')
    run(['bun', 'run', 'build'], folder='apps/web', log='build-private.log')
    standalone = ROOT / 'apps/web/.next/standalone/apps/web'
    shutil.copytree(ROOT / 'apps/web/public', standalone / 'public', dirs_exist_ok=True)
    shutil.copytree(ROOT / 'apps/web/.next/static', standalone / '.next/static', dirs_exist_ok=True)
    ENV.update({'HOSTNAME': '127.0.0.1', 'PORT': '4100'})
    start(['node', str(standalone / 'server.js')], '.', 'web-production-private.log')
    wait_http('http://127.0.0.1:4100/login')
    expires_at = time.time() + 4 * 60 * 60
    from datetime import datetime, timezone
    expires = datetime.fromtimestamp(expires_at, timezone.utc).isoformat().replace('+00:00', 'Z')
    STATE.write_text(json.dumps({'origin': origin, 'expiresAt': expires, 'mode': 'DRY_RUN', 'liveSubmissionsEnabled': False, 'unrestrictedAgentsEnabled': False}))
    STATE.chmod(0o600)
    wait_http(origin + '/preview-status')
    verify_env = {**ENV, 'JOBPILOT_LOCAL_DEMO': '1', 'JOBPILOT_PREVIEW_URL': origin}
    run(['bun', 'e2e/live-demo.ts'], folder='apps/web', log='browser-private.log', env=verify_env)

    access = PRIVATE / 'access.json'
    access.write_text(json.dumps({'email': demo['email'], 'password': demo['password'], 'url': origin, 'expiresAt': expires, 'commit': os.environ['PREVIEW_HEAD_SHA']}))
    access.chmod(0o600)
    run(['openssl', 'pkeyutl', '-encrypt', '-pubin', '-inkey', str(ROOT / '.github/preview/access-public.pem'), '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256', '-in', str(access), '-out', str(ARTIFACT / 'access.enc')], folder='.', log='encrypt-private.log')
    access.unlink()
    metadata = {'url': origin, 'expiresAt': expires, 'mode': 'DRY_RUN', 'syntheticOnly': True, 'release': release['tag_name'], 'liveApplicationsEnabled': False, 'normalSecureSignInVerified': True, 'commit': os.environ['PREVIEW_HEAD_SHA']}
    (ARTIFACT / 'preview.json').write_text(json.dumps(metadata, indent=2))
    for name in ['browser-report.json', 'simulated-desktop.png', 'simulated-phone.png', 'answer-history-phone.png']:
        (ARTIFACT / name).write_bytes((Path('/tmp/jobpilot-mvp') / name).read_bytes())
    print(json.dumps(metadata))
except BaseException:
    secrets = [ENV['SECRET_MASTER_KEY']]
    if 'demo' in globals():
        secrets += [str(demo.get(key, '')) for key in ['email', 'password', 'cookie']]
    diagnostics = {'failure': traceback.format_exc()}
    for log in PRIVATE.glob('*.log'):
        value = log.read_text(errors='replace')[-12000:]
        for secret in secrets:
            if secret:
                value = value.replace(secret, '[REDACTED]')
        diagnostics[log.name] = value
    (ROOT / 'preview-failure.json').write_text(json.dumps(diagnostics, indent=2))
    STATE.unlink(missing_ok=True)
    for child in children:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
    raise
