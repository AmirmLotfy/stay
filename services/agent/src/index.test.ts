import { describe, expect, it } from 'vitest';
import { AgentUnavailableError, bedrockFeatureStatus, interpretIntent } from './index.js';

describe('Bedrock feature gate', () => {
  it('never silently falls back when the model is not configured', async () => {
    expect(bedrockFeatureStatus({ AWS_REGION: 'us-east-1' })).toEqual({
      enabled: false,
      reason: 'BEDROCK_MODEL_ID is not set. Deterministic workflows remain available.',
    });
    await expect(
      interpretIntent(
        {
          utterance: 'What is happening?',
          currentSurface: 'home',
          visibleEntityIds: [],
          locale: 'en-US',
        },
        { AWS_REGION: 'us-east-1' },
      ),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });
});
