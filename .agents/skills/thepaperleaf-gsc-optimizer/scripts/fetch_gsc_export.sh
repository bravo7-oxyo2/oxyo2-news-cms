#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

fail() {
  printf 'GSC automation error: %s\n' "$1" >&2
  exit 2
}

export_url="${PAPERLEAF_GSC_EXPORT_URL:-}"
export_token="${PAPERLEAF_GSC_EXPORT_TOKEN:-}"

[[ "$export_url" == https://* ]] || fail 'PAPERLEAF_GSC_EXPORT_URL must be an HTTPS URL.'
[[ -n "$export_token" ]] || fail 'PAPERLEAF_GSC_EXPORT_TOKEN is required.'
if [[ "$export_token" == *$'\n'* || "$export_token" == *$'\r'* || "$export_token" == *'"'* || "$export_token" == *\\* ]]; then
  fail 'PAPERLEAF_GSC_EXPORT_TOKEN contains unsupported characters.'
fi

command -v curl >/dev/null 2>&1 || fail 'curl is required.'
command -v python3 >/dev/null 2>&1 || fail 'python3 is required.'

skill_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
repository="${1:-}"
if [[ -z "$repository" ]]; then
  repository="$(git rev-parse --show-toplevel 2>/dev/null)" || fail 'Pass the repository path when not running inside a Git checkout.'
fi
[[ -d "$repository" ]] || fail 'The repository path does not exist.'
repository="$(cd -- "$repository" && pwd -P)"

temporary_root="${TMPDIR:-/tmp}"
[[ -d "$temporary_root" ]] || fail 'TMPDIR does not exist.'
temporary_root="$(cd -- "$temporary_root" && pwd -P)"
if [[ "$temporary_root" == "$repository" || "$temporary_root" == "$repository/"* ]]; then
  fail 'TMPDIR must be outside the repository.'
fi
input_dir="$(mktemp -d "${temporary_root%/}/thepaperleaf-gsc-input.XXXXXX")"
analysis_dir="$(mktemp -d "${temporary_root%/}/thepaperleaf-gsc-analysis.XXXXXX")"
input_path="$input_dir/search-insights.json"
analysis_path="$analysis_dir/analysis.json"
completed=0

cleanup() {
  rm -rf -- "$input_dir"
  if [[ "$completed" -ne 1 ]]; then rm -rf -- "$analysis_dir"; fi
}
trap cleanup EXIT

{
  printf '%s\n' 'header = "Accept: application/json"'
  printf 'header = "Authorization: Bearer %s"\n' "$export_token"
} | curl --config - \
  --fail \
  --silent \
  --show-error \
  --retry 3 \
  --connect-timeout 15 \
  --max-time 300 \
  --max-filesize 52428800 \
  --proto '=https' \
  --tlsv1.2 \
  --output "$input_path" \
  --url "$export_url"
unset export_token

python3 "$skill_root/scripts/gsc_optimizer.py" validate "$input_path" >/dev/null

analysis_args=(analyze "$input_path" --repo "$repository" --output "$analysis_path")
if [[ "${PAPERLEAF_GSC_OFFLINE:-0}" == 1 ]]; then analysis_args+=(--offline); fi
python3 "$skill_root/scripts/gsc_optimizer.py" "${analysis_args[@]}"

completed=1
printf 'Private analysis written to: %s\n' "$analysis_path"
