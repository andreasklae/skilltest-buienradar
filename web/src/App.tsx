import { useEffect, useMemo, useState } from "react";
import type { Measurement, Meta, Station } from "./types";
import { byStationId, latestTimestamp, maxBy, mean } from "./utils";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; stations: Station[]; measurements: Measurement[]; meta: Meta | null };

type MetricKey =
  | "temperature"
  | "feeltemperature"
  | "precipitation"
  | "humidity"
  | "windgusts"
  | "sunpower"
  | "windspeedBft";

type TimeRangeKey = "all" | "6h" | "24h" | "7d";

function fmt(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function toMillis(tsIso: string): number {
  // ISO-8601 (no timezone) -> treated as local by Date; good enough for relative windows.
  return new Date(tsIso).getTime();
}

const METRICS: Array<{ key: MetricKey; title: string; unit: string; color: string }> = [
  { key: "temperature", title: "Temperature", unit: "°C", color: "#7c3aed" },
  { key: "feeltemperature", title: "Feel temperature", unit: "°C", color: "#a855f7" },
  { key: "humidity", title: "Humidity", unit: "%", color: "#22c55e" },
  { key: "precipitation", title: "Precipitation", unit: "mm", color: "#60a5fa" },
  { key: "windgusts", title: "Wind gusts", unit: "m/s", color: "#f97316" },
  { key: "windspeedBft", title: "Wind speed", unit: "Bft", color: "#eab308" },
  { key: "sunpower", title: "Sun power", unit: "", color: "#f59e0b" },
];

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedRegion, setSelectedRegion] = useState<string>(""); // Part 3: one region at a time
  const [timeRange, setTimeRange] = useState<TimeRangeKey>("24h");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const base = import.meta.env.BASE_URL; // honors GitHub Pages base path
        const [stationsRes, measurementsRes, metaRes] = await Promise.all([
          fetch(`${base}data/stations.json`),
          fetch(`${base}data/measurements.json`),
          fetch(`${base}data/meta.json`),
        ]);

        if (!stationsRes.ok || !measurementsRes.ok) {
          throw new Error(`Failed to load data exports (HTTP ${stationsRes.status}/${measurementsRes.status})`);
        }

        const stations = (await stationsRes.json()) as Station[];
        const measurements = (await measurementsRes.json()) as Measurement[];
        const meta = metaRes.ok ? ((await metaRes.json()) as Meta) : null;

        if (!cancelled) setState({ status: "ready", stations, measurements, meta });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        if (!cancelled) setState({ status: "error", message: msg });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const computed = useMemo(() => {
    if (state.status !== "ready") return null;

    const stationsById = byStationId(state.stations);
    const latestTs = latestTimestamp(state.measurements);
    const latest = latestTs ? state.measurements.filter((m) => m.timestamp === latestTs) : state.measurements;

    // -----------------------------
    // Part 2 answers (UNFILTERED)
    // -----------------------------
    const hottestAll = maxBy(latest, (m) => (typeof m.temperature === "number" ? m.temperature : -Infinity));
    const hottestAllStation = hottestAll ? stationsById.get(hottestAll.stationid) : undefined;

    const avgTempAll = mean(state.measurements.map((m) => m.temperature));

    const biggestDiffAll = maxBy(state.measurements, (m) => {
      if (typeof m.temperature !== "number" || typeof m.feeltemperature !== "number") return -Infinity;
      return Math.abs(m.feeltemperature - m.temperature);
    });
    const diffAllStation = biggestDiffAll ? stationsById.get(biggestDiffAll.stationid) : undefined;

    const northSeaStation =
      state.stations.find((s) => (s.regio || "").toLowerCase() === "noordzee") ||
      state.stations.find((s) => (s.stationname || "").toLowerCase().includes("zeeplatform"));

    // -----------------------------
    // Part 3 filters + charts only
    // -----------------------------
    // Region list (we pick one representative station per region).
    // If multiple stations exist for a region, we pick the first alphabetically.
    const byRegion = new Map<string, Station[]>();
    for (const s of state.stations) {
      const r = (s.regio || "Unknown").trim() || "Unknown";
      const arr = byRegion.get(r) || [];
      arr.push(s);
      byRegion.set(r, arr);
    }
    const regionEntries = Array.from(byRegion.entries())
      .map(([region, stations]) => {
        const station = stations.slice().sort((a, b) => a.stationname.localeCompare(b.stationname))[0];
        return { region, station };
      })
      .sort((a, b) => a.region.localeCompare(b.region));

    const selectedEntry =
      regionEntries.find((e) => e.region === selectedRegion) || regionEntries[0] || null;

    const selectedStationId = selectedEntry?.station.stationid ?? null;
    const stationIdsInScope = selectedStationId !== null ? new Set([selectedStationId]) : new Set<number>();

    const latestMs = latestTs ? toMillis(latestTs) : null;
    const cutoffMs =
      timeRange === "all" || latestMs === null
        ? null
        : latestMs - (timeRange === "6h" ? 6 : timeRange === "24h" ? 24 : 24 * 7) * 60 * 60 * 1000;

    const inTimeWindow = (m: Measurement) => (cutoffMs === null ? true : toMillis(m.timestamp) >= cutoffMs);

    const measurementsInScope = state.measurements.filter(
      (m) =>
        stationIdsInScope.has(m.stationid) &&
        inTimeWindow(m) &&
        true,
    );

    // Build wide time-series for each metric:
    // - columns: timestamp, avg, s<stationid>...
    function buildWideSeries(metricKey: MetricKey) {
      type Row = Record<string, unknown> & { timestamp: string; _sum: number; _n: number };
      const byTs = new Map<string, Row>();
      for (const m of measurementsInScope) {
        const v = m[metricKey];
        if (typeof v !== "number") continue;
        const row: Row = byTs.get(m.timestamp) || ({ timestamp: m.timestamp, _sum: 0, _n: 0 } as Row);
        const stationKey = `s${m.stationid}`;
        (row as any)[stationKey] = v; // dynamic station columns
        row._sum += v;
        row._n += 1;
        byTs.set(m.timestamp, row);
      }
      const rows = Array.from(byTs.values())
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
        .map((r) => {
          const out: any = { ...r };
          out.avg = r._n ? r._sum / r._n : null;
          delete out._sum;
          delete out._n;
          return out;
        });
      return rows;
    }

    // Part 3: latest snapshot row for the selected station
    const latestStationMeasurement =
      selectedStationId !== null && latestTs
        ? state.measurements.find((m) => m.stationid === selectedStationId && m.timestamp === latestTs) || null
        : null;

    const wideSeriesByMetric = Object.fromEntries(METRICS.map((m) => [m.key, buildWideSeries(m.key)])) as Record<
      MetricKey,
      any[]
    >;

    const selectedStation = selectedStationId !== null ? stationsById.get(selectedStationId) : null;

    return {
      latestTs,
      northSeaStation,
      // Part 2 (unfiltered)
      hottestAll,
      hottestAllStation,
      avgTempAll,
      biggestDiffAll,
      diffAllStation,
      // Part 3 (filtered)
      regionEntries,
      selectedEntry,
      selectedStationId,
      selectedStation,
      latestStationMeasurement,
      measurementsInScopeCount: measurementsInScope.length,
      wideSeriesByMetric,
    };
  }, [state, selectedRegion, timeRange]);

  // Initialize selectedRegion once data is loaded
  useEffect(() => {
    if (state.status !== "ready") return;
    if (selectedRegion) return;
    const regions = Array.from(
      new Set(state.stations.map((s) => (s.regio || "Unknown").trim() || "Unknown")),
    ).sort((a, b) => a.localeCompare(b));
    if (regions[0]) setSelectedRegion(regions[0]);
  }, [state, selectedRegion]);

  if (state.status === "loading") {
    return (
      <div className="container">
        <div className="header">
          <div>
            <div className="title">Dutch Weather Analysis</div>
            <div className="subtitle">Loading data…</div>
          </div>
        </div>
        <div className="card span-12">
          <div className="kpi">Loading…</div>
          <div className="kpiSub">Fetching exported JSON data from this site.</div>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="container">
        <div className="header">
          <div>
            <div className="title">Dutch Weather Analysis</div>
            <div className="subtitle">Could not load data</div>
          </div>
        </div>
        <div className="card error span-12">
          <h2>Error</h2>
          <div className="kpiSub">{state.message}</div>
          <div className="kpiSub" style={{ marginTop: 10 }}>
            Expected files: <code>web/public/data/stations.json</code> and <code>web/public/data/measurements.json</code>
          </div>
        </div>
      </div>
    );
  }

  const meta = state.meta;

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="title">Dutch Weather Analysis</div>
          <div className="subtitle">
            Answering Part 2 (Q5–Q8) + visualizing (9B) from the SQLite-backed dataset
          </div>
        </div>
        <div className="pill">
          Updated: <strong>{meta?.generated_at_utc ?? "—"}</strong>
        </div>
      </div>

      <div className="sectionHeader">
        <div className="sectionTitle">Part 1 — Data Integration</div>
        <div className="sectionNote">Database schema used for the dataset</div>
      </div>
      <div className="grid">
        <div className="card span-12 imgWrap">
          <h2>ERD</h2>
          <img src={`${import.meta.env.BASE_URL}ERD1.png`} alt="Database ERD" />
        </div>
      </div>

      <div className="sectionHeader">
        <div className="sectionTitle">Part 2 — Data Analysis (Q5–Q8)</div>
        <div className="sectionNote">These answers are based on the full dataset (no filters).</div>
      </div>
      <div className="grid">
        <div className="card span-4">
          <h2>Q5 — Highest temperature (latest snapshot)</h2>
          <div className="kpi">{fmt(computed?.hottestAll?.temperature ?? null)}°C</div>
          <div className="kpiSub">
            Station: <strong>{computed?.hottestAllStation?.stationname ?? "—"}</strong>
            <br />
            Timestamp: <strong>{computed?.latestTs ?? "—"}</strong>
          </div>
        </div>

        <div className="card span-4">
          <h2>Q6 — Average temperature (all measurements)</h2>
          <div className="kpi">{fmt(computed?.avgTempAll ?? null)}°C</div>
          <div className="kpiSub">
            Based on <strong>{meta?.measurements_count ?? state.measurements.length}</strong> measurement rows.
          </div>
        </div>

        <div className="card span-4">
          <h2>Q7 — Biggest feel vs actual difference</h2>
          <div className="kpi">
            {computed?.biggestDiffAll &&
            typeof computed.biggestDiffAll.temperature === "number" &&
            typeof computed.biggestDiffAll.feeltemperature === "number"
              ? `${fmt(Math.abs(computed.biggestDiffAll.feeltemperature - computed.biggestDiffAll.temperature))}°C`
              : "—"}
          </div>
          <div className="kpiSub">
            Station: <strong>{computed?.diffAllStation?.stationname ?? "—"}</strong>
            <br />
            At: <strong>{computed?.biggestDiffAll?.timestamp ?? "—"}</strong>
          </div>
        </div>

        <div className="card span-12">
          <h2>Q8 — Station located in the North Sea</h2>
          <div className="kpi">{computed?.northSeaStation?.stationname ?? "—"}</div>
          <div className="kpiSub">
            Regio: <strong>{computed?.northSeaStation?.regio ?? "—"}</strong> · Coordinates:{" "}
            <strong>
              {computed?.northSeaStation?.lat ?? "—"}, {computed?.northSeaStation?.lon ?? "—"}
            </strong>
          </div>
        </div>
      </div>

      <div className="sectionHeader">
        <div className="sectionTitle">Part 3 — Data Visualization (9B)</div>
        <div className="sectionNote">Use filters below to explore trends and comparisons.</div>
      </div>
      <div className="grid">
        <div className="card span-12">
          <div className="sectionHeader" style={{ marginTop: 0 }}>
            <div className="sectionTitle">Region dashboard</div>
            <div className="pill">
              Region: <strong>{computed?.selectedEntry?.region ?? "—"}</strong> · Station:{" "}
              <strong>{computed?.selectedEntry?.station.stationname ?? "—"}</strong>
            </div>
          </div>

          <div className="controls">
            <div className="control controlWide">
              <label className="label">Select a region</label>
              <div className="row" style={{ marginTop: 0 }}>
                <button
                  className="btn"
                  onClick={() => {
                    const entries = computed?.regionEntries ?? [];
                    const idx = entries.findIndex((e) => e.region === selectedRegion);
                    if (!entries.length) return;
                    const prev = entries[(idx - 1 + entries.length) % entries.length];
                    setSelectedRegion(prev.region);
                  }}
                >
                  Previous
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const entries = computed?.regionEntries ?? [];
                    const idx = entries.findIndex((e) => e.region === selectedRegion);
                    if (!entries.length) return;
                    const next = entries[(idx + 1) % entries.length];
                    setSelectedRegion(next.region);
                  }}
                >
                  Next
                </button>
              </div>
              <div style={{ marginTop: 10 }}>
                <select value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)}>
                  {(computed?.regionEntries ?? []).map((e) => (
                    <option key={e.region} value={e.region}>
                      {e.region}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="control controlWide">
              <label className="label">Status</label>
              <div className="row" style={{ marginTop: 0 }}>
                <span className="chip">
                  Latest timestamp: <strong>{computed?.latestTs ?? "—"}</strong>
                </span>
                <span className="chip">
                  Rows in scope: <strong>{computed?.measurementsInScopeCount ?? 0}</strong>
                </span>
              </div>
              <div className="kpiSub" style={{ marginTop: 8 }}>
                “Most recent measurements” is always the latest snapshot. Time range only affects the trend charts.
              </div>
            </div>
          </div>

          <div className="divider" />

          <p className="subTitle">Most recent measurements</p>
          <div className="kpiSub" style={{ marginTop: 6 }}>
            Timestamp: <strong>{computed?.latestTs ?? "—"}</strong>
          </div>

          <div className="gridInner">
            <div className="miniCard span-4">
              <h2>Temperature</h2>
              <div className="kpi">{fmt(computed?.latestStationMeasurement?.temperature ?? null)}°C</div>
            </div>
            <div className="miniCard span-4">
              <h2>Feel temperature</h2>
              <div className="kpi">{fmt(computed?.latestStationMeasurement?.feeltemperature ?? null)}°C</div>
            </div>
            <div className="miniCard span-4">
              <h2>Humidity</h2>
              <div className="kpi">{fmt(computed?.latestStationMeasurement?.humidity ?? null, 0)}%</div>
            </div>

            <div className="miniCard span-4">
              <h2>Precipitation</h2>
              <div className="kpi">{fmt(computed?.latestStationMeasurement?.precipitation ?? null)} mm</div>
            </div>
            <div className="miniCard span-4">
              <h2>Wind gusts</h2>
              <div className="kpi">{fmt(computed?.latestStationMeasurement?.windgusts ?? null)} m/s</div>
            </div>
            <div className="miniCard span-4">
              <h2>Wind (Bft)</h2>
              <div className="kpi">{computed?.latestStationMeasurement?.windspeedBft ?? "—"}</div>
            </div>

            <div className="miniCard span-4">
              <h2>Ground temperature</h2>
              <div className="kpi">{fmt(computed?.latestStationMeasurement?.groundtemperature ?? null)}°C</div>
            </div>
            <div className="miniCard span-4">
              <h2>Sun power</h2>
              <div className="kpi">{fmt(computed?.latestStationMeasurement?.sunpower ?? null, 0)}</div>
            </div>
            <div className="miniCard span-4">
              <h2>Timestamp</h2>
              <div className="kpi" style={{ fontSize: 16 }}>{computed?.latestStationMeasurement?.timestamp ?? "—"}</div>
              <div className="kpiSub">Latest row for this station.</div>
            </div>
          </div>

          <div className="divider" />

          <p className="subTitle">Trend charts</p>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="chip">
              Time range:
              <span style={{ marginLeft: 6 }} className="btnGroup">
                <button className={`btn ${timeRange === "6h" ? "btnActive" : ""}`} onClick={() => setTimeRange("6h")}>
                  6h
                </button>
                <button className={`btn ${timeRange === "24h" ? "btnActive" : ""}`} onClick={() => setTimeRange("24h")}>
                  24h
                </button>
                <button className={`btn ${timeRange === "7d" ? "btnActive" : ""}`} onClick={() => setTimeRange("7d")}>
                  7d
                </button>
                <button className={`btn ${timeRange === "all" ? "btnActive" : ""}`} onClick={() => setTimeRange("all")}>
                  All
                </button>
              </span>
            </span>
          </div>

          <div className="gridInner">
            {METRICS.map((m) => {
              const data = computed?.wideSeriesByMetric[m.key] ?? [];
              const stationKey = computed?.selectedStationId ? `s${computed.selectedStationId}` : "avg";
              return (
                <div key={m.key} className="miniCard span-6">
                  <h2>
                    {m.title} {m.unit ? `(${m.unit})` : ""}
                  </h2>
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.10)" vertical={false} />
                        <XAxis
                          dataKey="timestamp"
                          tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }}
                          minTickGap={30}
                        />
                        <YAxis tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }} width={32} />
                        <Tooltip
                          contentStyle={{
                            background: "rgba(15, 23, 42, 0.92)",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 10,
                            color: "rgba(255,255,255,0.92)",
                          }}
                        />
                        <Line type="monotone" dataKey={stationKey} stroke={m.color} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


