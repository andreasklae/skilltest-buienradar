export type Station = {
  stationid: number;
  stationname: string;
  lat: number | null;
  lon: number | null;
  regio: string | null;
};

export type Measurement = {
  measurementid: number;
  timestamp: string; // ISO-8601
  temperature: number | null;
  groundtemperature: number | null;
  feeltemperature: number | null;
  windgusts: number | null;
  windspeedBft: number | null;
  humidity: number | null;
  precipitation: number | null;
  sunpower: number | null;
  stationid: number;
};

export type Meta = {
  generated_at_utc: string;
  db_path: string;
  stations_count: number;
  measurements_count: number;
};


