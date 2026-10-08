import { dayLabelToUtcAnchor } from '../../common/calendar';
import { HabitConfiguration } from './habit-configuration';

/** ISO Monday–Sunday labels; UTC anchors are labels, never local instants. */
export function isoWeekDates(day: string): string[] {
  const monday = dayLabelToUtcAnchor(day);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() || 7) - 1));
  return Array.from({ length: 7 }, (_, offset) => {
    const anchor = new Date(monday);
    anchor.setUTCDate(anchor.getUTCDate() + offset);
    const label = anchor.toISOString().slice(0, 10);
    // Reject a partial week outside supported years 0001..9999.
    dayLabelToUtcAnchor(label);
    return label;
  });
}

export function scheduledOnDate(
  day: string,
  configuration: HabitConfiguration,
): boolean {
  const { schedule } = configuration;
  return (
    schedule.kind !== 'weekdays' ||
    schedule.days.includes(dayLabelToUtcAnchor(day).getUTCDay() || 7)
  );
}
