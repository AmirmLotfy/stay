import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolveNs } from 'node:dns/promises';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const allowPending = process.argv.includes('--allow-pending');
const results = [];

function record(status, check, detail) {
  results.push({ status, check, detail });
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256(file) {
  const body = await readFile(file);
  return createHash('sha256').update(body).digest('hex');
}

function probe(file) {
  return JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8' },
    ),
  );
}

function validateVideo(file, { audioRequired }) {
  const metadata = probe(file);
  const video = metadata.streams.find((stream) => stream.codec_type === 'video');
  const audio = metadata.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(metadata.format.duration);
  const failures = [];

  if (video?.codec_name !== 'h264') failures.push('video is not H.264');
  if (video?.width !== 1920 || video?.height !== 1080) failures.push('frame is not 1920×1080');
  if (video?.r_frame_rate !== '30/1') failures.push('frame rate is not 30 fps');
  if (!Number.isFinite(duration) || duration >= 179) failures.push('runtime is not below 2:59');
  if (audioRequired && audio?.codec_name !== 'aac') failures.push('audible AAC track is missing');
  if (audioRequired && audio?.sample_rate !== '48000') failures.push('audio is not 48 kHz');

  return { duration, failures };
}

async function verifyCandidateHashes() {
  const assetRoot = path.join(workspaceRoot, 'assets/submission');
  const manifest = await readFile(path.join(assetRoot, 'candidate-checksums.sha256'), 'utf8');
  const mismatches = [];

  for (const line of manifest.trim().split('\n')) {
    const [expected, relative] = line.trim().split(/\s+/, 2);
    const file = path.join(assetRoot, relative);
    const actual = await sha256(file);
    if (actual !== expected) mismatches.push(relative);
  }

  const candidateCount = manifest.trim().split('\n').length;
  if (mismatches.length > 0) {
    record('failed', 'candidate media checksums', `mismatched: ${mismatches.join(', ')}`);
  } else {
    record('passed', 'candidate media checksums', `all ${candidateCount} tracked candidates match`);
  }
}

async function verifyUrl(check, url, expectedStatuses) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await globalThis.fetch(url, {
        headers: { 'user-agent': 'stay-submission-verifier/1.0' },
        signal: globalThis.AbortSignal.timeout(30_000),
      });
      if (expectedStatuses.includes(response.status)) {
        const retryDetail = attempt > 1 ? ` after ${attempt} attempts` : '';
        record('passed', check, `${url} returned ${response.status}${retryDetail}`);
      } else {
        record('failed', check, `${url} returned ${response.status}`);
      }
      return;
    } catch (error) {
      if (attempt === attempts) {
        const message = error instanceof Error ? error.message : String(error);
        record('failed', check, `${message} after ${attempts} attempts`);
        return;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, attempt * 750));
    }
  }
}

await verifyCandidateHashes();

const pictureMaster = path.join(workspaceRoot, 'assets/submission/video/stay-picture-master.mp4');
const picture = validateVideo(pictureMaster, { audioRequired: false });
record(
  picture.failures.length === 0 ? 'passed' : 'failed',
  'picture master',
  picture.failures.length === 0
    ? `${picture.duration.toFixed(2)}s H.264 1080p30 candidate`
    : picture.failures.join('; '),
);

const requiredProviderFiles = [
  ['Higgsfield logo source', 'assets/submission/stay-open-threshold-logo.svg'],
  ['Higgsfield voice source', 'assets/submission/audio/stay-voiceover-approved.wav'],
  ['Higgsfield tonal bed', 'assets/submission/audio/stay-tonal-bed-approved.wav'],
];

for (const [check, relative] of requiredProviderFiles) {
  const present = await exists(path.join(workspaceRoot, relative));
  record(
    present ? 'passed' : 'pending',
    check,
    present ? relative : `${relative} has not been generated and approved`,
  );
}

const finalMaster = path.join(
  workspaceRoot,
  'assets/submission/video/STAY_Devpost_Demo_MASTER_v01.mp4',
);
if (await exists(finalMaster)) {
  const final = validateVideo(finalMaster, { audioRequired: true });
  record(
    final.failures.length === 0 ? 'passed' : 'failed',
    'final audible master',
    final.failures.length === 0
      ? `${final.duration.toFixed(2)}s H.264/AAC 1080p30 master`
      : final.failures.join('; '),
  );
} else {
  record('pending', 'final audible master', 'approved voice-over is still required');
}

const devpostCopy = await readFile(path.join(workspaceRoot, 'devpost-submission.md'), 'utf8');
const privateAnswersPath = path.join(workspaceRoot, 'devpost-private-answers.md');
const privateAnswers = (await exists(privateAnswersPath))
  ? await readFile(privateAnswersPath, 'utf8')
  : '';

function privateFieldAnswer(fieldId) {
  const privateField = privateAnswers.match(
    new RegExp(`\\*\\*${fieldId}[^\\n]*\\*\\*\\s*([^\\n]+)`, 'i'),
  );
  return privateField?.[1]?.trim();
}

const unresolvedPublic =
  devpostCopy.match(/\[(?:PUBLIC_YOUTUBE_URL|CONFIRM[^\]]*|AMIR MUST CONFIRM[^\]]*)\]/g) ?? [];
const privateFieldIds = ['28285', '28286', '28287', '28288', '28308', '28309', '28310'];
const missingPrivateFields = privateFieldIds.filter((fieldId) => !privateFieldAnswer(fieldId));
const unresolvedCount = unresolvedPublic.length + missingPrivateFields.length;
record(
  unresolvedCount > 0 ? 'pending' : 'passed',
  'Devpost copy placeholders',
  unresolvedCount > 0 ? `${unresolvedCount} unresolved form fields` : 'none',
);

function formFieldAnswer(fieldId) {
  const privateField = privateFieldAnswer(fieldId);
  if (privateField) return privateField;
  const field = devpostCopy.match(new RegExp(`### ${fieldId}[^\\n]*\\n\\n([^\\n]+)`, 'i'));
  return field?.[1]?.trim();
}

const participantEligibility = [
  ['28308', 'age of majority'],
  ['28309', 'eligible jurisdiction'],
].map(([fieldId, label]) => ({ answer: formFieldAnswer(fieldId), label }));
const deniedEligibility = participantEligibility.filter(({ answer }) =>
  /^no\b/i.test(answer ?? ''),
);
const unresolvedEligibility = participantEligibility.filter(
  ({ answer }) => !answer || /^\[|must confirm/i.test(answer),
);

if (deniedEligibility.length > 0) {
  record(
    'failed',
    'participant eligibility',
    `negative confirmation: ${deniedEligibility.map(({ label }) => label).join(', ')}`,
  );
} else if (unresolvedEligibility.length > 0) {
  record(
    'pending',
    'participant eligibility',
    `unresolved: ${unresolvedEligibility.map(({ label }) => label).join(', ')}`,
  );
} else {
  record('passed', 'participant eligibility', 'age and jurisdiction confirmed eligible');
}

await verifyUrl('public judge demo', 'https://saystay.site', [200]);
await verifyUrl('MCP bearer boundary', 'https://saystay.site/mcp', [401]);
await verifyUrl('public GitHub repository', 'https://api.github.com/repos/AmirmLotfy/stay', [200]);

const expectedNameServers = [
  'ns-349.awsdns-43.com',
  'ns-1914.awsdns-47.co.uk',
  'ns-816.awsdns-38.net',
  'ns-1302.awsdns-34.org',
].sort();
try {
  const actualNameServers = (await resolveNs('saystay.site'))
    .map((nameServer) => nameServer.replace(/\.$/, ''))
    .sort();
  const delegated = JSON.stringify(actualNameServers) === JSON.stringify(expectedNameServers);
  record(
    delegated ? 'passed' : 'pending',
    'saystay.site delegation',
    delegated
      ? 'registrar nameservers match Route 53'
      : `observed: ${actualNameServers.join(', ')}`,
  );
} catch {
  record('pending', 'saystay.site delegation', 'no public NS records observed');
}

const counts = results.reduce(
  (summary, result) => ({ ...summary, [result.status]: summary[result.status] + 1 }),
  { passed: 0, pending: 0, failed: 0 },
);
process.stdout.write(`${JSON.stringify({ counts, results }, null, 2)}\n`);

if (counts.failed > 0) process.exitCode = 1;
else if (counts.pending > 0 && !allowPending) process.exitCode = 2;
