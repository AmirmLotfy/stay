import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const scriptPath = path.join(workspaceRoot, 'docs/media-production/VOICEOVER_SCRIPT.md');
const outputPath = path.join(workspaceRoot, 'assets/submission/video/STAY_DEMO.en.srt');
const wordsPerSecond = 2.15;
const startAtSeconds = 4;

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function splitLongSentence(sentence) {
  if (wordCount(sentence) <= 22) return [sentence];
  const parts = sentence.split(/(?<=[:,;])\s+|\s+(?=and\s|or\s)/i).filter(Boolean);
  return parts.length > 1 ? parts : [sentence];
}

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

const markdown = await readFile(scriptPath, 'utf8');
const narration = markdown.split('## Script')[1]?.trim();
if (!narration) throw new Error('VOICEOVER_SCRIPT.md is missing its Script section.');

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const captions = [...segmenter.segment(narration)]
  .map((entry) => entry.segment.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
  .flatMap(splitLongSentence);

let cursor = startAtSeconds;
const entries = captions.map((caption, index) => {
  const duration = Math.max(1.8, wordCount(caption) / wordsPerSecond);
  const start = cursor;
  const end = start + duration;
  cursor = end + 0.08;
  return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${wrapCaption(caption)}\n`;
});

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${entries.join('\n')}\n`, 'utf8');
process.stdout.write(
  `Wrote ${captions.length} captions ending at ${timestamp(cursor)} to ${outputPath}\n`,
);
