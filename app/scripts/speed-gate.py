#!/usr/bin/env python3
import argparse
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent


def check(budget, value):
    if value is None:
        return None, "no number"
    if isinstance(value, (int, float)):
        limit = budget.get("max", budget.get("maxValue"))
        return value <= limit, f"{value} (limit {limit})"
    ok = True
    parts = []
    for key in ("median", "p95", "max", "percentOver20"):
        if key not in budget:
            continue
        got = value.get(key)
        if got is None:
            return None, f"{key} missing"
        parts.append(f"{key} {got} (limit {budget[key]})")
        ok = ok and got <= budget[key]
    return ok, ", ".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("report")
    ap.add_argument("--second-run")
    ap.add_argument("--idle-cpu", type=float)
    ap.add_argument("--memory-mb", type=float)
    ap.add_argument("--editor-kb", type=float)
    ap.add_argument("--app-mb", type=float)
    args = ap.parse_args()

    budgets = json.loads((HERE / "speed-budgets.json").read_text())
    report = json.loads(pathlib.Path(args.report).read_text())
    rows = dict(report.get("rows", {}))
    errors = [("measured", e) for e in report.get("errors", [])]
    if args.second_run:
        second_report = json.loads(pathlib.Path(args.second_run).read_text())
        rows["launchWithTabs"] = second_report.get("rows", {}).get("launchToFirstPaint")
        errors += [("reopen run", e) for e in second_report.get("errors", [])]
    if args.idle_cpu is not None:
        rows["idleCpu"] = args.idle_cpu
    if args.memory_mb is not None:
        rows["memoryMb"] = args.memory_mb
    if args.editor_kb is not None:
        rows["editorBundleKb"] = args.editor_kb
    if args.app_mb is not None:
        rows["appBundleMb"] = args.app_mb

    failed = 0
    missing = 0
    for key, budget in budgets.items():
        ok, shown = check(budget, rows.get(key))
        word = "MISSING" if ok is None else ("PASS" if ok else "FAIL")
        failed += word == "FAIL"
        missing += word == "MISSING"
        print(f"{word:8} {budget['label']}: {shown}")
    for run, error in errors:
        print(f"ERROR    {run}: {error.splitlines()[0] if error else error}")
    print()
    bad = failed or missing or errors
    print(f"{'NOT PASSED' if bad else 'ALL PASS'}: {failed} failed, {missing} missing, {len(errors)} scenario errors")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
