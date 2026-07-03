from flask import Flask, jsonify
import subprocess
from pathlib import Path
from datetime import datetime
import sys
import traceback

app = Flask(__name__)

BASE_DIR = Path(__file__).parent


SCRIPT_PATH = BASE_DIR / "run_optimized_queries.py"
RESULTS_DIR = BASE_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)

@app.route("/run-optimized-queries", methods=["POST"])
def run_optimized_queries_endpoint():
    """
    Pokrene run_queries.py kao poseban proces i vrati status + putanje do log fajlova.
    Bez obzira na grešku, API vraća JSON (nema više socket hang up).
    """
    if not SCRIPT_PATH.exists():
        return jsonify({
            "status": "error",
            "message": f"run_optimized_queries.py nije pronađen na putanji: {SCRIPT_PATH}"
        }), 500

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    stdout_file = RESULTS_DIR / f"api_output_{ts}.txt"
    stderr_file = RESULTS_DIR / f"api_error_{ts}.txt"

    try:
        # Koristi isti Python interpreter koji pokreće Flask
        proc = subprocess.run(
            [sys.executable, str(SCRIPT_PATH)],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True
        )

        stdout_file.write_text(proc.stdout or "", encoding="utf-8")
        stderr_file.write_text(proc.stderr or "", encoding="utf-8")

        status = "success" if proc.returncode == 0 else "error"

        return jsonify({
            "status": status,
            "exit_code": proc.returncode,
            "stdout_file": str(stdout_file),
            "stderr_file": str(stderr_file),
            "stdout_preview": (proc.stdout or "")[:500],
            "stderr_preview": (proc.stderr or "")[:500],
        }), (200 if proc.returncode == 0 else 500)

    except Exception as e:
        # Ako subprocess.run baci izuzetak, ne rušimo Flask već vraćamo JSON
        err_text = "".join(traceback.format_exception(type(e), e, e.__traceback__))
        stderr_file.write_text(err_text, encoding="utf-8")

        return jsonify({
            "status": "exception",
            "message": str(e),
            "traceback_file": str(stderr_file)
        }), 500




@app.route("/run-optimized-queries-timings", methods=["POST"])
def run_optimized_queries_timings():
    runner = BASE_DIR / "run_optimized_queries_with_timings.py"
    if not runner.exists():
        return jsonify({"status": "error", "message": f"Runner nije pronađen: {runner}"}), 500

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    stdout_file = RESULTS_DIR / f"timings_api_output_{ts}.txt"
    stderr_file = RESULTS_DIR / f"timings_api_error_{ts}.txt"

    try:
        proc = subprocess.run(
            [sys.executable, str(runner)],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True
        )

        stdout_file.write_text(proc.stdout or "", encoding="utf-8")
        stderr_file.write_text(proc.stderr or "", encoding="utf-8")

        # pokušaj da iz stdout-a izvučeš TIMINGS_FILE
        timings_file = None
        for line in (proc.stdout or "").splitlines():
            if line.startswith("TIMINGS_FILE:"):
                timings_file = line.split("TIMINGS_FILE:", 1)[1].strip()
                break

        return jsonify({
            "status": "success" if proc.returncode == 0 else "error",
            "exit_code": proc.returncode,
            "timings_file": timings_file,
            "stdout_preview": (proc.stdout or "")[:800],
            "stderr_preview": (proc.stderr or "")[:800],
            "stdout_log": str(stdout_file),
            "stderr_log": str(stderr_file),
        }), (200 if proc.returncode == 0 else 500)

    except Exception as e:
        err_text = "".join(traceback.format_exception(type(e), e, e.__traceback__))
        stderr_file.write_text(err_text, encoding="utf-8")
        return jsonify({"status": "exception", "message": str(e), "traceback_file": str(stderr_file)}), 500




if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)
