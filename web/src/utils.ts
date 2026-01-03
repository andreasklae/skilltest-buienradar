import type { Measurement, Station } from "./types";

export function mean(values: Array<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function byStationId(stations: Station[]): Map<number, Station> {
  return new Map(stations.map((s) => [s.stationid, s]));
}

export function maxBy<T>(items: T[], score: (t: T) => number): T | null {
  if (!items.length) return null;
  let best = items[0];
  let bestScore = score(best);
  for (const it of items.slice(1)) {
    const sc = score(it);
    if (sc > bestScore) {
      best = it;
      bestScore = sc;
    }
  }
  return best;
}

export function latestTimestamp(measurements: Measurement[]): string | null {
  if (!measurements.length) return null;
  // ISO timestamps sort lexicographically
  return measurements.reduce((mx, m) => (m.timestamp > mx ? m.timestamp : mx), measurements[0].timestamp);
}


