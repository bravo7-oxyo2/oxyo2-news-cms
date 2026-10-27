#!/usr/bin/env python3
"""Deliver one sanitized GSC terminal report through the production API broker."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse


MAX_MESSAGE_BYTES = 16 * 1024
REQUIRED_HEADINGS = ("Context retrieval", "Execution", "Findings", "Change and PR", "Next action")
REPORT_HEADER = re.compile(
    r"^ThePaperLeaf GSC Optimizer — \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\n"
    r"Outcome: (?:SUCCESS|ADVISORY_ONLY|BLOCKED|FAILED)$",
    re.MULTILINE,
)
SENSITIVE_CONTENT = re.compile(
    r"authorization:\s*bearer|gsc_automation_export_token|telegram_bot_token|"
    r"refresh[_ -]?token|client[_ -]?secret|/Users/|/home/ubuntu/apps/cms|"
    r"Traceback \(most recent call last\)|\n\s*at\s+\S+\s*\(",
    re.IGNORECASE,
)


class NotificationError(ValueError):
    pass


def validated_message(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise NotificationError("Expected a regular, non-symlink report file.")
    if path.stat().st_size > MAX_MESSAGE_BYTES:
        raise NotificationError("Telegram report file is too large.")
    try:
        message = path.read_text(encoding="utf-8").strip()
    except UnicodeDecodeError as exc:
        raise NotificationError("Telegram report must be UTF-8.") from exc
    if not message or len(message) > 4096:
        raise NotificationError("Telegram report must contain 1 to 4096 characters.")
    if not REPORT_HEADER.search(message) or any(f"\n{heading}\n" not in message for heading in REQUIRED_HEADINGS):
        raise NotificationError("Telegram report does not match the required GSC optimizer format.")
    if "\0" in message or SENSITIVE_CONTENT.search(message):
        raise NotificationError("Telegram report contains prohibited sensitive or diagnostic content.")
    return message


def notification_url() -> str:
    export_url = os.environ.get("PAPERLEAF_GSC_EXPORT_URL", "")
    notify_url = os.environ.get("PAPERLEAF_GSC_NOTIFY_URL", "")
    export = urlparse(export_url)
    notify = urlparse(notify_url)
    invalid = (
        export.scheme != "https"
        or notify.scheme != "https"
        or not export.hostname
        or export.hostname != notify.hostname
        or export.port not in (None, 443)
        or notify.port not in (None, 443)
        or export.username is not None
        or export.password is not None
        or notify.username is not None
        or notify.password is not None
    )
    if invalid:
        raise NotificationError("Export and notification URLs must use HTTPS port 443 on the same host without embedded credentials.")
    return notify_url


def deliver(message: str) -> None:
    token = os.environ.get("PAPERLEAF_GSC_EXPORT_TOKEN", "")
    if not token:
        raise NotificationError("PAPERLEAF_GSC_EXPORT_TOKEN is required.")
    if any(character in token for character in ('\n', '\r', '"', '\\')):
        raise NotificationError("PAPERLEAF_GSC_EXPORT_TOKEN contains unsupported characters.")
    if shutil.which("curl") is None:
        raise NotificationError("curl is required for Cloud notification delivery.")

    curl_config = "\n".join((
        'header = "Accept: application/json"',
        f'header = "Authorization: Bearer {token}"',
        'header = "Content-Type: application/json"',
        "",
    ))
    with tempfile.TemporaryDirectory(prefix="thepaperleaf-telegram-") as temporary:
        temporary_path = Path(temporary)
        payload_path = temporary_path / "payload.json"
        response_path = temporary_path / "response.json"
        payload_path.write_text(json.dumps({"message": message}, ensure_ascii=False), encoding="utf-8")
        payload_path.chmod(0o600)
        command = (
            "curl", "--config", "-", "--silent", "--show-error",
            "--request", "POST", "--connect-timeout", "15", "--max-time", "30",
            "--max-filesize", str(1024 * 1024), "--proto", "=https", "--tlsv1.2",
            "--data-binary", f"@{payload_path}", "--output", str(response_path),
            "--write-out", "%{http_code}", "--url", notification_url(),
        )
        completed = subprocess.run(command, input=curl_config, text=True, capture_output=True, check=False)
        if completed.returncode != 0:
            raise NotificationError("Telegram broker request failed.")
        status = completed.stdout.strip()
        if status != "200":
            if status.isdigit() and len(status) == 3:
                raise NotificationError(f"Telegram broker returned HTTP {status}.")
            raise NotificationError("Telegram broker returned an invalid HTTP status.")
        try:
            result = json.loads(response_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            raise NotificationError("Telegram broker returned an invalid response.") from None
        if result != {"data": {"delivered": True}}:
            raise NotificationError("Telegram broker returned an unexpected response.")


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print(json.dumps({"delivered": False, "error": "Pass exactly one report file."}), file=sys.stderr)
        return 2
    try:
        deliver(validated_message(Path(args[0])))
        print(json.dumps({"delivered": True}))
        return 0
    except NotificationError as exc:
        print(json.dumps({"delivered": False, "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
