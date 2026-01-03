import json
from pathlib import Path
import pandas as pd
import sqlite3


RAW_DIR = Path("data/raw")
DB_PATH = Path("data/weather.sqlite")

# finds the path to the latest raw JSON file
def find_latest(raw_dir = RAW_DIR):
    # finds and sorts the files by name (datetime is in the filename)
    candidates = sorted(raw_dir.glob("buienradar-*.json"))
    
    # if no files are found, raise an error
    if not candidates:
        raise FileNotFoundError(f"No raw JSON files found in {raw_dir!s}. Run fetch_JSON.py first")
    
    # return the latest meassurment
    return candidates[-1]


# loads the JSON from the path
def load_payload(path):
    return json.loads(path.read_text(encoding="utf-8"))

def to_dataframes(payload):
    """
    Build normalized (3NF / BCNF) "table" DataFrames from the Buienradar payload.

    Functional dependencies we’re enforcing:
      - stationid -> stationname, lat, lon, regio     (stations table)
      - (stationid, timestamp) -> measurement fields  (measurements table)

    This avoids repeating station attributes on every measurement row and is BCNF
    under the assumption stationid is a key for station attributes.
    """
    
    # gets the station measurements from the payload
    rows = payload.get("actual", {}).get("stationmeasurements", [])
    df_raw = pd.DataFrame.from_records(rows)

    # Station dimension (one row per stationid)
    # PK is stationid
    df_stations = (
        df_raw[["stationid", "stationname", "lat", "lon", "regio"]]
        .copy()
        .dropna(subset=["stationid"])
        .drop_duplicates(subset=["stationid"])
        .reset_index(drop=True)
    )

    # Measurement fact (one row per stationid + timestamp)
    # PK will be created later in SQLite as AUTOINCREMENT)
    # CK (candidate key) is (stationid, timestamp)
    # FK is stationid
    df_measurements = df_raw[
        [
            "timestamp",
            "temperature",
            "groundtemperature",
            "feeltemperature",
            "windgusts",
            "windspeedBft",
            "humidity",
            "precipitation",
            "sunpower",
            "stationid",
        ]
    ].copy()

    # Basic type normalization (helps later when writing to SQLite)
    df_measurements["timestamp"] = pd.to_datetime(df_measurements["timestamp"], errors="coerce")
    df_measurements["stationid"] = pd.to_numeric(df_measurements["stationid"], errors="coerce").astype("Int64")
    df_stations["stationid"] = pd.to_numeric(df_stations["stationid"], errors="coerce").astype("Int64")

    df_measurements["windspeedBft"] = pd.to_numeric(df_measurements["windspeedBft"], errors="coerce").astype("Int64")

    # type normalization for the measurement fields
    for c in [
        "temperature",
        "groundtemperature",
        "feeltemperature",
        "windgusts",
        "humidity",
        "precipitation",
        "sunpower",
    ]:
        df_measurements[c] = pd.to_numeric(df_measurements[c], errors="coerce")

    df_measurements = df_measurements.dropna(subset=["timestamp", "stationid"]).reset_index(drop=True)
    return df_stations, df_measurements

# SQL schema for the database
SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

-- Stations table (3NF / BCNF)
-- PK: stationid
CREATE TABLE IF NOT EXISTS stations (
  stationid INTEGER PRIMARY KEY,
  stationname TEXT NOT NULL,
  lat REAL,
  lon REAL,
  regio TEXT
);

-- Measurements table (3NF / BCNF)
-- PK: measurementid (surrogate key)
-- CK (candidate key): (stationid, timestamp)
-- FK: stationid -> stations.stationid
CREATE TABLE IF NOT EXISTS measurements (
  measurementid INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  temperature REAL,
  groundtemperature REAL,
  feeltemperature REAL,
  windgusts REAL,
  windspeedBft INTEGER,
  humidity REAL,
  precipitation REAL,
  sunpower REAL,
  stationid INTEGER NOT NULL,
  FOREIGN KEY (stationid) REFERENCES stations(stationid)
);

-- Dedupe constraint (so repeated runs don’t duplicate the same snapshot)
CREATE UNIQUE INDEX IF NOT EXISTS ux_measurements_station_ts
  ON measurements(stationid, timestamp);

CREATE INDEX IF NOT EXISTS ix_measurements_ts
  ON measurements(timestamp);

CREATE INDEX IF NOT EXISTS ix_measurements_station
  ON measurements(stationid);
"""

# converts numpy.nan to None
def _na_to_none(x):
    if pd.isna(x):
        return None
    # sqlite3 parameter binding does not reliably accept numpy scalar types
    # (e.g. numpy.int64). Convert to native Python types when possible.
    if hasattr(x, "item"):
        try:
            return x.item()
        except Exception:
            pass
    return x

# ensures the schema is created
def ensure_schema(conn):
    conn.executescript(SCHEMA_SQL)
    conn.commit()

# loads the stations to the database
def load_stations(conn, df_stations):
    sql = """
    INSERT INTO stations (stationid, stationname, lat, lon, regio)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(stationid) DO UPDATE SET
      stationname=excluded.stationname,
      lat=excluded.lat,
      lon=excluded.lon,
      regio=excluded.regio
    """
    rows = [
        tuple(_na_to_none(v) for v in r)
        for r in df_stations[["stationid", "stationname", "lat", "lon", "regio"]].itertuples(index=False, name=None)
    ]
    conn.executemany(sql, rows)
    conn.commit()
    return len(rows)


def load_measurements(conn, df_measurements):
    # Store timestamps as ISO-8601 strings in SQLite
    df = df_measurements.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%S")

    sql = """
    INSERT INTO measurements (
      timestamp, temperature, groundtemperature, feeltemperature,
      windgusts, windspeedBft, humidity, precipitation, sunpower,
      stationid
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stationid, timestamp) DO NOTHING
    """

    cols = [
        "timestamp",
        "temperature",
        "groundtemperature",
        "feeltemperature",
        "windgusts",
        "windspeedBft",
        "humidity",
        "precipitation",
        "sunpower",
        "stationid",
    ]
    rows = [tuple(_na_to_none(v) for v in r) for r in df[cols].itertuples(index=False, name=None)]
    conn.executemany(sql, rows)
    conn.commit()
    return len(rows)

def main():
    # finds the latest meassuremnts and stores it as dataframes
    json_path = find_latest()
    payload = load_payload(json_path)
    df_stations, df_measurements = to_dataframes(payload)

    # Write dataframes to SQLite 
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        ensure_schema(conn)
        n_stations = load_stations(conn, df_stations)
        n_measurements = load_measurements(conn, df_measurements)
    finally:
        conn.close()

if __name__ == "__main__":
    main()



