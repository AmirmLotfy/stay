export const supportedLocales = ['en'] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const messages = {
  en: {
    emergencyBoundary:
      'STAY coordinates your preconfigured Circle. It does not contact emergency services or replace Alexa Emergency Assist.',
    providerSimulated: 'Simulated provider data',
    responderOnWay: (name: string) => `${name} is on the way.`,
  },
} as const;

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  return /^(ar|fa|he|ur)(-|$)/i.test(locale) ? 'rtl' : 'ltr';
}
