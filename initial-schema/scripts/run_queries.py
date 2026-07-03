import subprocess, sys, os, shutil
from pathlib import Path
from datetime import datetime
import glob
import json 

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "yt_trending")

HERE = Path(__file__).resolve().parent
QUERIES_JS = (HERE.parent / "queries" / "student2_queries_initial.js").resolve()

OUT_DIR = HERE.parent / "results"
OUT_DIR.mkdir(parents=True, exist_ok=True)

def find_exe():
    env_path = os.getenv("MONGOSH_BIN")
    if env_path and Path(env_path.strip('"')).exists():
        return env_path.strip('"'), "mongosh"

    p = shutil.which("mongosh")
    if p:
        return p, "mongosh"

    candidates = []
    candidates += glob.glob(r"C:\Program Files\MongoDB\mongosh\mongosh.exe")
    candidates += glob.glob(r"C:\Program Files\MongoDB\Server\*\bin\mongosh.exe")
    for c in candidates:
        if Path(c).exists():
            return c, "mongosh"

    p2 = shutil.which("mongo")
    if p2:
        return p2, "mongo"

    return None, None


def extract_timings(stdout: str):
    """
    Izvlači TIMINGS_JSON iz stdout-a ako postoji
    """
    for line in stdout.splitlines():
        if line.startswith("TIMINGS_JSON:"):
            try:
                return json.loads(line[len("TIMINGS_JSON:"):])
            except json.JSONDecodeError:
                return None
    return None


def run_queries():
    if not QUERIES_JS.exists():
        print(f"[ERROR] JS fajl ne postoji: {QUERIES_JS}")
        sys.exit(1)

    exe, kind = find_exe()
    if not exe:
        print("[ERROR] Nije pronađen Mongo shell.")
        sys.exit(1)

    if kind == "mongosh":
        cmd = [exe, f"{MONGODB_URI}/{DB_NAME}", "--file", str(QUERIES_JS), "--quiet"]
    else:
        js_path = str(QUERIES_JS).replace("\\", "\\\\")
        cmd = [exe, f"{DB_NAME}", "--quiet", "--eval", f'load("{js_path}")']

    print("> Running:", " ".join(cmd))

    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(HERE))

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    # raw logovi
    out_file = OUT_DIR / f"initial_queries_output_{ts}.txt"
    err_file = OUT_DIR / f"initial_queries_error_{ts}.txt"
    out_file.write_text(proc.stdout or "", encoding="utf-8")
    err_file.write_text(proc.stderr or "", encoding="utf-8")


    timings_payload = extract_timings(proc.stdout or "")

    if timings_payload:
        timings_file = OUT_DIR / f"initial_timings_{ts}.json"
        timings_file.write_text(
            json.dumps(timings_payload, indent=2),
            encoding="utf-8"
        )
        print(f"[SAVED] Timings JSON → {timings_file}")
    else:
        print("[WARN] TIMINGS_JSON nije pronađen u output-u.")

    if proc.returncode == 0:
        print(proc.stdout)
        print(f"\n[SAVED] Console output → {out_file}")
        if (proc.stderr or "").strip():
            print(f"[WARN] Non-fatal stderr → {err_file}")
    else:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        print(f"\n[ERROR] Shell exit code: {proc.returncode}")
        print(f"[SAVED] stdout: {out_file}")
        print(f"[SAVED] stderr: {err_file}")
        sys.exit(proc.returncode)


if __name__ == "__main__":
    run_queries()
