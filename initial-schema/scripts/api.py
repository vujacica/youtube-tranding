from flask import Flask, jsonify
import subprocess
import os
from datetime import datetime
from pathlib import Path

app = Flask(__name__)

SCRIPT_PATH = Path(__file__).parent / "run_queries.py"
RESULTS_DIR = Path(__file__).parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

@app.route("/run-queries", methods=["POST"])
def run_queries_endpoint():
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    stdout_file = RESULTS_DIR / f"api_output_{ts}.txt"
    stderr_file = RESULTS_DIR / f"api_error_{ts}.txt"

    proc = subprocess.run(
        ["python", str(SCRIPT_PATH)],
        capture_output=True,
        text=True
    )

    stdout_file.write_text(proc.stdout or "", encoding="utf-8")
    stderr_file.write_text(proc.stderr or "", encoding="utf-8")

    status = "success" if proc.returncode == 0 else "error"

    return jsonify({
        "status": status,
        "stdout_file": str(stdout_file),
        "stderr_file": str(stderr_file),
        "exit_code": proc.returncode
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
