"""End-to-end: runs scripts/run_fake_gd.py (own server, mock LLM) and expects success."""

import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def test_full_fake_gd() -> None:
    proc = subprocess.run(
        [sys.executable, "scripts/run_fake_gd.py", "--duration", "30", "--participants", "4", "--quiet"],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=240,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "PASS" in proc.stdout

