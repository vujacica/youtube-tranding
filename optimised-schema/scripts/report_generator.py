import json
import re
import argparse
from pathlib import Path

import matplotlib.pyplot as plt


def load_timings(path: Path) -> dict:
    """
    Vraća dict: { qnum: (display_label, ms) }
    Grupise po broju upita izvucenom iz labela (npr. "Q1", "Q1-OPT", "Q1 -- ...").
    Preskace stavke gdje ok != True ili ms nije broj.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for t in data.get("timings", []):
        label = t.get("label")
        ms = t.get("ms")
        ok = t.get("ok", True)
        if not ok:
            continue
        if not (isinstance(label, str) and isinstance(ms, (int, float))):
            continue
        m = re.match(r"^\s*Q(\d+)", label, re.IGNORECASE)
        qnum = int(m.group(1)) if m else None
        key = qnum if qnum is not None else label.strip().lower()
        out[key] = (label.strip(), float(ms))
    return out


def main():
    ap = argparse.ArgumentParser(description="Bar chart comparison for initial vs optimized timings JSON.")
    ap.add_argument("--initial", required=True, help="Path to initial JSON file")
    ap.add_argument("--optimized", required=True, help="Path to optimized JSON file")
    ap.add_argument("--out", default="timings_comparison.png", help="Output PNG path")
    ap.add_argument("--title", default="Initial vs Optimized execution time (Q1-Q5)", help="Chart title")
    ap.add_argument("--sort", choices=["q", "initial", "optimized"], default="q",
                     help="How to sort bars")
    args = ap.parse_args()

    initial = load_timings(Path(args.initial))
    optimized = load_timings(Path(args.optimized))

    keys = sorted(set(initial.keys()) | set(optimized.keys()),
                   key=lambda k: (0, k) if isinstance(k, int) else (1, k))

    rows = []
    for k in keys:
        ini_label, ini_ms = initial.get(k, (None, 0.0))
        opt_label, opt_ms = optimized.get(k, (None, 0.0))
        display = f"Q{k}" if isinstance(k, int) else (ini_label or opt_label or str(k))
        rows.append((display, ini_ms, opt_ms))

    if args.sort == "initial":
        rows.sort(key=lambda x: x[1], reverse=True)
    elif args.sort == "optimized":
        rows.sort(key=lambda x: x[2], reverse=True)
    # "q" sort already applied via `keys` ordering above

    labels = [r[0] for r in rows]
    ini_vals = [r[1] for r in rows]
    opt_vals = [r[2] for r in rows]

    x = list(range(len(labels)))
    width = 0.38

    plt.figure(figsize=(10, 6))
    plt.bar([i - width / 2 for i in x], ini_vals, width=width, label="Initial")
    plt.bar([i + width / 2 for i in x], opt_vals, width=width, label="Optimized")

    plt.xticks(x, labels, rotation=0)
    plt.ylabel("Time (ms)")
    plt.title(args.title)
    plt.legend()

    plt.tight_layout()
    plt.savefig(args.out, dpi=200)
    print(f"[OK] Saved chart to: {Path(args.out).resolve()}")


if __name__ == "__main__":
    main()