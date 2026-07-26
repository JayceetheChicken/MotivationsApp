function validTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function nowTimestamp(now: Date | number | undefined): number {
  const timestamp = now instanceof Date ? now.getTime() : now ?? Date.now();
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

export function formatSocialRelativeTime(
  value: string | null | undefined,
  now?: Date | number,
): string | null {
  const timestamp = validTimestamp(value);
  if (timestamp === null) return null;

  const elapsedMinutes = Math.max(0, Math.floor((nowTimestamp(now) - timestamp) / 60_000));
  if (elapsedMinutes < 1) return 'gerade eben';
  if (elapsedMinutes < 60) return `vor ${elapsedMinutes} Min.`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `vor ${elapsedHours} Std.`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return 'gestern';
  if (elapsedDays < 7) return `vor ${elapsedDays} Tagen`;

  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(timestamp));
}
