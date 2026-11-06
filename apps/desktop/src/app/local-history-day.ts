import { localHistoryDay, type HistoryWindowRequest } from "@gooddealer/client-core";
import { useEffect, useState } from "react";

export type LocalHistoryDay = Pick<HistoryWindowRequest, "todayFrom" | "todayUntil">;

const systemNow = () => new Date();

/**
 * The person's local day for History's "changes today", advanced when the day ends. Every window
 * of one read asks for this same day, so a read cannot mix two days; when the day ends the value
 * changes and the route reads again with the new one, so an open page does not keep counting
 * yesterday.
 *
 * The timer is re-armed from the clock each time it fires: a timer that fires early (or a clock
 * that moved back) recomputes the same day and waits again, and one delayed by sleep moves straight
 * to the current day.
 */
export function useLocalHistoryDay(now: () => Date = systemNow): LocalHistoryDay {
  const [day, setDay] = useState(() => localHistoryDay(now()));
  useEffect(() => {
    const wait = Math.max(0, Date.parse(day.todayUntil) - now().getTime());
    const timer = setTimeout(() => {
      const next = localHistoryDay(now());
      // An early timer keeps the bounds but needs a new object to re-arm; readers key on the bounds.
      setDay((current) => (current.todayFrom === next.todayFrom ? { ...current } : next));
    }, wait);
    return () => clearTimeout(timer);
  }, [day, now]);
  return day;
}
