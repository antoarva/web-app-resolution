/**
 * Solar position and clear-sky irradiance.
 *
 * Everything here is derived analytically from latitude, longitude and the day
 * of year, which is what lets the engine simulate any site without shipping an
 * EPW weather file — the offline requirement rules out fetching one.
 */

import { clamp } from "../geom/polygon";

const DEG_TO_RAD: f64 = 0.017453292519943295;
const RAD_TO_DEG: f64 = 57.29577951308232;
const SOLAR_CONSTANT: f64 = 1367.0;

export class SunPosition {
  /** Degrees above the horizon; negative when the sun is down. */
  altitude: f64 = 0;
  /** Degrees clockwise from north. */
  azimuth: f64 = 0;
  /** Direct normal irradiance, W/m2. */
  directNormal: f64 = 0;
  /** Diffuse horizontal irradiance, W/m2. */
  diffuseHorizontal: f64 = 0;
  /** Global horizontal irradiance, W/m2. */
  globalHorizontal: f64 = 0;
}

/** Solar declination for a day of year, Cooper's approximation. */
export function declination(dayOfYear: i32): f64 {
  return 23.45 * Math.sin(DEG_TO_RAD * 360.0 * (<f64>(284 + dayOfYear)) / 365.0);
}

/** Equation of time in minutes, Spencer's series. */
export function equationOfTime(dayOfYear: i32): f64 {
  const b = DEG_TO_RAD * 360.0 * (<f64>(dayOfYear - 1)) / 365.0;
  return 229.2 * (0.000075
    + 0.001868 * Math.cos(b)
    - 0.032077 * Math.sin(b)
    - 0.014615 * Math.cos(2.0 * b)
    - 0.040849 * Math.sin(2.0 * b));
}

/**
 * Sun position and clear-sky irradiance at a given instant.
 *
 * `clearness` scales the atmospheric transmittance to stand in for average
 * cloud cover at the site (1.0 = cloudless, ~0.45 = persistently overcast).
 */
export function sunPosition(
  latitude: f64,
  longitude: f64,
  timeZone: f64,
  dayOfYear: i32,
  hour: f64,
  clearness: f64
): SunPosition {
  const out = new SunPosition();

  const decl = declination(dayOfYear);
  const declRad = decl * DEG_TO_RAD;
  const latRad = latitude * DEG_TO_RAD;

  // Convert local clock time to true solar time.
  const standardMeridian = 15.0 * timeZone;
  const solarTime = hour + (4.0 * (longitude - standardMeridian) + equationOfTime(dayOfYear)) / 60.0;
  const hourAngle = (solarTime - 12.0) * 15.0;
  const hourAngleRad = hourAngle * DEG_TO_RAD;

  const sinAltitude = Math.sin(latRad) * Math.sin(declRad)
    + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  const altitude = Math.asin(clamp(sinAltitude, -1.0, 1.0));
  out.altitude = altitude * RAD_TO_DEG;

  const cosAltitude = Math.cos(altitude);
  if (cosAltitude > 1e-6) {
    const cosAzimuth = (Math.sin(declRad) * Math.cos(latRad)
      - Math.cos(declRad) * Math.sin(latRad) * Math.cos(hourAngleRad)) / cosAltitude;
    let azimuth = Math.acos(clamp(cosAzimuth, -1.0, 1.0)) * RAD_TO_DEG;
    // acos loses the sign, so mirror about south for afternoon hours.
    if (hourAngle > 0) azimuth = 360.0 - azimuth;
    out.azimuth = azimuth;
  }

  if (out.altitude <= 0.5) return out;

  // Air mass via Kasten-Young, then a Hottel-style clear-sky transmittance.
  const airMass = 1.0 / (sinAltitude + 0.50572 * Math.pow(out.altitude + 6.07995, -1.6364));
  const transmittance = Math.exp(-0.13 * airMass) * clamp(clearness, 0.1, 1.0);

  const extraterrestrial = SOLAR_CONSTANT
    * (1.0 + 0.033 * Math.cos(DEG_TO_RAD * 360.0 * (<f64>dayOfYear) / 365.0));

  out.directNormal = extraterrestrial * transmittance;
  // Diffuse rises as the sky gets hazier, which keeps global roughly conserved.
  out.diffuseHorizontal = extraterrestrial * sinAltitude * 0.10 * (1.0 + 2.5 * (1.0 - clamp(clearness, 0.1, 1.0)));
  out.globalHorizontal = out.directNormal * sinAltitude + out.diffuseHorizontal;
  return out;
}

/**
 * Irradiance striking a tilted surface, using an isotropic sky for diffuse
 * plus a ground-reflected term.
 */
export function incidentOnSurface(
  sun: SunPosition,
  tilt: f64,
  azimuth: f64,
  groundReflectance: f64
): f64 {
  if (sun.altitude <= 0.0) return 0.0;

  const altRad = sun.altitude * DEG_TO_RAD;
  const tiltRad = tilt * DEG_TO_RAD;
  const relativeAzimuth = (sun.azimuth - azimuth) * DEG_TO_RAD;

  // Cosine of the angle between the sun vector and the surface normal.
  const cosIncidence = Math.sin(altRad) * Math.cos(tiltRad)
    + Math.cos(altRad) * Math.sin(tiltRad) * Math.cos(relativeAzimuth);

  const beam = cosIncidence > 0.0 ? sun.directNormal * cosIncidence : 0.0;
  const skyView = (1.0 + Math.cos(tiltRad)) * 0.5;
  const groundView = (1.0 - Math.cos(tiltRad)) * 0.5;

  const diffuse = sun.diffuseHorizontal * skyView;
  const reflected = sun.globalHorizontal * groundReflectance * groundView;
  return beam + diffuse + reflected;
}
