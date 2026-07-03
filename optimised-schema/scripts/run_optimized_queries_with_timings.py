import subprocess, sys, os, shutil, glob, json
from pathlib import Path
from datetime import datetime

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "yt_trending")

HERE = Path(__file__).resolve().parent
QUERIES_JS = (HERE.parent / "queries" / "student2_queries_optimized.js").resolve()

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

def run_queries_and_extract_timings():
    if not QUERIES_JS.exists():
        print(f"[ERROR] JS fajl ne postoji: {QUERIES_JS}", file=sys.stderr)
        sys.exit(1)

    exe, kind = find_exe()
    if not exe:
        print("[ERROR] Nije pronađen mongosh/mongo.", file=sys.stderr)
        sys.exit(1)

    if kind == "mongosh":
        cmd = [exe, f"{MONGODB_URI}/{DB_NAME}", "--file", str(QUERIES_JS), "--quiet"]
    else:
        js_path = str(QUERIES_JS).replace("\\", "\\\\")
        cmd = [exe, f"{DB_NAME}", "--quiet", "--eval", f'load("{js_path}")']

    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(HERE))

    # Snimi raw logove (korisno za debugging)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = OUT_DIR / f"queries_output_{ts}.txt"
    err_file = OUT_DIR / f"queries_error_{ts}.txt"
    out_file.write_text(proc.stdout or "", encoding="utf-8")
    err_file.write_text(proc.stderr or "", encoding="utf-8")

    timings_payload = None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("TIMINGS_JSON:"):
            json_str = line[len("TIMINGS_JSON:"):]
            timings_payload = json.loads(json_str)
            break

    if timings_payload is None:
        # ako JS nije emitovao timings
        timings_payload = {
            "generatedAt": datetime.utcnow().isoformat() + "Z",
            "timings": [],
            "warning": "TIMINGS_JSON nije pronađen u stdout-u. Provjeri da li emitTimingsJSON() postoji i pozvan je na kraju JS fajla."
        }

    # upiši timings u json fajl
    timings_file = OUT_DIR / f"timings_{ts}.json"
    timings_file.write_text(json.dumps(timings_payload, indent=2), encoding="utf-8")

    # izlazni kod čuvamo (ako je mongosh failovao)
    return proc.returncode, str(timings_file), timings_payload, str(out_file), str(err_file)

if __name__ == "__main__":
    code, timings_path, timings_payload, out_log, err_log = run_queries_and_extract_timings()
    # ispiši da Flask može da pokupi (opciono)
    print("TIMINGS_FILE:" + timings_path)
    sys.exit(code)
