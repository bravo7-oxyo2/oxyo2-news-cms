#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
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

    def successful_curl(self, command, **_kwargs):
        response_path = Path(command[command.index("--output") + 1])
        payload_path = Path(command[command.index("--data-binary") + 1].removeprefix("@"))
        self.delivered_payload = json.loads(payload_path.read_text(encoding="utf-8"))
        response_path.write_text('{"data":{"delivered":true}}', encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, stdout="200", stderr="")

    def test_delivers_through_same_host_broker_without_telegram_credentials(self):
        with patch.dict(os.environ, self.environment, clear=True), patch.object(notify_telegram.shutil, "which", return_value="/usr/bin/curl"), patch.object(notify_telegram.subprocess, "run", side_effect=self.successful_curl) as runner, redirect_stdout(StringIO()):
            self.assertEqual(notify_telegram.main([str(self.report)]), 0)
        command = runner.call_args.args[0]
        curl_config = runner.call_args.kwargs["input"]
        self.assertIn(self.environment["PAPERLEAF_GSC_NOTIFY_URL"], command)
        self.assertNotIn("network-secret-placeholder", command)
        self.assertIn("Authorization: Bearer network-secret-placeholder", curl_config)
        self.assertNotIn("--retry", command)
        self.assertEqual(self.delivered_payload, {"message": REPORT})
        self.assertNotIn("TELEGRAM_BOT_TOKEN", self.environment)
        self.assertNotIn("TELEGRAM_CHAT_ID", self.environment)

    def test_rejects_sensitive_content_before_delivery(self):
        self.report.write_text(f"{REPORT}\nAuthorization: Bearer leaked", encoding="utf-8")
        with patch.dict(os.environ, self.environment, clear=True), patch.object(notify_telegram.subprocess, "run") as runner, redirect_stderr(StringIO()):
            self.assertEqual(notify_telegram.main([str(self.report)]), 2)
            runner.assert_not_called()

    def test_rejects_a_cross_host_notification_endpoint(self):
        environment = {**self.environment, "PAPERLEAF_GSC_NOTIFY_URL": "https://example.com/notify"}
        with patch.dict(os.environ, environment, clear=True), patch.object(notify_telegram.subprocess, "run") as runner, redirect_stderr(StringIO()):
            self.assertEqual(notify_telegram.main([str(self.report)]), 2)
            runner.assert_not_called()

    def test_reports_http_failure_without_retrying(self):
        failed = subprocess.CompletedProcess(("curl",), 0, stdout="429", stderr="")
        with patch.dict(os.environ, self.environment, clear=True), patch.object(notify_telegram.shutil, "which", return_value="/usr/bin/curl"), patch.object(notify_telegram.subprocess, "run", return_value=failed) as runner, redirect_stderr(StringIO()) as stderr:
            self.assertEqual(notify_telegram.main([str(self.report)]), 2)
        runner.assert_called_once()
        self.assertIn("HTTP 429", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
