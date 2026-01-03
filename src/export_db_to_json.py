import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


DB_PATH = Path("data/weather.sqlite")
OUT_DIR = Path("web/public/data")


def export() -> None:
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Missing database at {DB_PATH}. Create it first.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        stations = [dict(r) for r in conn.execute("SELECT * FROM stations ORDER BY stationid")]
        measurements = [dict(r) for r in conn.execute("SELECT * FROM measurements ORDER BY timestamp, stationid")]
    finally:
        conn.close()

    meta = {
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "db_path": str(DB_PATH),
        "stations_count": len(stations),
        "measurements_count": len(measurements),
    }

    (OUT_DIR / "stations.json").write_text(json.dumps(stations, ensure_ascii=False), encoding="utf-8")
    (OUT_DIR / "measurements.json").write_text(json.dumps(measurements, ensure_ascii=False), encoding="utf-8")
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Wrote {OUT_DIR / 'stations.json'}")
    print(f"Wrote {OUT_DIR / 'measurements.json'}")
    print(f"Wrote {OUT_DIR / 'meta.json'}")


if __name__ == "__main__":
    export()


