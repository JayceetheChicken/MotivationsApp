export function formatMinutes(minutes: number, compact = false): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;

  const minuteText = remainder === 1 ? 'Minute' : 'Minuten';
  const hourText = hours === 1 ? 'Stunde' : 'Stunden';

  if (hours === 0) return compact ? `${remainder} Min.` : `${remainder} ${minuteText}`;
  if (remainder === 0) return compact ? `${hours} Std.` : `${hours} ${hourText}`;
  return compact ? `${hours} Std. ${remainder} Min.` : `${hours} ${hourText} ${remainder} ${minuteText}`;
}

export function formatClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function formatShortDate(isoDate: string): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date);
}

export function formatTime(isoDate: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoDate));
}

export function toLocalDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatRelativeDay(isoDate: string, referenceDate: Date = new Date()): string {
  const date = new Date(isoDate);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const referenceDay = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  ).getTime();
  const difference = Math.round((day - referenceDay) / 86_400_000);
  if (difference === 0) return `Heute, ${formatTime(isoDate)}`;
  if (difference === -1) return `Gestern, ${formatTime(isoDate)}`;
  return `${formatShortDate(isoDate)}, ${formatTime(isoDate)}`;
}
