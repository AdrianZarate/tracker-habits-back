import { dayLabelToUtcAnchor } from '../../common/calendar';

export type HabitSchedule =
  | { kind: 'daily' }
  | { kind: 'weekdays'; days: number[] }
  | { kind: 'weekly'; timesPerWeek: number };
export type HabitGoal =
  | { kind: 'checkbox' }
  | { kind: 'quantity'; target: number; unit: string };
export interface HabitConfiguration {
  schedule: HabitSchedule;
  goal: HabitGoal;
}
export interface ConfigurationRevision {
  revisionId: string;
  effectiveFrom: string;
  configuration: HabitConfiguration;
}
export type ResolvedConfiguration = Pick<
  ConfigurationRevision,
  'configuration'
> &
  Partial<Pick<ConfigurationRevision, 'revisionId' | 'effectiveFrom'>>;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RangeError('Expected a configuration object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new RangeError('Unexpected or missing configuration fields');
  }
}

const isoDay = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 7;

/** Strict full-bundle boundary; returns a normalized copy, never mutates input. */
export function parseConfiguration(value: unknown): HabitConfiguration {
  const bundle = record(value);
  exactKeys(bundle, ['schedule', 'goal']);
  const schedule = record(bundle.schedule);
  let parsedSchedule: HabitSchedule;
  switch (schedule.kind) {
    case 'daily':
      exactKeys(schedule, ['kind']);
      parsedSchedule = { kind: 'daily' };
      break;
    case 'weekdays': {
      exactKeys(schedule, ['kind', 'days']);
      const days = Array.isArray(schedule.days)
        ? Array.from(schedule.days as unknown[])
        : [];
      if (
        !days.length ||
        !days.every(isoDay) ||
        new Set(days).size !== days.length
      ) {
        throw new RangeError('Expected distinct ISO weekdays 1..7');
      }
      parsedSchedule = { kind: 'weekdays', days: [...days] };
      break;
    }
    case 'weekly':
      exactKeys(schedule, ['kind', 'timesPerWeek']);
      if (!isoDay(schedule.timesPerWeek)) {
        throw new RangeError('Expected weekly quota 1..7');
      }
      parsedSchedule = { kind: 'weekly', timesPerWeek: schedule.timesPerWeek };
      break;
    default:
      throw new RangeError('Unknown schedule kind');
  }
  const goal = record(bundle.goal);
  let parsedGoal: HabitGoal;
  switch (goal.kind) {
    case 'checkbox':
      exactKeys(goal, ['kind']);
      parsedGoal = { kind: 'checkbox' }; // Semantic per-day target is 1, not a payload field.
      break;
    case 'quantity':
      exactKeys(goal, ['kind', 'target', 'unit']);
      if (
        typeof goal.target !== 'number' ||
        !Number.isFinite(goal.target) ||
        goal.target <= 0 ||
        goal.target > 1e9 ||
        typeof goal.unit !== 'string' ||
        !goal.unit.trim() ||
        goal.unit.trim().length > 32
      ) {
        throw new RangeError(
          'Expected positive quantity <=1e9 and unit of 1..32 characters',
        );
      }
      parsedGoal = {
        kind: 'quantity',
        target: goal.target,
        unit: goal.unit.trim(),
      };
      break;
    default:
      throw new RangeError('Unknown goal kind');
  }
  return { schedule: parsedSchedule, goal: parsedGoal };
}

export function isValidConfiguration(value: unknown): boolean {
  try {
    parseConfiguration(value);
    return true;
  } catch {
    return false;
  }
}

export function isValidConfigurationDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    dayLabelToUtcAnchor(value);
    return true;
  } catch {
    return false;
  }
}

/** Calendar-label arithmetic, not instant + 24h (which crosses DST incorrectly). */
export function nextCalendarDay(day: string): string {
  if (!isValidConfigurationDate(day))
    throw new RangeError('Invalid calendar day');
  const anchor = dayLabelToUtcAnchor(day);
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  const next = anchor.toISOString().slice(0, 10);
  if (!isValidConfigurationDate(next))
    throw new RangeError('Calendar day overflow');
  return next;
}

export function legacyConfiguration(): HabitConfiguration {
  return { schedule: { kind: 'daily' }, goal: { kind: 'checkbox' } };
}

const copyRevision = (
  revision: ConfigurationRevision,
): ConfigurationRevision => ({
  revisionId: revision.revisionId,
  effectiveFrom: revision.effectiveFrom,
  configuration: parseConfiguration(revision.configuration),
});

/** Mongo array order breaks equal-date ties; IDs and wall-clock order do not. */
export function resolveConfigurationForDate(
  revisions: readonly ConfigurationRevision[] | undefined,
  day: string,
): ResolvedConfiguration {
  if (!isValidConfigurationDate(day))
    throw new RangeError('Invalid calendar day');
  let winner: ConfigurationRevision | undefined;
  for (const revision of revisions ?? []) {
    if (
      revision.effectiveFrom <= day &&
      (!winner || revision.effectiveFrom >= winner.effectiveFrom)
    ) {
      winner = revision;
    }
  }
  return winner
    ? copyRevision(winner)
    : { configuration: legacyConfiguration() };
}

/** Keep legacy response shapes; versioned reads expose no raw history array. */
export function configurationView(
  revisions: readonly ConfigurationRevision[] | undefined,
  day: string,
): {
  configuration?: HabitConfiguration;
  pendingConfiguration?: ConfigurationRevision;
} {
  if (!revisions?.length) return {};
  const current = resolveConfigurationForDate(revisions, day);
  let pending: ConfigurationRevision | undefined;
  for (const revision of revisions) {
    if (
      revision.effectiveFrom > day &&
      (!pending || revision.effectiveFrom <= pending.effectiveFrom)
    ) {
      pending = revision;
    }
  }
  return {
    configuration: current.configuration,
    ...(pending ? { pendingConfiguration: copyRevision(pending) } : {}),
  };
}
