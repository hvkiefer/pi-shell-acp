#!/usr/bin/env python3
"""Register (or --remove) entwurf in a pi settings.json packages[].

The SINGLE predicate / idempotency / fail-loud SSOT shared by BOTH scopes and by
remove, so install and uninstall can never drift to different meanings:
  - project  <repo>/.pi/settings.json     (run.sh install_local_package / remove_local_package)
  - user     ~/.pi/agent/settings.json    (run.sh register_user_scope_citizen)

Register is idempotent: absent → append REPO_DIR; already the sole canonical
entry → no-op (file not rewritten, mtime stable); any other entwurf entry (object
form, stale path, duplicate) collapses into one canonical string form. Remove
drops every entwurf entry. Both use is_entwurf_source(), so a look-alike repo
(entwurf-notes, openclaw-entwurf) is neither wrongly registered-over nor wrongly
removed. Every non-entwurf package and every other settings key is preserved.

This wiring (user scope) dropped when `pi install` was removed from setup
(2026-07-03: `--entwurf-control` unknown in a foreign cwd). Extracting it here
lets run.sh (both scopes + remove) and smoke-user-scope-citizen share ONE
implementation — mirrors the meta-bridge-state.py split.

Usage: register-pi-package.py <settings.json> <repo_dir> [--remove]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def source_of(item: object) -> object:
    """The package spec of a packages[] entry — string form or {"source": …}."""
    return item.get("source") if isinstance(item, dict) else item


def is_entwurf_source(source: str, repo_dir: str) -> bool:
    """True iff this package entry points at THIS entwurf — the only entries
    register/remove may touch. Strict on purpose: user-scope settings are GLOBAL,
    so a substring "entwurf" match would wrongly eat unrelated repos like
    entwurf-notes, openclaw-entwurf, or somebody else's git repo named entwurf.

    Managed shapes:
      - the exact resolved repo dir;
      - an npm install path ending in node_modules/@junghanacs/entwurf;
      - an explicit npm package source for @junghanacs/entwurf;
      - a local filesystem path whose final directory is literally "entwurf"
        (dev clone / stale move). Remote URL/git-like strings are NOT treated as
        local paths merely because their last segment is "entwurf".
    """
    p = source.rstrip("/")
    if p == repo_dir or p.endswith("/node_modules/@junghanacs/entwurf"):
        return True
    if p == "npm:@junghanacs/entwurf" or p.startswith("npm:@junghanacs/entwurf@"):
        return True
    local_like = p.startswith(("/", "./", "../", "~"))
    return local_like and Path(p).name == "entwurf"


def _load(settings_path: Path) -> dict:
    if settings_path.exists():
        data = json.loads(settings_path.read_text())
        if not isinstance(data, dict):
            raise SystemExit(f"{settings_path} is not a JSON object")
        return data
    return {}


def _packages(settings_path: Path, data: dict) -> list:
    packages = data.get("packages")
    if packages is None:
        return []
    if not isinstance(packages, list):
        # A settings file with a corrupt packages shape must NOT be silently
        # coerced to [] — that would drop the operator's real packages.
        raise SystemExit(f"{settings_path}: packages is not a JSON array")
    return packages


def _entwurf_matches(packages: list, repo_dir: str) -> list:
    return [
        item for item in packages
        if isinstance(source_of(item), str) and is_entwurf_source(source_of(item), repo_dir)  # type: ignore[arg-type]
    ]


def register(settings_path: Path, repo_dir_arg: str) -> str:
    """"noop" if entwurf is already the sole canonical entry (file untouched),
    else "registered" (rewritten with a single canonical entry)."""
    repo_dir = str(Path(repo_dir_arg).resolve())
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    data = _load(settings_path)
    packages = _packages(settings_path, data)

    entwurf_entries = _entwurf_matches(packages, repo_dir)
    # Already correct iff exactly ONE entwurf entry and it is the canonical string
    # form at repo_dir. Order-insensitive; no rewrite → mtime stable.
    if len(entwurf_entries) == 1 and entwurf_entries[0] == repo_dir:
        return "noop"

    filtered = [item for item in packages if item not in entwurf_entries]
    data["packages"] = filtered + [repo_dir]
    settings_path.write_text(json.dumps(data, indent=2) + "\n")
    return "registered"


def remove(settings_path: Path, repo_dir_arg: str) -> int:
    """Drop every entwurf entry (any shape/path). Returns the count removed."""
    repo_dir = str(Path(repo_dir_arg).resolve())
    if not settings_path.exists():
        return 0
    data = _load(settings_path)
    packages = _packages(settings_path, data)

    entwurf_entries = _entwurf_matches(packages, repo_dir)
    if not entwurf_entries:
        return 0
    data["packages"] = [item for item in packages if item not in entwurf_entries]
    settings_path.write_text(json.dumps(data, indent=2) + "\n")
    return len(entwurf_entries)


def would_remove(settings_path: Path, repo_dir_arg: str) -> int:
    """Count the entwurf entries a --remove WOULD drop, writing NOTHING.

    Read-only companion to remove() for --dry-run — lets a caller (e.g. run.sh's
    project `remove` pointer note) decide whether the global user-scope inverse is
    worth suggesting without mutating the operator's settings.
    """
    repo_dir = str(Path(repo_dir_arg).resolve())
    if not settings_path.exists():
        return 0
    data = _load(settings_path)
    packages = _packages(settings_path, data)
    return len(_entwurf_matches(packages, repo_dir))


def main(argv: list[str]) -> int:
    flags = {a for a in argv[1:] if a.startswith("--")}
    args = [a for a in argv[1:] if not a.startswith("--")]
    do_remove = "--remove" in flags
    dry_run = "--dry-run" in flags
    known = {"--remove", "--dry-run"}
    unknown = flags - known
    if unknown:
        raise SystemExit(f"unknown flag(s): {', '.join(sorted(unknown))}")
    # --dry-run is a REMOVE-only preview. Without --remove it would otherwise fall
    # through to the register path and WRITE — a flag literally named "dry-run"
    # mutating settings is an install-hygiene footgun, so reject it loud instead of
    # silently registering.
    if dry_run and not do_remove:
        raise SystemExit("--dry-run is only supported with --remove")
    if len(args) != 2:
        raise SystemExit("usage: register-pi-package.py <settings.json> <repo_dir> [--remove] [--dry-run]")
    settings_path = Path(args[0])
    repo_dir_arg = args[1]
    resolved = str(Path(repo_dir_arg).resolve())

    if do_remove:
        if dry_run:
            n = would_remove(settings_path, repo_dir_arg)
            if n:
                print(f"remove: would remove {n} entwurf packages[] entr{'y' if n == 1 else 'ies'} from {settings_path}")
            else:
                print(f"remove: no entwurf packages[] entry to remove ({settings_path})")
            return 0
        n = remove(settings_path, repo_dir_arg)
        if n:
            print(f"remove: removed {n} entwurf packages[] entr{'y' if n == 1 else 'ies'} from {settings_path}")
        else:
            print(f"remove: no entwurf packages[] entry to remove ({settings_path})")
        return 0

    result = register(settings_path, repo_dir_arg)
    if result == "noop":
        print(f"install: entwurf package already registered (no-op) -> {resolved}")
    else:
        print(f"install: registered entwurf package -> {settings_path}")
        print(f"install: package source -> {resolved}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
