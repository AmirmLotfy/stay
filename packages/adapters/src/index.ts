import type { SourceProvenance } from '@stay/contracts';

export interface ProviderObservation<T> {
  value: T | null;
  provenance: SourceProvenance;
}

export interface HomeContextProvider {
  getWeather(): Promise<ProviderObservation<{ summary: string; temperatureF: number }>>;
  getUtilityStatus(): Promise<
    ProviderObservation<{ power: 'on' | 'outage'; water: 'normal' | 'interrupted' }>
  >;
  getDeviceStatus(): Promise<ProviderObservation<Array<{ name: string; state: string }>>>;
  getMaintenanceContacts(): Promise<
    ProviderObservation<Array<{ trade: string; displayName: string }>>
  >;
}

export class SimulatedHomeContextProvider implements HomeContextProvider {
  public constructor(private readonly clock: () => Date = () => new Date()) {}

  public async getWeather(): Promise<
    ProviderObservation<{ summary: string; temperatureF: number }>
  > {
    return this.#simulated('STAY scripted weather adapter', { summary: 'Clear', temperatureF: 72 });
  }

  public async getUtilityStatus(): Promise<
    ProviderObservation<{ power: 'on' | 'outage'; water: 'normal' | 'interrupted' }>
  > {
    return this.#simulated('STAY scripted utility adapter', { power: 'on', water: 'normal' });
  }

  public async getDeviceStatus(): Promise<
    ProviderObservation<Array<{ name: string; state: string }>>
  > {
    return this.#simulated('STAY scripted smart-home adapter', [
      { name: 'Front door', state: 'closed' },
      { name: 'Hall path light', state: 'ready' },
    ]);
  }

  public async getMaintenanceContacts(): Promise<
    ProviderObservation<Array<{ trade: string; displayName: string }>>
  > {
    return this.#simulated('STAY scripted maintenance adapter', [
      { trade: 'plumber', displayName: 'Demo plumbing contact' },
    ]);
  }

  #simulated<T>(provider: string, value: T): ProviderObservation<T> {
    return {
      value,
      provenance: {
        mode: 'simulated',
        provider,
        observedAt: this.clock().toISOString(),
        reason: 'The public demo does not connect to a live provider.',
      },
    };
  }
}

export class UnavailableHomeContextProvider implements HomeContextProvider {
  public constructor(private readonly reason: string) {}

  public getWeather() {
    return Promise.resolve(
      this.#unavailable<{ summary: string; temperatureF: number }>('Weather provider'),
    );
  }
  public getUtilityStatus() {
    return Promise.resolve(
      this.#unavailable<{ power: 'on' | 'outage'; water: 'normal' | 'interrupted' }>(
        'Utility provider',
      ),
    );
  }
  public getDeviceStatus() {
    return Promise.resolve(
      this.#unavailable<Array<{ name: string; state: string }>>('Smart-home provider'),
    );
  }
  public getMaintenanceContacts() {
    return Promise.resolve(
      this.#unavailable<Array<{ trade: string; displayName: string }>>('Maintenance provider'),
    );
  }

  #unavailable<T>(provider: string): ProviderObservation<T> {
    return {
      value: null,
      provenance: {
        mode: 'unavailable',
        provider,
        observedAt: new Date().toISOString(),
        reason: this.reason,
      },
    };
  }
}
