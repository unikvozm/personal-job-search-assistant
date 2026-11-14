export interface CalendarEvent {
  uid: string;
  start: string; // ISO
  title: string;
  description?: string;
  url?: string;
  allDay?: boolean;
}

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const date = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** Minimal RFC 5545 calendar: follow-ups as all-day events, interviews as 1-hour events. */
export function toIcs(events: CalendarEvent[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//personal-job-search-assistant//EN", "CALSCALE:GREGORIAN"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}@personal-job-search-assistant`, `DTSTAMP:${stamp(new Date().toISOString())}`);
    if (e.allDay) {
      const next = new Date(new Date(e.start).getTime() + 86_400_000).toISOString();
      lines.push(`DTSTART;VALUE=DATE:${date(e.start)}`, `DTEND;VALUE=DATE:${date(next)}`);
    } else {
      lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(new Date(new Date(e.start).getTime() + 3_600_000).toISOString())}`);
    }
    lines.push(`SUMMARY:${escape(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
