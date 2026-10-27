#!/usr/bin/env python3
"""Validate and summarize ThePaperLeaf Search Insights bundles.

The output deliberately omits raw search query rows. Live collection uses only
same-property public endpoints and never connects to a database or admin API.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import ssl
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_PUBLIC_URLS = 200
MAX_CONCURRENCY = 4
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
USER_AGENT = "ThePaperLeaf-GSC-Optimizer/1.0 (+https://www.thepaperleaf.com/)"
REQUIRED_ARRAYS = (
    "daily", "queries", "pages", "countries", "devices",
    "searchAppearances", "sitemaps", "inspections", "notices",
)
METRIC_FIELDS = ("clicks", "impressions", "ctr", "position")
SECRET_KEY = re.compile(r"(?:token|secret|password|authorization|cookie|api.?key|credential)", re.I)
DATE_VALUE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SYSTEM_CA_BUNDLE_PATHS = ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt")


class InputError(ValueError):
    pass


@dataclass(frozen=True)
class InputBundle:
    primary_path: Path
    primary: dict[str, Any]
    supplements: list[dict[str, Any]]
    notices: list[str]


def _read_limited(path: Path) -> bytes:
    if path.is_symlink():
        raise InputError(f"Symlinks are not accepted: {path.name}")
    if not path.is_file():
        raise InputError(f"Expected a regular file: {path}")
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise InputError(f"File exceeds 50 MiB: {path.name}")
    return path.read_bytes()


def _json(path: Path) -> Any:
    try:
        return json.loads(_read_limited(path).decode("utf-8-sig"))
    except UnicodeDecodeError as exc:
        raise InputError(f"JSON is not UTF-8: {path.name}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"Malformed JSON in {path.name}: {exc.msg}") from exc


def _secret_paths(value: Any, prefix: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if SECRET_KEY.search(str(key)):
                found.append(path)
            else:
                found.extend(_secret_paths(child, path))
    elif isinstance(value, list):
        for index, child in enumerate(value[:10000]):
            found.extend(_secret_paths(child, f"{prefix}[{index}]"))
    return found


def _number(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{path} must be numeric")
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise InputError(f"{path} must be finite and non-negative")
    return result


def _metric(value: Any, path: str) -> None:
    if not isinstance(value, dict):
        raise InputError(f"{path} must be an object")
    for field in METRIC_FIELDS:
        _number(value.get(field), f"{path}.{field}")


def _date(value: Any, path: str) -> date:
    if not isinstance(value, str) or not DATE_VALUE.match(value):
        raise InputError(f"{path} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise InputError(f"{path} is not a valid date") from exc


def validate_primary(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InputError("The canonical export must be a JSON object")
    if value.get("schemaVersion") != "1.0":
        raise InputError('The canonical export must use schemaVersion "1.0"')
    secrets = _secret_paths(value)
    if secrets:
        raise InputError(f"Potential secret fields are not accepted: {', '.join(secrets[:3])}")
    if not isinstance(value.get("property"), str) or not value["property"].strip():
        raise InputError("property must be a non-empty string")
    try:
        datetime.fromisoformat(str(value.get("generatedAt", "")).replace("Z", "+00:00"))
    except ValueError as exc:
        raise InputError("generatedAt must be an ISO-8601 timestamp") from exc
    report_range = value.get("range")
    if not isinstance(report_range, dict):
        raise InputError("range must be an object")
    start = _date(report_range.get("startDate"), "range.startDate")
    end = _date(report_range.get("endDate"), "range.endDate")
    if start > end:
        raise InputError("range.startDate must not be after range.endDate")
    limits = value.get("rowLimits")
    if not isinstance(limits, dict):
        raise InputError("rowLimits must be an object")
    for section in ("queries", "pages"):
        limit = limits.get(section)
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0 or limit > 25000:
            raise InputError(f"rowLimits.{section} must be an integer from 0 to 25000")
    _metric(value.get("summary"), "summary")
    _metric(value.get("previousSummary"), "previousSummary")
    for section in REQUIRED_ARRAYS:
        if not isinstance(value.get(section), list):
            raise InputError(f"{section} must be an array")
    for section in ("daily", "queries", "pages", "countries", "devices", "searchAppearances"):
        rows = value[section]
        if section in limits and len(rows) > limits[section]:
            raise InputError(f"{section} exceeds its declared row limit")
        for index, row in enumerate(rows):
            _metric(row, f"{section}[{index}]")
            if not isinstance(row.get("keys"), list) or not all(isinstance(key, str) for key in row["keys"]):
                raise InputError(f"{section}[{index}].keys must be an array of strings")
    for index, sitemap in enumerate(value["sitemaps"]):
        if not isinstance(sitemap, dict) or not isinstance(sitemap.get("path"), str):
            raise InputError(f"sitemaps[{index}].path must be a string")
        for field in ("errors", "warnings"):
            if sitemap.get(field) is not None:
                _number(sitemap[field], f"sitemaps[{index}].{field}")
    for index, inspection in enumerate(value["inspections"]):
        if not isinstance(inspection, dict) or not isinstance(inspection.get("url"), str):
            raise InputError(f"inspections[{index}].url must be a string")
    for index, notice in enumerate(value["notices"]):
        if not isinstance(notice, dict) or not isinstance(notice.get("section"), str) or not isinstance(notice.get("message"), str):
            raise InputError(f"notices[{index}] must contain string section and message")
    return value


def _canonical_candidate(value: Any) -> bool:
    return isinstance(value, dict) and value.get("schemaVersion") == "1.0" and "summary" in value and "inspections" in value


def _property_domain(value: str) -> str | None:
    value = value.strip()
    if value.startswith("sc-domain:"):
        host = value[len("sc-domain:"):].strip().lower().rstrip(".")
        return host or None
    try:
        return (urlparse(value).hostname or "").lower().rstrip(".") or None
    except ValueError:
        return None


def _same_property(left: str, right: str) -> bool:
    a, b = _property_domain(left), _property_domain(right)
    if not a or not b:
        return left.strip().rstrip("/") == right.strip().rstrip("/")
    return a == b or a.endswith(f".{b}") or b.endswith(f".{a}")


def _classify_headers(headers: Iterable[str]) -> str:
    joined = " ".join(str(header).strip().lower().replace("_", " ") for header in headers)
    if any(token in joined for token in ("core web vital", "needs improvement", "largest contentful", "cumulative layout", "interaction to next")):
        return "core-web-vitals"
    if any(token in joined for token in ("indexing reason", "validation state", "coverage state", "indexed pages", "not indexed")):
        return "page-indexing"
    if any(token in joined for token in ("linking sites", "target page", "source page", "external links", "internal links")):
        return "links"
    if "clicks" in joined and "impressions" in joined:
        return "search-performance"
    if any(token in joined for token in ("page fetch", "robots txt", "google canonical", "user canonical", "last crawl")):
        return "url-inspection"
    if "sitemap" in joined and any(token in joined for token in ("submitted", "downloaded", "warnings", "errors")):
        return "sitemaps"
    return "unknown"


def _supplement_property(rows: list[dict[str, Any]]) -> str | None:
    keys = ("property", "site", "site url", "site_url", "property url")
    for row in rows[:100]:
        lowered = {str(key).strip().lower(): value for key, value in row.items()}
        for key in keys:
            value = lowered.get(key)
            if isinstance(value, str) and _property_domain(value):
                return value
    return None


def _safe_counts(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    allowed = {"status", "state", "reason", "validation", "validation state", "type", "device", "source"}
    result: dict[str, dict[str, int]] = {}
    if not rows:
        return result
    for raw_key in rows[0]:
        key = str(raw_key).strip().lower()
        if key not in allowed:
            continue
        values = [str(row.get(raw_key, "")).strip() for row in rows if str(row.get(raw_key, "")).strip()]
        unique = set(values)
        if 0 < len(unique) <= 20:
            result[key] = dict(Counter(values).most_common(20))
    return result


def _read_supplement(path: Path) -> tuple[dict[str, Any], str | None]:
    if path.suffix.lower() == ".json":
        value = _json(path)
        if isinstance(value, list):
            rows = [row for row in value if isinstance(row, dict)]
        elif isinstance(value, dict):
            raw_rows = value.get("rows") or value.get("data") or []
            rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else [value]
        else:
            rows = []
    else:
        try:
            text = _read_limited(path).decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise InputError(f"CSV is not UTF-8: {path.name}") from exc
        reader = csv.DictReader(text.splitlines())
        rows = [dict(row) for row in reader]
    headers = list(rows[0]) if rows else []
    family = _classify_headers(headers)
    summary = {
        "file": path.name,
        "family": family,
        "rows": len(rows),
        "columns": headers[:100],
        "valueCounts": _safe_counts(rows),
    }
    return summary, _supplement_property(rows)


def load_bundle(path_value: str | os.PathLike[str]) -> InputBundle:
    path = Path(path_value).expanduser()
    notices: list[str] = []
    supplements: list[dict[str, Any]] = []
    if path.is_symlink():
        raise InputError("Input symlinks are not accepted")
    if path.is_file():
        if path.suffix.lower() != ".json":
            raise InputError("A single-file input must be the canonical JSON export")
        primary_path = path
        primary = validate_primary(_json(path))
        return InputBundle(primary_path, primary, supplements, notices)
    if not path.is_dir():
        raise InputError(f"Input does not exist: {path}")
    children = sorted(path.iterdir())
    if any(child.is_dir() or child.is_symlink() for child in children):
        raise InputError("Input directories must be flat and cannot contain symlinks")
    unsupported = [child.name for child in children if child.suffix.lower() not in {".json", ".csv"}]
    if unsupported:
        raise InputError(f"Unsupported bundle files: {', '.join(unsupported[:5])}")
    decoded_json: dict[Path, Any] = {child: _json(child) for child in children if child.suffix.lower() == ".json"}
    candidates = [(child, value) for child, value in decoded_json.items() if _canonical_candidate(value)]
    if len(candidates) != 1:
        raise InputError(f"Expected exactly one canonical Search Insights JSON; found {len(candidates)}")
    primary_path, primary_value = candidates[0]
    primary = validate_primary(primary_value)
    for child in children:
        if child == primary_path:
            continue
        supplement, property_value = _read_supplement(child)
        if property_value and not _same_property(primary["property"], property_value):
            raise InputError(f"Supplement {child.name} belongs to a different property")
        if supplement["family"] == "unknown":
            notices.append(f"Supplement {child.name} was not recognized and was not interpreted.")
        supplements.append(supplement)
    return InputBundle(primary_path, primary, supplements, notices)


def _percent_change(current: float, previous: float) -> float | None:
    if previous == 0:
        return None if current == 0 else 100.0
    return round((current - previous) / previous * 100, 2)


def _finding(identifier: str, severity: str, confidence: str, evidence: dict[str, Any], recommendation: str) -> dict[str, Any]:
    return {
        "id": identifier,
        "severity": severity,
        "confidence": confidence,
        "gscEvidence": evidence,
        "expectedImpact": "Requires code and public-site corroboration before impact can be estimated.",
        "recommendation": recommendation,
        "disposition": "needs-code-corroboration",
    }


def analyze_metrics(report: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    current, previous = report["summary"], report["previousSummary"]
    changes = {field: _percent_change(float(current[field]), float(previous[field])) for field in METRIC_FIELDS}
    query_rows = report["queries"]
    positive_impressions = sorted(float(row["impressions"]) for row in query_rows if row["impressions"] > 0)
    threshold = max(100.0, positive_impressions[int((len(positive_impressions) - 1) * 0.75)]) if positive_impressions else 100.0
    high_impression_low_ctr = [row for row in query_rows if row["impressions"] >= threshold and row["ctr"] < 0.02]
    near_page_one = [row for row in query_rows if row["impressions"] >= 10 and 4 <= row["position"] <= 20]
    zero_click = [row for row in query_rows if row["impressions"] >= 10 and row["clicks"] == 0]
    findings: list[dict[str, Any]] = []
    if high_impression_low_ctr:
        findings.append(_finding("gsc-low-ctr", "medium", "medium", {
            "rows": len(high_impression_low_ctr), "impressionThreshold": threshold,
            "combinedImpressions": sum(row["impressions"] for row in high_impression_low_ctr),
        }, "Review intent alignment and SERP presentation; do not rewrite titles automatically."))
    if near_page_one:
        findings.append(_finding("gsc-near-page-one", "medium", "medium", {
            "rows": len(near_page_one), "combinedImpressions": sum(row["impressions"] for row in near_page_one),
        }, "Correlate exposed pages with internal linking, technical metadata, and content completeness."))
    if zero_click:
        findings.append(_finding("gsc-zero-click", "low", "medium", {
            "rows": len(zero_click), "combinedImpressions": sum(row["impressions"] for row in zero_click),
        }, "Inspect search appearance and intent before proposing editorial changes."))
    sitemap_errors = sum(float(row.get("errors") or 0) for row in report["sitemaps"])
    sitemap_warnings = sum(float(row.get("warnings") or 0) for row in report["sitemaps"])
    pending = sum(1 for row in report["sitemaps"] if row.get("isPending"))
    if sitemap_errors or sitemap_warnings or pending:
        findings.append(_finding("gsc-sitemap-status", "high" if sitemap_errors else "medium", "high", {
            "errors": sitemap_errors, "warnings": sitemap_warnings, "pending": pending,
        }, "Reproduce each affected sitemap response and compare it with the generator before changing code."))
    failed_inspections = []
    canonical_mismatches = []
    for row in report["inspections"]:
        if row.get("error") or str(row.get("verdict", "")).upper() not in {"PASS", "NEUTRAL"}:
            failed_inspections.append(row.get("url"))
        google = str(row.get("googleCanonical") or "").rstrip("/")
        user = str(row.get("userCanonical") or "").rstrip("/")
        if google and user and google != user:
            canonical_mismatches.append(row.get("url"))
    if failed_inspections:
        findings.append(_finding("gsc-inspection-failures", "high", "high", {
            "count": len(failed_inspections), "publicUrls": failed_inspections[:20],
        }, "Reproduce robots, fetch, indexability, and canonical behavior for each public URL."))
    if canonical_mismatches:
        findings.append(_finding("gsc-canonical-mismatch", "high", "high", {
            "count": len(canonical_mismatches), "publicUrls": canonical_mismatches[:20],
        }, "Compare rendered canonical, redirects, hreflang, sitemap URL, and internal links."))
    overview = {
        "summary": {field: current[field] for field in METRIC_FIELDS},
        "previousSummary": {field: previous[field] for field in METRIC_FIELDS},
        "percentChanges": changes,
        "opportunities": {
            "highImpressionLowCtrRows": len(high_impression_low_ctr),
            "nearPageOneRows": len(near_page_one),
            "zeroClickRows": len(zero_click),
            "queryImpressionThreshold": threshold,
        },
    }
    return overview, findings


def _allowed_for_property(host: str | None, property_value: str) -> bool:
    if not host:
        return False
    host = host.lower().rstrip(".")
    domain = _property_domain(property_value)
    if not domain:
        return False
    if property_value.startswith("sc-domain:"):
        return host == domain or host.endswith(f".{domain}")
    prefix_host = urlparse(property_value).hostname
    return bool(prefix_host and host == prefix_host.lower())


def derive_site_origin(report: dict[str, Any]) -> str:
    candidates: list[str] = []
    for row in report.get("pages", []):
        if row.get("keys"):
            candidates.append(row["keys"][0])
    candidates.extend(str(row.get("url", "")) for row in report.get("inspections", []))
    origins: Counter[str] = Counter()
    for candidate in candidates:
        try:
            parsed = urlparse(candidate)
        except ValueError:
            continue
        if parsed.scheme in {"http", "https"} and _allowed_for_property(parsed.hostname, report["property"]):
            origins[f"{parsed.scheme}://{parsed.netloc}"] += 1
    if origins:
        return origins.most_common(1)[0][0].rstrip("/")
    property_value = report["property"]
    if property_value.startswith("sc-domain:"):
        domain = _property_domain(property_value)
        if not domain:
            raise InputError("Cannot derive a valid domain from the GSC property")
        return f"https://{domain}"
    parsed = urlparse(property_value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise InputError("Cannot derive a public origin from the GSC property")
    return f"{parsed.scheme}://{parsed.netloc}"


def _public_url(url: str) -> str:
    parsed = urlparse(url)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path or "/", "", parsed.query, ""))


def _public_ssl_context() -> ssl.SSLContext:
    """Use an explicitly configured CA bundle, or a verified system bundle when needed."""
    if os.environ.get("SSL_CERT_FILE") or os.environ.get("SSL_CERT_DIR"):
        return ssl.create_default_context()
    for path in SYSTEM_CA_BUNDLE_PATHS:
        if os.path.isfile(path):
            return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


def _fetch(url: str, property_value: str, timeout: float = 8.0) -> tuple[int, str, bytes, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/xml, text/html;q=0.9, */*;q=0.5"})
    try:
        with urlopen(request, timeout=timeout, context=_public_ssl_context()) as response:
            final_url = response.geturl()
            if not _allowed_for_property(urlparse(final_url).hostname, property_value):
                raise InputError(f"Cross-property redirect blocked: {url} -> {final_url}")
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise InputError(f"Public response exceeded 5 MiB: {url}")
            return response.status, final_url, body, response.headers.get_content_type()
    except HTTPError as exc:
        body = exc.read(min(MAX_RESPONSE_BYTES, 65536))
        return exc.code, exc.geturl(), body, exc.headers.get_content_type()


class MetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self._in_title = False
        self.canonical: str | None = None
        self.robots: str | None = None
        self.hreflangs: list[str] = []
        self.json_ld = 0
        self.images = 0
        self.images_without_dimensions = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        if tag.lower() == "title":
            self._in_title = True
        elif tag.lower() == "link":
            rel = values.get("rel", "").lower().split()
            if "canonical" in rel:
                self.canonical = values.get("href")
            if "alternate" in rel and values.get("hreflang"):
                self.hreflangs.append(values["hreflang"])
        elif tag.lower() == "meta" and values.get("name", "").lower() == "robots":
            self.robots = values.get("content")
        elif tag.lower() == "script" and values.get("type", "").lower() == "application/ld+json":
            self.json_ld += 1
        elif tag.lower() == "img":
            self.images += 1
            if not values.get("width") or not values.get("height"):
                self.images_without_dimensions += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def _sitemap_urls(xml_bytes: bytes) -> tuple[list[str], list[str]]:
    root = ElementTree.fromstring(xml_bytes)
    locations = [element.text.strip() for element in root.iter() if element.tag.endswith("loc") and element.text]
    if root.tag.endswith("sitemapindex"):
        return [], locations
    return locations, []


def _api_url(origin: str, public_url: str) -> str | None:
    path = urlparse(public_url).path
    match = re.fullmatch(r"/article/([^/]+)/?", path)
    if match:
        return f"{origin}/api/v1/posts/{quote(match.group(1), safe='')}"
    match = re.fullmatch(r"/page/([^/]+)/?", path)
    if match:
        return f"{origin}/api/v1/pages/{quote(match.group(1), safe='')}"
    return None


def _inspect_public_url(url: str, origin: str, property_value: str) -> dict[str, Any]:
    result: dict[str, Any] = {"url": url}
    try:
        status, final_url, body, content_type = _fetch(url, property_value)
        result.update({"status": status, "finalUrl": final_url})
        if status == 200 and ("html" in content_type or body.lstrip().startswith(b"<")):
            parser = MetadataParser()
            parser.feed(body.decode("utf-8", errors="replace"))
            result.update({
                "title": parser.title.strip(), "canonical": parser.canonical,
                "robots": parser.robots, "hreflangs": sorted(set(parser.hreflangs)),
                "jsonLdBlocks": parser.json_ld, "images": parser.images,
                "imagesWithoutDimensions": parser.images_without_dimensions,
            })
        api_url = _api_url(origin, final_url)
        if api_url and status == 200:
            api_status, _, api_body, _ = _fetch(api_url, property_value)
            result["apiStatus"] = api_status
            if api_status == 200:
                envelope = json.loads(api_body.decode("utf-8"))
                item = envelope.get("data", {}) if isinstance(envelope, dict) else {}
                media = item.get("coverMedia") or {}
                result["content"] = {
                    "title": item.get("title"), "seoTitlePresent": bool(item.get("seoTitle")),
                    "seoDescriptionPresent": bool(item.get("seoDescription")),
                    "authorName": item.get("authorName"), "sourcePresent": bool(item.get("sourceUrl") or item.get("sourceLabel")),
                    "wordCount": item.get("wordCount"), "category": (item.get("categoryRef") or {}).get("slug") or item.get("category"),
                    "availableLanguages": item.get("availableLanguages") or [],
                    "coverDimensionsPresent": bool(media.get("width") and media.get("height")) if media else None,
                }
    except (InputError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        result["error"] = str(exc)[:300]
    return result


def collect_public_site(report: dict[str, Any], max_urls: int = MAX_PUBLIC_URLS) -> dict[str, Any]:
    max_urls = max(1, min(MAX_PUBLIC_URLS, max_urls))
    origin = derive_site_origin(report)
    property_value = report["property"]
    notices: list[str] = []
    sitemap_urls: list[str] = []
    resource_status: dict[str, int | str] = {}
    for resource in ("/robots.txt", "/llms.txt", "/api/v1/categories"):
        try:
            status, final_url, _, _ = _fetch(f"{origin}{resource}", property_value)
            resource_status[resource] = status
            if final_url.startswith("http"):
                origin = f"{urlparse(final_url).scheme}://{urlparse(final_url).netloc}"
        except (InputError, URLError, TimeoutError) as exc:
            resource_status[resource] = "unavailable"
            notices.append(f"{resource}: {str(exc)[:200]}")
    sitemap_queue = [f"{origin}/sitemap.xml"]
    seen_sitemaps: set[str] = set()
    while sitemap_queue and len(seen_sitemaps) < 20:
        sitemap = sitemap_queue.pop(0)
        if sitemap in seen_sitemaps:
            continue
        seen_sitemaps.add(sitemap)
        try:
            status, _, body, _ = _fetch(sitemap, property_value)
            resource_status[sitemap] = status
            if status == 200:
                urls, nested = _sitemap_urls(body)
                sitemap_urls.extend(url for url in urls if _allowed_for_property(urlparse(url).hostname, property_value))
                sitemap_queue.extend(url for url in nested if _allowed_for_property(urlparse(url).hostname, property_value))
        except (InputError, URLError, TimeoutError, ElementTree.ParseError) as exc:
            resource_status[sitemap] = "unavailable"
            notices.append(f"sitemap: {str(exc)[:200]}")
    gsc_pages = [row["keys"][0] for row in sorted(report["pages"], key=lambda row: row["impressions"], reverse=True) if row.get("keys")]
    candidates: list[str] = []
    seen: set[str] = set()
    for raw_url in [*gsc_pages, *sitemap_urls]:
        try:
            url = _public_url(raw_url)
        except ValueError:
            continue
        if url not in seen and _allowed_for_property(urlparse(url).hostname, property_value):
            seen.add(url)
            candidates.append(url)
        if len(candidates) >= max_urls:
            break
    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as executor:
        futures = {executor.submit(_inspect_public_url, url, origin, property_value): index for index, url in enumerate(candidates)}
        ordered: dict[int, dict[str, Any]] = {}
        for future in as_completed(futures):
            ordered[futures[future]] = future.result()
        rows = [ordered[index] for index in sorted(ordered)]
    issue_samples: dict[str, list[str]] = {
        "non200": [], "canonicalMissingOrDifferent": [], "noindex": [], "missingJsonLd": [],
        "imagesWithoutDimensions": [], "missingSeoDescription": [], "genericAuthor": [],
        "missingSource": [], "thinWordCount": [], "missingCoverDimensions": [],
    }
    title_counts = Counter(str(row.get("title", "")).strip() for row in rows if str(row.get("title", "")).strip())
    duplicate_titles = sorted(title for title, count in title_counts.items() if count > 1)
    for row in rows:
        url = row["url"]
        if row.get("status") != 200:
            issue_samples["non200"].append(url)
        canonical = str(row.get("canonical") or "").rstrip("/")
        final = str(row.get("finalUrl") or url).rstrip("/")
        if not canonical or canonical != final:
            issue_samples["canonicalMissingOrDifferent"].append(url)
        if "noindex" in str(row.get("robots") or "").lower():
            issue_samples["noindex"].append(url)
        if row.get("status") == 200 and not row.get("jsonLdBlocks"):
            issue_samples["missingJsonLd"].append(url)
        if (row.get("imagesWithoutDimensions") or 0) > 0:
            issue_samples["imagesWithoutDimensions"].append(url)
        content = row.get("content") or {}
        if content:
            if not content.get("seoDescriptionPresent"):
                issue_samples["missingSeoDescription"].append(url)
            if str(content.get("authorName") or "").strip().lower() in {"", "editorial desk", "编辑部"}:
                issue_samples["genericAuthor"].append(url)
            if not content.get("sourcePresent"):
                issue_samples["missingSource"].append(url)
            word_count = content.get("wordCount")
            if isinstance(word_count, (int, float)) and word_count < 300:
                issue_samples["thinWordCount"].append(url)
            if content.get("coverDimensionsPresent") is False:
                issue_samples["missingCoverDimensions"].append(url)
    return {
        "origin": origin,
        "inspectedUrls": len(rows),
        "sitemapUrlsFound": len(set(sitemap_urls)),
        "resourceStatus": resource_status,
        "issueCounts": {key: len(values) for key, values in issue_samples.items()},
        "issueSamples": {key: values[:10] for key, values in issue_samples.items() if values},
        "duplicateTitleCount": len(duplicate_titles),
        "notices": notices,
    }


def build_analysis(bundle: InputBundle, repo: Path, offline: bool, max_urls: int) -> dict[str, Any]:
    report = bundle.primary
    metrics, findings = analyze_metrics(report)
    generated = datetime.fromisoformat(report["generatedAt"].replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    if generated.tzinfo is None:
        generated = generated.replace(tzinfo=timezone.utc)
    age_days = max(0, (now - generated.astimezone(timezone.utc)).days)
    notices = [*bundle.notices, *[f"{row['section']}: {row['message']}" for row in report["notices"]]]
    if age_days > 30:
        notices.append(f"The canonical export is {age_days} days old; current-site correlation has reduced confidence.")
    site: dict[str, Any] | None = None
    if not offline:
        try:
            site = collect_public_site(report, max_urls)
        except (InputError, URLError, TimeoutError) as exc:
            notices.append(f"Public-site collection failed: {str(exc)[:300]}")
    repo_path = repo.expanduser().resolve()
    repository = {
        "path": str(repo_path),
        "exists": repo_path.is_dir(),
        "gitRepository": (repo_path / ".git").exists(),
        "packageManager": "pnpm" if (repo_path / "pnpm-lock.yaml").exists() else None,
    }
    return {
        "analysisVersion": "1.0",
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "input": {
            "schemaVersion": report["schemaVersion"], "property": report["property"], "range": report["range"],
            "sourceGeneratedAt": report["generatedAt"], "ageDays": age_days,
            "sha256": hashlib.sha256(_read_limited(bundle.primary_path)).hexdigest(),
            "supplements": bundle.supplements,
            "partial": bool(report["notices"]),
        },
        "metrics": metrics,
        "gscFindings": findings,
        "publicSite": site,
        "repository": repository,
        "notices": notices,
        "privacy": {"rawQueriesIncluded": False, "safeToCommit": False},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate", help="Validate a canonical export or flat bundle")
    validate.add_argument("input")
    analyze = subparsers.add_parser("analyze", help="Validate, aggregate, and optionally inspect the public site")
    analyze.add_argument("input")
    analyze.add_argument("--repo", required=True, type=Path)
    analyze.add_argument("--output", required=True, type=Path)
    analyze.add_argument("--offline", action="store_true")
    analyze.add_argument("--max-urls", type=int, default=MAX_PUBLIC_URLS)
    args = parser.parse_args(argv)
    try:
        bundle = load_bundle(args.input)
        if args.command == "validate":
            print(json.dumps({
                "valid": True, "property": bundle.primary["property"], "range": bundle.primary["range"],
                "supplements": bundle.supplements, "notices": bundle.notices,
            }, ensure_ascii=False, indent=2))
            return 0
        analysis = build_analysis(bundle, args.repo, args.offline, args.max_urls)
        output = args.output.expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(analysis, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        try:
            output.chmod(0o600)
        except OSError:
            pass
        print(json.dumps({
            "valid": True, "output": str(output), "findings": len(analysis["gscFindings"]),
            "siteInspected": (analysis.get("publicSite") or {}).get("inspectedUrls", 0), "notices": analysis["notices"],
        }, ensure_ascii=False, indent=2))
        return 0
    except InputError as exc:
        print(json.dumps({"valid": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
