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

function fmt(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function App() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

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

    // Q5: station with highest temperature (using latest snapshot for a “current” answer)
    const hottest = maxBy(latest, (m) => (typeof m.temperature === "number" ? m.temperature : -Infinity));

    // Q6: average temperature (across all stored measurements)
    const avgTemp = mean(state.measurements.map((m) => m.temperature));

    // Q7: biggest difference between feel temperature and actual temperature
    // Using absolute difference to interpret “biggest difference” robustly.
    const biggestDiff = maxBy(state.measurements, (m) => {
      if (typeof m.temperature !== "number" || typeof m.feeltemperature !== "number") return -Infinity;
      return Math.abs(m.feeltemperature - m.temperature);
    });

    // Q8: station located in the North Sea -> regio == "Noordzee"
    const northSeaStation =
      state.stations.find((s) => (s.regio || "").toLowerCase() === "noordzee") ||
      state.stations.find((s) => (s.stationname || "").toLowerCase().includes("zeeplatform"));

    const hottestStation = hottest ? stationsById.get(hottest.stationid) : undefined;
    const diffStation = biggestDiff ? stationsById.get(biggestDiff.stationid) : undefined;

    // 9B viz: average temperature per timestamp (simple, readable)
    const avgByTs = new Map<string, { sum: number; n: number }>();
    for (const m of state.measurements) {
      if (typeof m.temperature !== "number") continue;
      const key = m.timestamp;
      const cur = avgByTs.get(key) || { sum: 0, n: 0 };
      cur.sum += m.temperature;
      cur.n += 1;
      avgByTs.set(key, cur);
    }
    const series = Array.from(avgByTs.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([timestamp, v]) => ({ timestamp, avgTemp: v.sum / v.n }));

    return {
      latestTs,
      hottest,
      hottestStation,
      avgTemp,
      biggestDiff,
      diffStation,
      northSeaStation,
      series,
    };
  }, [state]);

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
        <div className="card span-4">
          <h2>Q5 — Highest temperature (latest snapshot)</h2>
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
          <h2>Q6 — Average temperature (all measurements)</h2>
          <div className="kpi">{fmt(computed?.avgTemp ?? null)}°C</div>
          <div className="kpiSub">
            Based on <strong>{meta?.measurements_count ?? state.measurements.length}</strong> measurement rows.
          </div>
        </div>

        <div className="card span-4">
          <h2>Q7 — Biggest feel vs actual difference</h2>
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
          <h2>9B — Visualization: average temperature over time</h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={computed?.series ?? []} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
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
                <Line type="monotone" dataKey="avgTemp" stroke="#7c3aed" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="kpiSub" style={{ marginTop: 10 }}>
            This chart updates whenever the GitHub Action refreshes the dataset.
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


