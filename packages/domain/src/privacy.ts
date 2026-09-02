export type ShareReason =
  'routine-status' | 'resident-requested-help' | 'active-authorized-incident' | 'security-audit';

export interface PrivacyPolicyState {
  routineSharing: boolean;
  temporaryPrivateUntil?: string;
}

export function sharingAllowed(
  privacy: PrivacyPolicyState,
  reason: ShareReason,
  now = new Date(),
): boolean {
  if (
    reason === 'resident-requested-help' ||
    reason === 'active-authorized-incident' ||
    reason === 'security-audit'
  ) {
    return true;
  }
  const privateTimeActive = privacy.temporaryPrivateUntil
    ? new Date(privacy.temporaryPrivateUntil).getTime() > now.getTime()
    : false;
  return privacy.routineSharing && !privateTimeActive;
}

export function formatResidentTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    hour12: false,
  }).format(new Date(instant));
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localParts(instant: Date, timeZone: string): LocalDateTimeParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function partsKey(parts: LocalDateTimeParts): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatResidentDateTimeInput(instant: Date, timeZone: string): string {
  return partsKey(localParts(instant, timeZone));
}

export function residentDateTimeToUtc(localValue: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue);
  if (!match) throw new RangeError('Enter a valid resident-local date and time.');
  const requested: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const wallClockUtc = Date.UTC(
    requested.year,
    requested.month - 1,
    requested.day,
    requested.hour,
    requested.minute,
  );
  if (partsKey(localParts(new Date(wallClockUtc), 'UTC')) !== localValue) {
    throw new RangeError('Enter a valid resident-local date and time.');
  }

  const offsets = new Set<number>();
  for (const deltaHours of [-36, -12, 0, 12, 36]) {
    const probe = wallClockUtc + deltaHours * 60 * 60 * 1000;
    const probeParts = localParts(new Date(probe), timeZone);
    const representedAsUtc = Date.UTC(
      probeParts.year,
      probeParts.month - 1,
      probeParts.day,
      probeParts.hour,
      probeParts.minute,
    );
    offsets.add(representedAsUtc - Math.floor(probe / 60_000) * 60_000);
  }
  const candidates = [...offsets]
    .map((offset) => wallClockUtc - offset)
    .filter((candidate) => partsKey(localParts(new Date(candidate), timeZone)) === localValue);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) {
    throw new RangeError('That local time does not exist because the clock changes then.');
  }
  if (unique.length > 1) {
    throw new RangeError('That local time occurs twice because the clock changes then.');
  }
  return new Date(unique[0]!).toISOString();
}

export class NotificationLedger {
  readonly #delivered = new Set<string>();

  public deliverOnce(key: string, operation: () => void): boolean {
    if (this.#delivered.has(key)) return false;
    operation();
    this.#delivered.add(key);
    return true;
  }
}
