import subprocess, sys, os, shutil
from pathlib import Path
from datetime import datetime
import glob

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "yt_trending")

HERE = Path(__file__).resolve().parent

# putanja ka glavnim upitima
QUERIES_JS = (HERE.parent / "queries" / "student2_queries_optimized.js").resolve()

# putanja ka prepare skripti
PREPARE_JS = (HERE.parent / "queries" / "prepare_data.js").resolve()

OUT_DIR = HERE.parent / "results"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# -------------------------------------------------------------
# Pronalaženje mongosh
# -------------------------------------------------------------
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


# -------------------------------------------------------------
# Pokretanje prepare_data.js (denormalizacija)
# -------------------------------------------------------------
def run_prepare_script():
    if not PREPARE_JS.exists():
        print(f"[WARN] Prepare skripta ne postoji: {PREPARE_JS}")
        return

    exe, kind = find_exe()
    if not exe:
        print("[ERROR] Nije pronađen mongosh. Preskačem prepare skriptu.")
        return

    if kind == "mongosh":
        cmd = [exe, f"{MONGODB_URI}/{DB_NAME}", "--file", str(PREPARE_JS), "--quiet"]
    else:
        js_path = str(PREPARE_JS).replace("\\", "\\\\")
        cmd = [exe, f"{DB_NAME}", "--quiet", "--eval", f'load("{js_path}")']

    print("\n> Running prepare_data.js ...")
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(HERE))

    # upis logova
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = OUT_DIR / f"prepare_output_{ts}.txt"
    err_file = OUT_DIR / f"prepare_error_{ts}.txt"

    out_file.write_text(proc.stdout or "", encoding="utf-8")
    err_file.write_text(proc.stderr or "", encoding="utf-8")

    if proc.returncode == 0:
        print("[OK] prepare_data.js završena uspješno")
        if proc.stdout:
            print(proc.stdout)
    else:
        print("[ERROR] prepare_data.js nije uspješno izvršena")
        print(proc.stderr)


# -------------------------------------------------------------
# Pokretanje optimized queries
# -------------------------------------------------------------
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

    print("\n> Running optimized queries:", " ".join(cmd))

    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(HERE))

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = OUT_DIR / f"queries_output_{ts}.txt"
    err_file = OUT_DIR / f"queries_error_{ts}.txt"

    out_file.write_text(proc.stdout or "", encoding="utf-8")
    err_file.write_text(proc.stderr or "", encoding="utf-8")

    if proc.returncode == 0:
        print(proc.stdout)
        print(f"\n[SAVED] console → {out_file}")
        if (proc.stderr or "").strip():
            print(f"[WARN] Non-fatal stderr → {err_file}")
    else:
        print(proc.stdout)
        print(proc.stderr, file=sys.stderr)
        print(f"[ERROR] Shell exit code: {proc.returncode}")
        print(f"[SAVED] stdout: {out_file}")
        print(f"[SAVED] stderr: {err_file}")
        sys.exit(proc.returncode)


# -------------------------------------------------------------
# MAIN
# -------------------------------------------------------------
if __name__ == "__main__":
    run_prepare_script()  # <<< OVDJE SE POZIVA PREPARE SKRIPTA !!!
    run_queries()
