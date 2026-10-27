#!/usr/bin/env python3
"""Deliver one sanitized GSC terminal report through the production API broker."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


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
    if export.scheme != "https" or notify.scheme != "https" or not export.hostname or export.hostname != notify.hostname:
        raise NotificationError("Export and notification URLs must use HTTPS on the same host.")
    return notify_url


def deliver(message: str) -> None:
    token = os.environ.get("PAPERLEAF_GSC_EXPORT_TOKEN", "")
    if not token:
        raise NotificationError("PAPERLEAF_GSC_EXPORT_TOKEN is required.")
    request = Request(
        notification_url(),
        data=json.dumps({"message": message}, ensure_ascii=False).encode("utf-8"),
        headers={"Accept": "application/json", "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read(1024 * 1024 + 1)
            if response.status != 200 or len(body) > 1024 * 1024:
                raise NotificationError("Telegram broker rejected the report.")
            result = json.loads(body.decode("utf-8"))
            if result != {"data": {"delivered": True}}:
                raise NotificationError("Telegram broker returned an unexpected response.")
    except HTTPError as exc:
        raise NotificationError(f"Telegram broker returned HTTP {exc.code}.") from None
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
        raise NotificationError("Telegram broker request failed.") from None


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
