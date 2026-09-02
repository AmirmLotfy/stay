import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const scriptPath = path.join(workspaceRoot, 'docs/media-production/VOICEOVER_SCRIPT.md');
const outputPath = path.join(workspaceRoot, 'assets/submission/video/STAY_DEMO.en.srt');

// Measured from the approved Higgsfield Faye narration with small.en word timing.
// Chunk 1 is 100.58s; chunk 2 begins at 104.58s after the four-second title lead.
const measuredCues = [
  [
    4,
    9.36,
    'Independent living is often lost in the space between “everything is fine” and an emergency:',
  ],
  [
    10.02,
    15.9,
    'one missed check-in, one small household problem, or one favor nobody clearly owns.',
  ],
  [17.4, 20.52, 'STAY gives Sarah one calm place for that middle ground.'],
  [21.1, 25.9, 'Today shows one thing at a time, an ordinary home check, and useful context.'],
  [
    26.74,
    34.74,
    'Every weather, device, utility, maintenance, and travel signal in this demo is clearly labeled as simulated.',
  ],
  [36.1, 40.66, 'Access preferences make the same experience work voice-first or touch-first.'],
  [
    41.5,
    48.46,
    'Sarah can choose captions, more response time, higher contrast, reduced motion, and repeated key information.',
  ],
  [49.14, 50.74, 'These settings change presentation.'],
  [51.4, 53.54, 'They never change her safety policy.'],
  [54.62, 56.42, 'Privacy is scoped by role and moment.'],
  [57.28, 59.08, 'Routine details stay private.'],
  [
    59.72,
    67.56,
    'Access instructions and location can appear only inside an authenticated, assigned incident when Sarah’s plan permits it.',
  ],
  [68.24, 70.44, 'Now Sarah misses her Morning Safety Window.'],
  [
    71.22,
    76.4,
    'STAY makes one deterministic check, waits through the grace period, and checks once more.',
  ],
  [77.26, 79.48, 'Bedrock does not choose what happens next.'],
  [80.28, 81.48, 'Sarah’s saved plan does.'],
  [82.16, 86.08, 'After the second missed check, her Circle plan opens an incident.'],
  [86.72, 89.28, 'STAY has not contacted emergency services.'],
  [90, 92.08, 'Sarah asks Tom, a nearby helper.'],
  [
    92.74,
    97.42,
    'Only the minimum incident detail is shared, and every action enters the timeline.',
  ],
  [98.24, 98.72, 'Tom accepts.'],
  [99.34, 100.14, 'Tom is on the way.'],
  [100.6, 101.94, 'He now owns the response,'],
  [102.74, 104.48, 'and the Circle sees the same update.'],
  [
    104.58,
    111.32,
    'STAY also handles ordinary Help Requests, household playbooks, availability, and privacy-filtered House Memory.',
  ],
  [
    111.84,
    115.46,
    'The deterministic workflows keep working if the language model is unavailable.',
  ],
  [
    116.18,
    122.5,
    'For Alexa Plus, STAY exposes ten goal-level tools through a standards-based MCP server with',
  ],
  [122.5, 127.4, 'accessible text, typed structured content, provenance, and Alexa-style widgets.'],
  [
    128.16,
    134.8,
    'On AWS, Cognito protects identity; DynamoDB transactions and an outbox preserve state;',
  ],
  [
    135.68,
    140.82,
    'Scheduler and EventBridge coordinate checks; WebSockets and minimal email deliver updates;',
  ],
  [141.36, 145.08, 'and Nova interprets only redacted, non-critical intent.'],
  [
    146.18,
    152.42,
    'STAY does not contact emergency services, diagnose a condition, detect a fall, or replace Alexa',
  ],
  [152.42, 153.38, 'Emergency Assist.'],
  [153.38, 158.9, 'STAY helps people stay at home, stay connected, and stay in control.'],
];

function wrapCaption(text, width = 44) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current && `${current} ${word}`.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= 2) return lines.join('\n');
  const midpoint = Math.ceil(words.length / 2);
  return `${words.slice(0, midpoint).join(' ')}\n${words.slice(midpoint).join(' ')}`;
}

function timestamp(seconds) {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}

function normalizeSpeech(text) {
  return text
    .normalize('NFKD')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const markdown = await readFile(scriptPath, 'utf8');
const narration = markdown.split('## Script')[1]?.trim();
if (!narration) throw new Error('VOICEOVER_SCRIPT.md is missing its Script section.');

const timedNarration = measuredCues.map(([, , text]) => text).join(' ');
if (normalizeSpeech(timedNarration) !== normalizeSpeech(narration)) {
  throw new Error(
    'Measured caption text no longer matches VOICEOVER_SCRIPT.md. Retime the approved narration before continuing.',
  );
}

const entries = measuredCues.map(
  ([start, end, text], index) =>
    `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${wrapCaption(text)}\n`,
);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${entries.join('\n')}\n`, 'utf8');
process.stdout.write(
  `Wrote ${measuredCues.length} measured captions ending at ${timestamp(measuredCues.at(-1)[1])} to ${outputPath}\n`,
);
