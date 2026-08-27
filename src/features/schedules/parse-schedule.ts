/**
 * Schedule:Compact interpreter.
 *
 * The compact format is a small rule language:
 *
 *   Through: 12/31,      -- the date this block applies until
 *   For: Weekdays,       -- which day types it covers
 *   Until: 08:00, 0.0,   -- value held until this clock time
 *   Until: 18:00, 1.0,
 *
 * Expanding it into an hourly profile per day type is what makes the schedule
 * chartable and lets the simulation view show what it will actually apply.
 */

import { type IdfObject, objectName, textField } from '@/core/idf/types';

export type DayType =
  | 'Weekdays' | 'Weekends' | 'Saturday' | 'Sunday' | 'Holiday'
  | 'AllDays' | 'AllOtherDays' | 'SummerDesignDay' | 'WinterDesignDay' | 'CustomDay1' | 'CustomDay2';

export interface DayProfile {
  dayTypes: DayType[];
  /** 24 hourly values, index 0 covering 00:00–01:00. */
  hourly: number[];
}

export interface SchedulePeriod {
  /** `Through:` date, as written. */
  through: string;
  /** Day of year the period ends on, 1-based. */
  throughDay: number;
  days: DayProfile[];
}

export interface ParsedSchedule {
  name: string;
  typeLimits: string;
  periods: SchedulePeriod[];
  /** Flattened 8760-hour profile, using the first matching rule per day. */
  annual: Float64Array | null;
  min: number;
  max: number;
  mean: number;
  issues: string[];
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function dayOfYearFrom(monthDay: string): number {
  const match = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(monthDay);
  if (!match) return 365;
  const month = Math.min(12, Math.max(1, Number(match[1])));
  const day = Math.min(31, Math.max(1, Number(match[2])));
  let total = 0;
  for (let i = 0; i < month - 1; i++) total += DAYS_IN_MONTH[i];
  return total + day;
}

/** `Until: 14:30` -> 14.5 hours. */
function parseUntil(text: string): number {
  const match = /(\d{1,2})\s*:\s*(\d{1,2})/.exec(text);
  if (!match) return 24;
  return Number(match[1]) + Number(match[2]) / 60;
}

function normaliseDayType(text: string): DayType[] {
  const value = text.replace(/^For\s*:?\s*/i, '').trim();
  const tokens = value.split(/\s+/).filter(Boolean);
  const result: DayType[] = [];

  for (const token of tokens) {
    const lowered = token.toLowerCase();
    if (lowered.startsWith('weekday')) result.push('Weekdays');
    else if (lowered.startsWith('weekend')) result.push('Weekends');
    else if (lowered.startsWith('saturday')) result.push('Saturday');
    else if (lowered.startsWith('sunday')) result.push('Sunday');
    else if (lowered.startsWith('holiday')) result.push('Holiday');
    else if (lowered.startsWith('alldays')) result.push('AllDays');
    else if (lowered.startsWith('allotherdays')) result.push('AllOtherDays');
    else if (lowered.startsWith('summerdesignday')) result.push('SummerDesignDay');
    else if (lowered.startsWith('winterdesignday')) result.push('WinterDesignDay');
  }
  return result.length > 0 ? result : ['AllDays'];
}

export function parseCompactSchedule(object: IdfObject): ParsedSchedule {
  const name = objectName(object);
  const typeLimits = textField(object, 1, '');
  const issues: string[] = [];
  const periods: SchedulePeriod[] = [];

  let currentPeriod: SchedulePeriod | null = null;
  let currentDay: DayProfile | null = null;
  let lastUntil = 0;

  // Fields from index 2 onward are the rule tokens, in order.
  for (let index = 2; index < object.fields.length; index++) {
    const raw = (object.fields[index] ?? '').trim();
    if (raw === '') continue;

    if (/^Through\s*:/i.test(raw)) {
      const through = raw.replace(/^Through\s*:?\s*/i, '').trim();
      currentPeriod = { through, throughDay: dayOfYearFrom(through), days: [] };
      periods.push(currentPeriod);
      currentDay = null;
      continue;
    }

    if (/^For\s*:/i.test(raw)) {
      if (!currentPeriod) {
        // Tolerate a missing Through: by assuming the whole year.
        currentPeriod = { through: '12/31', throughDay: 365, days: [] };
        periods.push(currentPeriod);
      }
      currentDay = { dayTypes: normaliseDayType(raw), hourly: new Array<number>(24).fill(0) };
      currentPeriod.days.push(currentDay);
      lastUntil = 0;
      continue;
    }

    if (/^Until\s*:/i.test(raw)) {
      if (!currentDay) {
        issues.push('An "Until:" appears before any "For:" block.');
        continue;
      }
      const until = parseUntil(raw);
      // The value lives in the next field.
      const value = Number((object.fields[index + 1] ?? '0').trim());
      index += 1;

      if (!Number.isFinite(value)) {
        issues.push(`Non-numeric value after "${raw}".`);
        continue;
      }

      // Fill every hour between the previous boundary and this one.
      const from = Math.floor(lastUntil);
      const to = Math.min(24, Math.ceil(until));
      for (let hour = from; hour < to; hour++) currentDay.hourly[hour] = value;
      lastUntil = until;
      continue;
    }

    if (/^Interpolate\s*:/i.test(raw)) continue; // affects sub-hourly only
  }

  if (periods.length === 0) issues.push('No "Through:" periods found.');

  const annual = expandToAnnual(periods);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;

  if (annual) {
    for (const value of annual) {
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
    }
  }

  return {
    name,
    typeLimits,
    periods,
    annual,
    min: annual ? min : 0,
    max: annual ? max : 0,
    mean: annual ? sum / annual.length : 0,
    issues,
  };
}

/** Picks the profile that applies to a weekday index (0 = Sunday). */
function profileForDay(period: SchedulePeriod, dayOfWeek: number): DayProfile | null {
  const isSaturday = dayOfWeek === 6;
  const isSunday = dayOfWeek === 0;
  const isWeekend = isSaturday || isSunday;

  const matches = (profile: DayProfile): boolean => {
    for (const type of profile.dayTypes) {
      if (type === 'AllDays') return true;
      if (type === 'Weekdays' && !isWeekend) return true;
      if (type === 'Weekends' && isWeekend) return true;
      if (type === 'Saturday' && isSaturday) return true;
      if (type === 'Sunday' && isSunday) return true;
    }
    return false;
  };

  // Specific rules win over the AllOtherDays catch-all.
  const specific = period.days.find((profile) =>
    !profile.dayTypes.includes('AllOtherDays') && matches(profile));
  if (specific) return specific;

  return period.days.find((profile) => profile.dayTypes.includes('AllOtherDays'))
    ?? period.days.find((profile) => profile.dayTypes.includes('AllDays'))
    ?? null;
}

function expandToAnnual(periods: SchedulePeriod[]): Float64Array | null {
  if (periods.length === 0) return null;

  const annual = new Float64Array(8760);
  for (let day = 0; day < 365; day++) {
    const dayOfYear = day + 1;
    const period = periods.find((entry) => dayOfYear <= entry.throughDay) ?? periods[periods.length - 1];
    // Jan 1 is treated as a Sunday, matching the templates' RunPeriod.
    const dayOfWeek = dayOfYear % 7;
    const profile = profileForDay(period, dayOfWeek);

    for (let hour = 0; hour < 24; hour++) {
      annual[day * 24 + hour] = profile ? profile.hourly[hour] : 0;
    }
  }
  return annual;
}

/** Representative day profiles for charting, deduplicated by day type. */
export function representativeDays(schedule: ParsedSchedule): { label: string; hourly: number[] }[] {
  const seen = new Map<string, number[]>();
  for (const period of schedule.periods) {
    for (const profile of period.days) {
      const label = profile.dayTypes.join(', ');
      if (!seen.has(label)) seen.set(label, profile.hourly);
    }
  }
  return [...seen.entries()].map(([label, hourly]) => ({ label, hourly }));
}
