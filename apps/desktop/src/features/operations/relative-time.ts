const pad = (value: number) => String(value).padStart(2, "0");

function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The brand ledger's local time: "today 14:02", "yesterday 18:22", otherwise "07-30 09:11", in
 * the viewer's time zone. `now` is injectable so renders are deterministic in tests.
 */
export function relativeTime(value: string, labels: { readonly today: string; readonly yesterday: string }, now: Date = new Date()): string {
  const date = new Date(value);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (localDay(date) === localDay(now)) return `${labels.today} ${time}`;
  if (localDay(date) === localDay(yesterday)) return `${labels.yesterday} ${time}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}
