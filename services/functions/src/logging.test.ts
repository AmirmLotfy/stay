import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from './logging.js';

describe('structured logging', () => {
  afterEach(() => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    vi.restoreAllMocks();
  });

  it('does not allow metadata to overwrite reserved log fields', () => {
    const write = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'stay-test-function';

    log('INFO', 'notification delivered', {
      message: 'untrusted replacement',
      level: 'ERROR',
      service: 'other-service',
      notificationType: 'incident-update',
    });

    const record = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: 'INFO',
      service: 'stay-test-function',
      message: 'notification delivered',
      notificationType: 'incident-update',
    });
    expect(record.timestamp).toEqual(expect.any(String));
  });
});
