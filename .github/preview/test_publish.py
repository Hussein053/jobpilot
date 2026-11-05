import importlib.util
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('preview_publish', Path(__file__).with_name('publish.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PreviewPublicationTests(unittest.TestCase):
    def source(self):
        return {'url': 'https://synthetic-fixture.trycloudflare.com', 'expiresAt': (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat().replace('+00:00', 'Z'), 'commit': 'a' * 40, 'mode': 'DRY_RUN', 'syntheticOnly': True, 'liveApplicationsEnabled': False, 'normalSecureSignInVerified': True}

    def test_rejects_unverified_live_expired_or_external_previews(self):
        for change in [{'mode': 'LIVE'}, {'liveApplicationsEnabled': True}, {'normalSecureSignInVerified': False}, {'url': 'https://attacker.invalid'}, {'expiresAt': '2020-01-01T00:00:00Z'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.preview_metadata(self.source() | change, bytes(384))

    def test_only_encrypted_access_is_published_and_user_description_is_preserved(self):
        metadata = module.preview_metadata(self.source(), bytes(range(256)) + bytes(range(128)))
        body = module.preview_body('Existing reviewer description\n', metadata)
        self.assertIn('Existing reviewer description', body)
        self.assertNotIn('"password"', body)
        self.assertNotIn('"email"', body)
        self.assertEqual(body.count('<!-- jobpilot-preview '), 1)
        updated = module.preview_body(body, metadata)
        self.assertEqual(updated.count('<!-- jobpilot-preview '), 1)
        self.assertEqual(json.loads(updated.split('<!-- jobpilot-preview ')[1].split(' -->')[0]), metadata)


if __name__ == '__main__':
    unittest.main()
