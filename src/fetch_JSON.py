# Running this script will fetch the JSON from the API and save it to a file
# I am saving it as a file to ensure that the analysis later can be reproducible

import json
from datetime import datetime
from pathlib import Path
import requests


URL = "https://json.buienradar.nl"

# Fetches and returns the JSON from the API
def fetch_json(url=URL, timeout_s=20):
    resp = requests.get(url, timeout=timeout_s)
    resp.raise_for_status()
    return resp.json()


# Fetches the JSON
payload = fetch_json()

# Creates the output directory if it doesn't exist
out_dir = Path("data/raw")
out_dir.mkdir(parents=True, exist_ok=True)

# Creates the output file name with the timestamp
ts = datetime.now().strftime("%Y%m%d-%H%M%S")
out_path = out_dir / f"buienradar-{ts}.json"
# Writes the JSON to the output file
out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"Saved raw JSON to: {out_path}")



