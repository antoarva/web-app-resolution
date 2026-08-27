/**
 * Built-in climate library.
 *
 * Each entry carries the statistics the engine needs to reconstruct a year:
 * annual mean dry-bulb, the seasonal and diurnal swings, mean sky clearness and
 * an undisturbed ground temperature. Values are representative long-run
 * normals, which is the right resolution for early-design comparisons — swap in
 * a measured weather file when a project needs certified results.
 */

import type { ClimateInput } from '@/wasm/protocol';

export interface ClimateLocation {
  id: string;
  city: string;
  region: string;
  country: string;
  /** ASHRAE 169 climate zone. */
  zone: string;
  description: string;
  latitude: number;
  longitude: number;
  timeZone: number;
  elevation: number;
  climate: ClimateInput;
}

/** Northern-hemisphere peak; the engine mirrors it below the equator. */
const NORTHERN_PEAK = 205;

export const CLIMATE_LOCATIONS: ClimateLocation[] = [
  {
    id: 'chicago',
    city: 'Chicago', region: 'Illinois', country: 'United States', zone: '5A',
    description: 'Cold, humid. Heating dominated with hot, muggy summer peaks.',
    latitude: 41.98, longitude: -87.92, timeZone: -6, elevation: 201,
    climate: { meanTemp: 9.9, annualAmplitude: 13.5, dailyAmplitude: 5.5, peakDay: NORTHERN_PEAK,
      clearness: 0.72, humidity: 0.68, groundTemp: 11.0, windSpeed: 4.2 },
  },
  {
    id: 'denver',
    city: 'Denver', region: 'Colorado', country: 'United States', zone: '5B',
    description: 'Cold, dry, high altitude. Large daily swings and intense sun.',
    latitude: 39.83, longitude: -104.66, timeZone: -7, elevation: 1650,
    climate: { meanTemp: 10.1, annualAmplitude: 12.6, dailyAmplitude: 8.5, peakDay: NORTHERN_PEAK,
      clearness: 0.85, humidity: 0.45, groundTemp: 11.5, windSpeed: 4.0 },
  },
  {
    id: 'phoenix',
    city: 'Phoenix', region: 'Arizona', country: 'United States', zone: '2B',
    description: 'Hot, dry. Cooling dominated with very high summer peaks.',
    latitude: 33.45, longitude: -111.98, timeZone: -7, elevation: 337,
    climate: { meanTemp: 23.9, annualAmplitude: 11.5, dailyAmplitude: 8.0, peakDay: NORTHERN_PEAK,
      clearness: 0.92, humidity: 0.32, groundTemp: 24.0, windSpeed: 3.3 },
  },
  {
    id: 'miami',
    city: 'Miami', region: 'Florida', country: 'United States', zone: '1A',
    description: 'Hot, humid. Cooling and dehumidification all year.',
    latitude: 25.82, longitude: -80.30, timeZone: -5, elevation: 11,
    climate: { meanTemp: 24.7, annualAmplitude: 5.0, dailyAmplitude: 4.0, peakDay: NORTHERN_PEAK,
      clearness: 0.68, humidity: 0.78, groundTemp: 24.5, windSpeed: 4.1 },
  },
  {
    id: 'san-francisco',
    city: 'San Francisco', region: 'California', country: 'United States', zone: '3C',
    description: 'Marine. Mild all year; often no mechanical cooling needed.',
    latitude: 37.62, longitude: -122.40, timeZone: -8, elevation: 2,
    climate: { meanTemp: 13.8, annualAmplitude: 3.6, dailyAmplitude: 4.5, peakDay: 240,
      clearness: 0.78, humidity: 0.72, groundTemp: 14.0, windSpeed: 4.6 },
  },
  {
    id: 'new-york',
    city: 'New York', region: 'New York', country: 'United States', zone: '4A',
    description: 'Mixed, humid. Meaningful heating and cooling seasons.',
    latitude: 40.78, longitude: -73.97, timeZone: -5, elevation: 40,
    climate: { meanTemp: 12.5, annualAmplitude: 12.0, dailyAmplitude: 5.0, peakDay: NORTHERN_PEAK,
      clearness: 0.70, humidity: 0.66, groundTemp: 13.0, windSpeed: 4.4 },
  },
  {
    id: 'minneapolis',
    city: 'Minneapolis', region: 'Minnesota', country: 'United States', zone: '6A',
    description: 'Very cold. Long heating season with severe design conditions.',
    latitude: 44.88, longitude: -93.22, timeZone: -6, elevation: 255,
    climate: { meanTemp: 7.8, annualAmplitude: 16.0, dailyAmplitude: 6.0, peakDay: NORTHERN_PEAK,
      clearness: 0.73, humidity: 0.68, groundTemp: 9.0, windSpeed: 4.5 },
  },
  {
    id: 'london',
    city: 'London', region: 'England', country: 'United Kingdom', zone: '4A',
    description: 'Temperate maritime. Overcast, mild, heating dominated.',
    latitude: 51.15, longitude: -0.18, timeZone: 0, elevation: 62,
    climate: { meanTemp: 11.0, annualAmplitude: 6.8, dailyAmplitude: 4.0, peakDay: 200,
      clearness: 0.52, humidity: 0.78, groundTemp: 11.5, windSpeed: 4.3 },
  },
  {
    id: 'berlin',
    city: 'Berlin', region: 'Brandenburg', country: 'Germany', zone: '5A',
    description: 'Continental. Cold winters, warm summers, moderate sun.',
    latitude: 52.47, longitude: 13.40, timeZone: 1, elevation: 37,
    climate: { meanTemp: 9.9, annualAmplitude: 9.5, dailyAmplitude: 4.5, peakDay: 200,
      clearness: 0.58, humidity: 0.75, groundTemp: 10.5, windSpeed: 3.8 },
  },
  {
    id: 'madrid',
    city: 'Madrid', region: 'Madrid', country: 'Spain', zone: '3B',
    description: 'Hot-summer Mediterranean. Sunny, dry, big daily swings.',
    latitude: 40.45, longitude: -3.55, timeZone: 1, elevation: 582,
    climate: { meanTemp: 14.5, annualAmplitude: 9.5, dailyAmplitude: 7.5, peakDay: 205,
      clearness: 0.84, humidity: 0.55, groundTemp: 15.5, windSpeed: 3.5 },
  },
  {
    id: 'stockholm',
    city: 'Stockholm', region: 'Stockholm', country: 'Sweden', zone: '6A',
    description: 'Subarctic. Very long heating season, low winter sun.',
    latitude: 59.65, longitude: 17.95, timeZone: 1, elevation: 61,
    climate: { meanTemp: 6.6, annualAmplitude: 10.5, dailyAmplitude: 4.0, peakDay: 200,
      clearness: 0.55, humidity: 0.78, groundTemp: 7.5, windSpeed: 3.6 },
  },
  {
    id: 'singapore',
    city: 'Singapore', region: 'Singapore', country: 'Singapore', zone: '0A',
    description: 'Equatorial. Hot and humid with almost no seasonal variation.',
    latitude: 1.37, longitude: 103.98, timeZone: 8, elevation: 16,
    climate: { meanTemp: 27.0, annualAmplitude: 0.8, dailyAmplitude: 3.5, peakDay: 120,
      clearness: 0.55, humidity: 0.84, groundTemp: 27.0, windSpeed: 2.5 },
  },
  {
    id: 'tokyo',
    city: 'Tokyo', region: 'Tokyo', country: 'Japan', zone: '3A',
    description: 'Humid subtropical. Hot, wet summers and mild winters.',
    latitude: 35.55, longitude: 139.78, timeZone: 9, elevation: 8,
    climate: { meanTemp: 16.3, annualAmplitude: 10.5, dailyAmplitude: 4.5, peakDay: 215,
      clearness: 0.62, humidity: 0.72, groundTemp: 17.0, windSpeed: 4.0 },
  },
  {
    id: 'sydney',
    city: 'Sydney', region: 'New South Wales', country: 'Australia', zone: '3A',
    description: 'Temperate. Southern hemisphere, so seasons are inverted.',
    latitude: -33.95, longitude: 151.18, timeZone: 10, elevation: 3,
    climate: { meanTemp: 18.3, annualAmplitude: 5.2, dailyAmplitude: 5.0, peakDay: NORTHERN_PEAK,
      clearness: 0.74, humidity: 0.68, groundTemp: 18.5, windSpeed: 4.4 },
  },
  {
    id: 'cairo',
    city: 'Cairo', region: 'Cairo', country: 'Egypt', zone: '2B',
    description: 'Hot desert. Very sunny with a long cooling season.',
    latitude: 30.13, longitude: 31.40, timeZone: 2, elevation: 74,
    climate: { meanTemp: 22.0, annualAmplitude: 8.5, dailyAmplitude: 7.0, peakDay: NORTHERN_PEAK,
      clearness: 0.88, humidity: 0.48, groundTemp: 23.0, windSpeed: 3.4 },
  },
  {
    id: 'sao-paulo',
    city: 'São Paulo', region: 'São Paulo', country: 'Brazil', zone: '3A',
    description: 'Subtropical highland. Mild year-round, inverted seasons.',
    latitude: -23.62, longitude: -46.65, timeZone: -3, elevation: 803,
    climate: { meanTemp: 19.3, annualAmplitude: 3.8, dailyAmplitude: 6.0, peakDay: NORTHERN_PEAK,
      clearness: 0.62, humidity: 0.75, groundTemp: 19.5, windSpeed: 3.0 },
  },
];

export const DEFAULT_LOCATION_ID = 'chicago';

export function findLocation(id: string): ClimateLocation | undefined {
  return CLIMATE_LOCATIONS.find((entry) => entry.id === id);
}

export function defaultLocation(): ClimateLocation {
  return findLocation(DEFAULT_LOCATION_ID) ?? CLIMATE_LOCATIONS[0];
}

/**
 * Nearest library entry by great-circle distance, used when a file declares a
 * Site:Location the library does not carry.
 */
export function nearestLocation(latitude: number, longitude: number): ClimateLocation {
  let best = CLIMATE_LOCATIONS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of CLIMATE_LOCATIONS) {
    const latitudeDelta = ((entry.latitude - latitude) * Math.PI) / 180;
    const longitudeDelta = ((entry.longitude - longitude) * Math.PI) / 180;
    const meanLatitude = ((entry.latitude + latitude) / 2 * Math.PI) / 180;
    // Equirectangular approximation is plenty for picking a nearest neighbour.
    const x = longitudeDelta * Math.cos(meanLatitude);
    const distance = x * x + latitudeDelta * latitudeDelta;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best;
}

export function countries(): string[] {
  return Array.from(new Set(CLIMATE_LOCATIONS.map((entry) => entry.country))).sort();
}
