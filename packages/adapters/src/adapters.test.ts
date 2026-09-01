import { describe, expect, it } from 'vitest';
import { SimulatedHomeContextProvider } from './index.js';

describe('simulated provider disclosure', () => {
  it('always labels the provider and observation time', async () => {
    const provider = new SimulatedHomeContextProvider(() => new Date('2026-09-02T08:42:00Z'));
    const result = await provider.getWeather();
    expect(result.provenance).toMatchObject({
      mode: 'simulated',
      provider: 'STAY scripted weather adapter',
      observedAt: '2026-09-02T08:42:00.000Z',
    });
  });
});
