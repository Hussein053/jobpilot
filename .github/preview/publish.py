"""Publish only public URL metadata and encrypted fixture access to the owning PR."""
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import urllib.request
import urllib.error
from urllib.parse import urlparse


def preview_metadata(source, cipher):
    origin = urlparse(source['url'])
    if origin.scheme != 'https' or not re.fullmatch(r'[a-z0-9-]+\.trycloudflare\.com', origin.hostname or '') or origin.path or origin.query or origin.fragment or origin.username or origin.port:
        raise ValueError('Only the assigned ephemeral HTTPS origin may be published')
    if source.get('mode') != 'DRY_RUN' or source.get('liveApplicationsEnabled') is not False or source.get('syntheticOnly') is not True or source.get('normalSecureSignInVerified') is not True:
        raise ValueError('Only a verified synthetic DRY_RUN preview may be published')
    if datetime.fromisoformat(source['expiresAt'].replace('Z', '+00:00')) <= datetime.now(timezone.utc):
        raise ValueError('Expired previews cannot be published')
    if len(cipher) != 384 or not re.fullmatch(r'[0-9a-f]{40}', source['commit']):
        raise ValueError('Invalid encrypted fixture access or source commit')
    return {key: source[key] for key in ['url', 'expiresAt', 'commit']} | {'encryptedAccess': base64.b64encode(cipher).decode()}


def preview_body(body, metadata):
    cleaned = re.sub(r'(?m)^<!-- jobpilot-preview \{[^\n]*\} -->\n?', '', body or '')
    return cleaned.rstrip() + '\n\n<!-- jobpilot-preview ' + json.dumps(metadata, separators=(',', ':')) + ' -->\n'


def publish():
    repo = os.environ['GITHUB_REPOSITORY']
    number = int(os.environ['PREVIEW_PR_NUMBER'])
    expected = os.environ['PREVIEW_HEAD_SHA']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) or number <= 0:
        raise ValueError('Invalid owning repository or pull request')
    metadata = preview_metadata(json.loads(Path('preview-artifact/preview.json').read_text()), Path('preview-artifact/access.enc').read_bytes())
    if metadata['commit'] != expected:
        raise ValueError('Preview source differs from the requested commit')
    endpoint = f'https://api.github.com/repos/{repo}/pulls/{number}'
    headers = {'Authorization': 'Bearer ' + os.environ['GITHUB_TOKEN'], 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'JobPilot-preview'}
    with urllib.request.urlopen(urllib.request.Request(endpoint, headers=headers), timeout=30) as response:
        pr = json.load(response)
    if pr['head']['sha'] != expected or pr['head']['repo']['full_name'] != repo or pr['state'] != 'open':
        raise ValueError('Pull request moved or is not an owner-repository preview')
    headers['Content-Type'] = 'application/json'
    payload = json.dumps({'body': preview_body(pr.get('body'), metadata)}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(endpoint, data=payload, headers=headers, method='PATCH'), timeout=30) as response:
            if response.status != 200:
                raise RuntimeError('Preview metadata was not published')
    except urllib.error.HTTPError as error:
        detail = json.loads(error.read()).get('message', 'Request rejected')
        raise RuntimeError(f'GitHub metadata update failed: HTTP {error.code}: {detail}') from None
    print('Published verified URL and encrypted fixture access; no plaintext credentials.')


if __name__ == '__main__':
    publish()
