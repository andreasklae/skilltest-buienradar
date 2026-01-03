import { useEffect, useMemo, useState } from "react";
import type { Measurement, Meta, Station } from "./types";
import { byStationId, latestTimestamp, maxBy, mean } from "./utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
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

function metricLabel(k: MetricKey): string {
  switch (k) {
    case "temperature":
      return "Temperature (°C)";
    case "feeltemperature":
      return "Feel temperature (°C)";
    case "precipitation":
      return "Precipitation (mm)";
    case "humidity":
      return "Humidity (%)";
    case "windgusts":
      return "Wind gusts (m/s)";
    case "sunpower":
      return "Sun power";
    case "windspeedBft":
      return "Wind (Bft)";
  }
}

function metricUnitSuffix(k: MetricKey): string {
  switch (k) {
    case "temperature":
    case "feeltemperature":
      return "°C";
    case "humidity":
      return "%";
    case "precipitation":
      return "mm";
    case "windspeedBft":
      return "Bft";
    case "windgusts":
      return "m/s";
    case "sunpower":
      return "";
  }
}

function toMillis(tsIso: string): number {
  // ISO-8601 (no timezone) -> treated as local by Date; good enough for relative windows.
  return new Date(tsIso).getTime();
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [region, setRegion] = useState<string>("All regions");
  const [stationId, setStationId] = useState<string>("all");
  const [metric, setMetric] = useState<MetricKey>("temperature");
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

    const regions = Array.from(
      new Set(state.stations.map((s) => (s.regio || "Unknown").trim()).filter(Boolean)),
    ).sort((a, b) => a.localeCompare(b));

    const regionFilter = region === "All regions" ? null : region;
    const filteredStations = regionFilter
      ? state.stations.filter((s) => (s.regio || "Unknown").trim() === regionFilter)
      : state.stations;

    const stationOptions = filteredStations
      .slice()
      .sort((a, b) => a.stationname.localeCompare(b.stationname));

    const stationIdsInScope = new Set(filteredStations.map((s) => s.stationid));
    const selectedStationId = stationId === "all" ? null : Number(stationId);

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
        (selectedStationId === null || m.stationid === selectedStationId),
    );

    // Q5: station with highest temperature (using latest snapshot for a “current” answer)
    const hottest = maxBy(
      latest.filter((m) => stationIdsInScope.has(m.stationid)),
      (m) => (typeof m.temperature === "number" ? m.temperature : -Infinity),
    );

    // Q6: average temperature (across all stored measurements)
    const avgTemp = mean(measurementsInScope.map((m) => m.temperature));

    // Q7: biggest difference between feel temperature and actual temperature
    // Using absolute difference to interpret “biggest difference” robustly.
    const biggestDiff = maxBy(measurementsInScope, (m) => {
      if (typeof m.temperature !== "number" || typeof m.feeltemperature !== "number") return -Infinity;
      return Math.abs(m.feeltemperature - m.temperature);
    });

    // Q8: station located in the North Sea -> regio == "Noordzee"
    const northSeaStation =
      state.stations.find((s) => (s.regio || "").toLowerCase() === "noordzee") ||
      state.stations.find((s) => (s.stationname || "").toLowerCase().includes("zeeplatform"));

    const hottestStation = hottest ? stationsById.get(hottest.stationid) : undefined;
    const diffStation = biggestDiff ? stationsById.get(biggestDiff.stationid) : undefined;

    // Chart 1: metric over time (selected station OR average across scope)
    const byTs = new Map<string, { sum: number; n: number }>();
    const stationSeriesByTs = new Map<string, number>();
    for (const m of measurementsInScope) {
      const key = m.timestamp;
      const v = m[metric];
      if (typeof v !== "number") continue;
      if (selectedStationId !== null) {
        stationSeriesByTs.set(key, v);
      } else {
        const cur = byTs.get(key) || { sum: 0, n: 0 };
        cur.sum += v;
        cur.n += 1;
        byTs.set(key, cur);
      }
    }

    const metricSeries =
      selectedStationId !== null
        ? Array.from(stationSeriesByTs.entries())
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([timestamp, val]) => ({ timestamp, value: val }))
        : Array.from(byTs.entries())
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([timestamp, v]) => ({ timestamp, value: v.sum / v.n }));

    // Chart 2: top hottest stations at latest snapshot (filtered by region)
    const latestInScope = latest.filter((m) => stationIdsInScope.has(m.stationid));
    const topHot = latestInScope
      .filter((m) => typeof m.temperature === "number")
      .slice()
      .sort((a, b) => (b.temperature! - a.temperature!))
      .slice(0, 10)
      .map((m) => ({
        station: stationsById.get(m.stationid)?.stationname ?? String(m.stationid),
        temperature: m.temperature!,
      }));

    // Chart 3: scatter temp vs feel (latest snapshot, filtered by region)
    const scatter = latestInScope
      .filter((m) => typeof m.temperature === "number" && typeof m.feeltemperature === "number")
      .map((m) => ({
        station: stationsById.get(m.stationid)?.stationname ?? String(m.stationid),
        temperature: m.temperature as number,
        feeltemperature: m.feeltemperature as number,
      }));

    // Chart 4: precipitation + sunpower over time (avg across scope)
    const envByTs = new Map<string, { pSum: number; pN: number; sSum: number; sN: number }>();
    for (const m of measurementsInScope) {
      const key = m.timestamp;
      const cur = envByTs.get(key) || { pSum: 0, pN: 0, sSum: 0, sN: 0 };
      if (typeof m.precipitation === "number") {
        cur.pSum += m.precipitation;
        cur.pN += 1;
      }
      if (typeof m.sunpower === "number") {
        cur.sSum += m.sunpower;
        cur.sN += 1;
      }
      envByTs.set(key, cur);
    }
    const envSeries = Array.from(envByTs.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([timestamp, v]) => ({
        timestamp,
        precipitationAvg: v.pN ? v.pSum / v.pN : null,
        sunpowerAvg: v.sN ? v.sSum / v.sN : null,
      }));

    const selectedStation = selectedStationId !== null ? stationsById.get(selectedStationId) : null;

    return {
      latestTs,
      hottest,
      hottestStation,
      avgTemp,
      biggestDiff,
      diffStation,
      northSeaStation,
      regions,
      stationOptions,
      measurementsInScopeCount: measurementsInScope.length,
      selectedStation,
      metricSeries,
      topHot,
      scatter,
      envSeries,
    };
  }, [state, region, stationId, metric, timeRange]);

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

      <div className="grid">
        <div className="card span-12">
          <h2>Explore the data</h2>
          <div className="controls">
            <div className="control">
              <label className="label">Region</label>
              <select value={region} onChange={(e) => {
                setRegion(e.target.value);
                setStationId("all");
              }}>
                <option>All regions</option>
                {computed?.regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="control">
              <label className="label">Station</label>
              <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
                <option value="all">All stations (average)</option>
                {computed?.stationOptions.map((s) => (
                  <option key={s.stationid} value={String(s.stationid)}>
                    {s.stationname}
                  </option>
                ))}
              </select>
            </div>

            <div className="control">
              <label className="label">Metric</label>
              <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
                <option value="temperature">Temperature</option>
                <option value="feeltemperature">Feel temperature</option>
                <option value="humidity">Humidity</option>
                <option value="precipitation">Precipitation</option>
                <option value="windgusts">Wind gusts</option>
                <option value="windspeedBft">Wind (Bft)</option>
                <option value="sunpower">Sun power</option>
              </select>
            </div>

            <div className="control">
              <label className="label">Time range</label>
              <select value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRangeKey)}>
                <option value="6h">Last 6 hours</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="all">All time</option>
              </select>
            </div>
          </div>

          <div className="row">
            <span className="chip">
              Scope:{" "}
              <strong>
                {region === "All regions" ? "All regions" : region}
                {computed?.selectedStation ? ` · ${computed.selectedStation.stationname}` : " · All stations"}
              </strong>
            </span>
            <span className="chip">
              Rows in scope: <strong>{computed?.measurementsInScopeCount ?? 0}</strong>
            </span>
            <span className="chip muted">
              Trend chart shows: <strong>{metricLabel(metric)}</strong>
            </span>
          </div>
        </div>

        <div className="card span-4">
          <h2>Q5 — Highest temperature (latest snapshot, within region)</h2>
          <div className="kpi">
            {fmt(computed?.hottest?.temperature ?? null)}°C
          </div>
          <div className="kpiSub">
            Station: <strong>{computed?.hottestStation?.stationname ?? "—"}</strong>
            <br />
            Timestamp: <strong>{computed?.latestTs ?? "—"}</strong>
          </div>
        </div>

        <div className="card span-4">
          <h2>Q6 — Average temperature (within filters)</h2>
          <div className="kpi">{fmt(computed?.avgTemp ?? null)}°C</div>
          <div className="kpiSub">
            Based on <strong>{computed?.measurementsInScopeCount ?? 0}</strong> measurement rows in scope.
          </div>
        </div>

        <div className="card span-4">
          <h2>Q7 — Biggest feel vs actual difference (within filters)</h2>
          <div className="kpi">
            {computed?.biggestDiff && typeof computed.biggestDiff.temperature === "number" && typeof computed.biggestDiff.feeltemperature === "number"
              ? `${fmt(Math.abs(computed.biggestDiff.feeltemperature - computed.biggestDiff.temperature))}°C`
              : "—"}
          </div>
          <div className="kpiSub">
            Station: <strong>{computed?.diffStation?.stationname ?? "—"}</strong>
            <br />
            At: <strong>{computed?.biggestDiff?.timestamp ?? "—"}</strong>
          </div>
        </div>

        <div className="card span-6">
          <h2>Q8 — Station located in the North Sea</h2>
          <div className="kpi">{computed?.northSeaStation?.stationname ?? "—"}</div>
          <div className="kpiSub">
            Regio: <strong>{computed?.northSeaStation?.regio ?? "—"}</strong>
            <br />
            Coordinates:{" "}
            <strong>
              {computed?.northSeaStation?.lat ?? "—"}, {computed?.northSeaStation?.lon ?? "—"}
            </strong>
          </div>
        </div>

        <div className="card span-6">
          <h2>Trend — {metricLabel(metric)} over time</h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={computed?.metricSeries ?? []} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.10)" vertical={false} />
                <XAxis dataKey="timestamp" tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }} minTickGap={30} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }} width={32} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15, 23, 42, 0.92)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 10,
                    color: "rgba(255,255,255,0.92)",
                  }}
                />
                <Line type="monotone" dataKey="value" stroke="#7c3aed" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="kpiSub" style={{ marginTop: 10 }}>
            Showing {stationId === "all" ? "average across the selected scope" : "the selected station"}.
            {" "}Units: <strong>{metricUnitSuffix(metric) || "—"}</strong>
          </div>
        </div>

        <div className="card span-6">
          <h2>Top 10 stations — temperature at latest snapshot</h2>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={computed?.topHot ?? []} margin={{ top: 10, right: 12, bottom: 30, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.10)" vertical={false} />
                <XAxis
                  dataKey="station"
                  tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={50}
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
                <Bar dataKey="temperature" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="kpiSub" style={{ marginTop: 10 }}>
            Filtered by region. Timestamp: <strong>{computed?.latestTs ?? "—"}</strong>
          </div>
        </div>

        <div className="card span-6">
          <h2>Relationship — temperature vs feel temperature (latest snapshot)</h2>
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 12, bottom: 10, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.10)" />
                <XAxis
                  type="number"
                  dataKey="temperature"
                  name="Temperature"
                  unit="°C"
                  tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="feeltemperature"
                  name="Feel temperature"
                  unit="°C"
                  tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }}
                  width={40}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{
                    background: "rgba(15, 23, 42, 0.92)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 10,
                    color: "rgba(255,255,255,0.92)",
                  }}
                  formatter={(value, name, props) => {
                    if (name === "temperature" || name === "feeltemperature") return [value, name];
                    return [value, name];
                  }}
                />
                <Legend />
                <Scatter name="Stations" data={computed?.scatter ?? []} fill="#7c3aed" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="kpiSub" style={{ marginTop: 10 }}>
            Points are stations (filtered by region). Higher vertical gap means larger “feels like” difference.
          </div>
        </div>

        <div className="card span-12">
          <h2>Environment — precipitation & sun power over time (average)</h2>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={computed?.envSeries ?? []} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.10)" vertical={false} />
                <XAxis dataKey="timestamp" tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }} minTickGap={30} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.65)", fontSize: 11 }} width={32} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15, 23, 42, 0.92)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 10,
                    color: "rgba(255,255,255,0.92)",
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="precipitationAvg" name="Precipitation (avg)" stroke="#60a5fa" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sunpowerAvg" name="Sun power (avg)" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="kpiSub" style={{ marginTop: 10 }}>
            Averages respect your region/time filters (and station filter if you pick a single station).
          </div>
        </div>

        <div className="card span-12 imgWrap">
          <h2>Database ERD (from `ERD1.png`)</h2>
          <img src={`${import.meta.env.BASE_URL}ERD1.png`} alt="Database ERD" />
        </div>
      </div>
    </div>
  );
}


