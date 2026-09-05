# Accessibility and adaptive access

STAY uses Atkinson Hyperlegible Next and the Chalk/Coal/Pine/Sea Glass/Clay/Mustard/Emergency palette. Controls target at least 48 × 48 CSS pixels; layouts use logical properties; state does not rely on color alone.

## Supported preferences

- voice-first, touch-first, and balanced interaction;
- One Thing / reduced-load mode;
- high-legibility text and larger text scales;
- always-visible captions;
- extra response time and repeated key information;
- higher contrast and reduced motion.

Every protected action has a visible control, accessible name, text status, and spoken-equivalent confirmation. The simulator is fully keyboard operable. `prefers-reduced-motion` removes non-essential transitions.

## Test matrix

Automated Playwright/axe runs cover 40 scenarios across desktop, mobile, 1280 × 800 Echo Show 8 simulation, and 1920 × 1080 Echo Show 15 simulation. They exercise keyboard and activated skip navigation, touch-only protected flow, 48 × 48 targets across resident and Circle surfaces, system-aware persistent themes, RTL mobile-shell readiness, emergency boundary copy, versioned Path Lighting, Circle membership, full playbook controls, and the responsive mobile header and Updates panel. The deployed serial matrix passed all 36 public-runtime-applicable scenarios; four route-mocked contract cases remain intentionally local-only.

Manual release evidence still required:

- VoiceOver and TalkBack reading order;
- text enlargement at 200% without clipping;
- captions and response timing on a representative Alexa surface;
- offline/reconnect announcements;
- physical touch targets;
- RTL layout inspection using a pseudo-RTL locale (Arabic content is not included in this release).
