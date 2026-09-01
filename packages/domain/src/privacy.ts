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

export class NotificationLedger {
  readonly #delivered = new Set<string>();

  public deliverOnce(key: string, operation: () => void): boolean {
    if (this.#delivered.has(key)) return false;
    operation();
    this.#delivered.add(key);
    return true;
  }
}
