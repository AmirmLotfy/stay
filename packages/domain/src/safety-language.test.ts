import { describe, expect, it } from 'vitest';
import { hasExplicitEmergencyLanguage } from './safety-language.js';

describe('explicit emergency language guard', () => {
  it.each([
    'This is an emergency, get help',
    'Call an ambulance',
    'Dial 911',
    'Call the fire department',
    'This feels life-threatening',
  ])('recognizes explicit emergency wording: %s', (utterance) => {
    expect(hasExplicitEmergencyLanguage(utterance)).toBe(true);
  });

  it.each([
    'Can Tom help with the recycling?',
    'I need help with a leaking tap',
    'What is happening today?',
  ])('does not turn ordinary help into emergency language: %s', (utterance) => {
    expect(hasExplicitEmergencyLanguage(utterance)).toBe(false);
  });
});
