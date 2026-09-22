import subprocess, sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
for script in ("fetch_data.py", "model.py"):
    print(f"\n>>> {script}")
    subprocess.run([sys.executable, str(ICI / script)], check=True)