const explicitEmergencyPatterns = [
  /\bemergenc(?:y|ies)\b/i,
  /\b(?:call|dial)\s+(?:the\s+)?(?:police|fire department|ambulance|paramedics?|emergency services|911|999|112)\b/i,
  /\b(?:ambulance|paramedics?|life[- ]threatening)\b/i,
];

export function hasExplicitEmergencyLanguage(utterance: string): boolean {
  return explicitEmergencyPatterns.some((pattern) => pattern.test(utterance));
}
