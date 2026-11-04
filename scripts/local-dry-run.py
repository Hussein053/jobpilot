#!/usr/bin/env python3
"""Run the isolated local synthetic MVP; no production or terminal targets."""
import base64
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
if not shutil.which('bun') and Path('/workspace/tooling/bun/bin/bun').exists():
    os.environ['PATH'] = '/workspace/tooling/bun/bin:' + os.environ['PATH']
STATE = ROOT / '.tmp' / 'jobpilot-mvp'
STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(STATE, 0o700)
config_file = STATE / 'runtime.json'
if not config_file.exists():
    config = {
        'NODE_ENV': 'development', 'PORT': '4101',
        'DATABASE_URL': 'postgresql://jobpilot_fixture:local_synthetic_only@127.0.0.1:15432/jobpilot_mvp_local',
        'SECRET_MASTER_KEY': base64.b64encode(os.urandom(32)).decode(),
        'CORS_ORIGINS': 'http://127.0.0.1:4100,http://localhost:4100',
        'APP_URL': 'http://127.0.0.1:4100', 'STORAGE_ROOT': str(STATE / 'storage'),
        'NEXT_PUBLIC_API_URL': 'http://127.0.0.1:4101',
        'INTERNAL_API_URL': 'http://127.0.0.1:4101',
        'NEXT_PUBLIC_TERMINAL_URL': 'http://127.0.0.1:4102',
        'NEXT_TELEMETRY_DISABLED': '1',
        'NEXT_FONT_GOOGLE_MOCKED_RESPONSES': str(ROOT / 'apps/web/e2e/font-responses.cjs'),
    }
    config_file.write_text(json.dumps(config))
    os.chmod(config_file, 0o600)
config = json.loads(config_file.read_text())
if config['DATABASE_URL'] != 'postgresql://jobpilot_fixture:local_synthetic_only@127.0.0.1:15432/jobpilot_mvp_local':
    raise SystemExit('Refusing a non-fixture database configuration.')
os.environ.update(config)
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/tmp/jobpilot-playwright-browsers')
cache = Path('/tmp/jobpilot-cache')
(cache / 'next').mkdir(parents=True, exist_ok=True)
if not (cache / 'node_modules').exists():
    (cache / 'node_modules').symlink_to(ROOT / 'apps/web/node_modules', target_is_directory=True)
artifact = Path('/tmp/jobpilot-mvp')
if not artifact.exists():
    artifact.symlink_to(STATE, target_is_directory=True)
if not os.path.samefile(artifact, STATE):
    raise SystemExit('Existing /tmp/jobpilot-mvp is not this checkout state; inspect it before continuing.')
mode = sys.argv[1] if len(sys.argv) > 1 else ''
api = ROOT / 'apps/api'
web = ROOT / 'apps/web'
commands = {
    'api': (api, ['bun', 'run', 'dev']),
    'web': (web, ['bun', 'run', 'dev', '--hostname', '127.0.0.1']),
    'seed': (api, ['bun', 'run', 'scripts/dry-run-demo.ts']),
    'build': (web, ['bun', 'run', 'build']),
    'browser': (web, ['bun', 'e2e/live-demo.ts']),
    'install-browser': (web, ['bunx', 'playwright', 'install', 'chromium', '--only-shell']),
    'e2e': (web, ['bun', 'run', 'test:e2e', '--max-failures=1']),
}
if mode == 'setup':
    for args in [['bun', 'run', 'db:generate'], ['bun', 'run', 'db:migrate:apply']]:
        subprocess.run(args, cwd=api, check=True)
    raise SystemExit(0)
if mode == 'terminal-tests':
    dotnet = shutil.which('dotnet') or '/workspace/tooling/dotnet/dotnet'
    os.environ.setdefault('DOTNET_CLI_HOME', '/workspace/tooling/dotnet-home')
    os.environ.setdefault('NUGET_PACKAGES', '/workspace/tooling/nuget')
    project = ROOT / 'tests/JobPilot.Terminal.Tests/JobPilot.Terminal.Tests.csproj'
    subprocess.run([dotnet, 'build', str(project), '-c', 'Release', '-m:1', '--no-restore'], cwd=ROOT, check=True)
    subprocess.run([dotnet, str(project.parent / 'bin/Release/net10.0/JobPilot.Terminal.Tests.dll')], cwd=ROOT, check=True)
    raise SystemExit(0)
if mode == 'db-tests':
    os.environ['DATABASE_URL'] = config['DATABASE_URL'].replace('/jobpilot_mvp_local', '/jobpilot_settings_test')
    os.environ['JOBPILOT_TEST_DATABASE_URL'] = os.environ['DATABASE_URL']
    for args in [
        ['bun', 'run', 'db:migrate:apply'],
        ['bunx', 'prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema', '--exit-code'],
        ['bun', 'test', 'src/modules/auto-apply/auto-apply.postgres.test.ts', 'src/modules/ingestion/ingestion.postgres.test.ts', 'src/modules/resume/review/resume-review.postgres.test.ts', 'src/modules/information-bank/', 'src/modules/auto-apply/preview/', 'src/modules/discovery/', 'src/modules/preparation/'],
    ]:
        subprocess.run(args, cwd=api, check=True)
    raise SystemExit(0)
if mode == 'build':
    os.environ['NODE_ENV'] = 'production'
if mode == 'browser':
    os.environ['JOBPILOT_LOCAL_DEMO'] = '1'
if mode not in commands:
    raise SystemExit('Usage: local-dry-run.py setup|api|web|seed|build|install-browser|browser|db-tests|e2e|terminal-tests')
folder, command = commands[mode]
os.chdir(folder)
os.execvp(command[0], command)
