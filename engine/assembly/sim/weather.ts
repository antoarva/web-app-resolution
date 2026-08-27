/**
 * Synthetic annual weather.
 *
 * A real run would read an EPW file; running fully offline means the engine
 * reconstructs a plausible year from a handful of site statistics instead.
 * Dry-bulb temperature is modelled as an annual sinusoid (seasonal swing) with
 * a diurnal sinusoid on top, damped in winter when daily swings are smaller.
 */

const TWO_PI: f64 = 6.283185307179586;

export class ClimateProfile {
  /** Annual mean dry-bulb, degC. */
  meanTemp: f64 = 12.0;
  /** Half the peak-to-peak seasonal swing, degC. */
  annualAmplitude: f64 = 12.0;
  /** Half the peak-to-peak daily swing at the summer peak, degC. */
  dailyAmplitude: f64 = 6.0;
  /** Day of year at which the annual peak occurs (northern default: late July). */
  peakDay: f64 = 205.0;
  /** Mean atmospheric clearness, 0..1. */
  clearness: f64 = 0.75;
  /** Mean relative humidity, 0..1. */
  humidity: f64 = 0.55;
  /** Undisturbed ground temperature, degC. */
  groundTemp: f64 = 10.0;
  /** Mean wind speed, m/s. */
  windSpeed: f64 = 3.5;
}

/** Dry-bulb temperature at an hour of the year. */
export function outdoorTemperature(
  climate: ClimateProfile,
  dayOfYear: i32,
  hour: f64,
  southernHemisphere: bool
): f64 {
  let peak = climate.peakDay;
  if (southernHemisphere) {
    peak = peak - 182.5;
    if (peak < 0) peak += 365.0;
  }

  const seasonalPhase = TWO_PI * (<f64>dayOfYear - peak) / 365.0;
  const seasonal = climate.meanTemp + climate.annualAmplitude * Math.cos(seasonalPhase);

  // Daily swing is widest in the warm season and compressed in the cold season.
  const swingScale = 0.65 + 0.35 * Math.cos(seasonalPhase);
  // Coldest just before sunrise (~5h), warmest mid-afternoon (~15h).
  const diurnal = -climate.dailyAmplitude * swingScale * Math.cos(TWO_PI * (hour - 15.0) / 24.0);

  return seasonal + diurnal;
}

/** Sky temperature drives longwave loss from roofs on clear nights. */
export function skyTemperature(outdoorTemp: f64, clearness: f64): f64 {
  const outdoorK = outdoorTemp + 273.15;
  // Emissivity falls as the sky clears, deepening radiant loss.
  const emissivity = 0.95 - 0.26 * clearness;
  const skyK = outdoorK * Math.pow(emissivity, 0.25);
  return skyK - 273.15;
}

/** Convective film coefficient on an exterior surface, W/m2K. */
export function exteriorFilmCoefficient(windSpeed: f64): f64 {
  return 5.7 + 3.8 * windSpeed;
}
