export class StayDomainError extends Error {
  public constructor(
    public readonly code:
      | 'BAD_REQUEST'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'STALE_VERSION'
      | 'IDEMPOTENCY_REQUIRED'
      | 'CONFIRMATION_REQUIRED'
      | 'PROVIDER_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'StayDomainError';
  }
}
