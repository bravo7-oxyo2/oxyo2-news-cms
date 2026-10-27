#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import notify_telegram


REPORT = """ThePaperLeaf GSC Optimizer — 2026-10-27T12:30:00Z
Outcome: ADVISORY_ONLY

Context retrieval
• Export: valid
• Production API access: direct

Execution
1. Isolated worktree: complete
2. Source and public-site analysis: complete
3. Validation: passed
4. Cleanup: complete

Findings
• Priority: Medium — Aggregate sitemap finding
• Additional signals: none
• Code proposal: advisory-only recommendation

Change and PR
• Safe fix: not warranted
• Draft PR: not created

Next action
• No action required"""


class FakeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return b'{"data":{"delivered":true}}'


class TelegramNotificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.report = Path(self.temporary.name) / "report.txt"
        self.report.write_text(REPORT, encoding="utf-8")
        self.environment = {
            "PAPERLEAF_GSC_EXPORT_URL": "https://admin.thepaperleaf.com/api/admin/search-console/automation-export",
            "PAPERLEAF_GSC_NOTIFY_URL": "https://admin.thepaperleaf.com/api/admin/search-console/automation-notify",
            "PAPERLEAF_GSC_EXPORT_TOKEN": "network-secret-placeholder",
        }

    def tearDown(self):
        self.temporary.cleanup()

    def test_delivers_through_same_host_broker_without_telegram_credentials(self):
        with patch.dict(os.environ, self.environment, clear=True), patch.object(notify_telegram, "urlopen", return_value=FakeResponse()) as opener, redirect_stdout(StringIO()):
            self.assertEqual(notify_telegram.main([str(self.report)]), 0)
        request = opener.call_args.args[0]
        self.assertEqual(request.full_url, self.environment["PAPERLEAF_GSC_NOTIFY_URL"])
        self.assertEqual(request.get_header("Authorization"), "Bearer network-secret-placeholder")
        self.assertEqual(json.loads(request.data), {"message": REPORT})
        self.assertNotIn("TELEGRAM_BOT_TOKEN", self.environment)
        self.assertNotIn("TELEGRAM_CHAT_ID", self.environment)

    def test_rejects_sensitive_content_before_delivery(self):
        self.report.write_text(f"{REPORT}\nAuthorization: Bearer leaked", encoding="utf-8")
        with patch.dict(os.environ, self.environment, clear=True), patch.object(notify_telegram, "urlopen") as opener, redirect_stderr(StringIO()):
            self.assertEqual(notify_telegram.main([str(self.report)]), 2)
            opener.assert_not_called()

    def test_rejects_a_cross_host_notification_endpoint(self):
        environment = {**self.environment, "PAPERLEAF_GSC_NOTIFY_URL": "https://example.com/notify"}
        with patch.dict(os.environ, environment, clear=True), patch.object(notify_telegram, "urlopen") as opener, redirect_stderr(StringIO()):
            self.assertEqual(notify_telegram.main([str(self.report)]), 2)
            opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
