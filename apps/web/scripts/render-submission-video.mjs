import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const videoDir = path.join(workspaceRoot, 'assets/submission/video');
const audioDir = path.join(workspaceRoot, 'assets/submission/audio');
const titleCard = path.join(videoDir, 'cards/01-title-card.png');
const architectureCard = path.join(videoDir, 'cards/02-architecture-card.png');
const closeCard = path.join(videoDir, 'cards/03-close-card.png');
const screenCapture = path.join(videoDir, 'stay-screen-capture.webm');
const pictureMaster = path.join(videoDir, 'stay-picture-master.mp4');
const voiceOver = path.join(audioDir, 'stay-voiceover-approved.wav');
const tonalBed = path.join(audioDir, 'stay-tonal-bed-approved.wav');
const finalMaster = path.join(videoDir, 'STAY_Devpost_Demo_MASTER_v01.mp4');
const uploadCopy = path.join(videoDir, 'STAY_Devpost_Demo_UPLOAD_v01.mp4');

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function verifyFinalMaster(file) {
  const probe = JSON.parse(
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
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  const failures = [];

  if (video?.codec_name !== 'h264') failures.push('video codec is not H.264');
  if (video?.width !== 1920 || video?.height !== 1080) failures.push('frame is not 1920×1080');
  if (video?.r_frame_rate !== '30/1') failures.push('frame rate is not 30 fps');
  if (audio?.codec_name !== 'aac') failures.push('audio codec is not AAC');
  if (audio?.sample_rate !== '48000') failures.push('audio sample rate is not 48 kHz');
  if (!Number.isFinite(duration) || duration >= 179) failures.push('runtime is not below 2:59');

  if (failures.length > 0) {
    throw new Error(`Final master verification failed: ${failures.join('; ')}`);
  }

  return duration;
}

await mkdir(videoDir, { recursive: true });

const videoInputs = [
  '-loop',
  '1',
  '-t',
  '8',
  '-i',
  titleCard,
  '-i',
  screenCapture,
  '-loop',
  '1',
  '-t',
  '18',
  '-i',
  architectureCard,
  '-loop',
  '1',
  '-t',
  '12',
  '-i',
  closeCard,
];

const videoFilter = [
  '[0:v]fps=30,format=yuv420p[v0]',
  '[1:v]setpts=PTS/1.1415,fps=30,format=yuv420p[v1]',
  '[2:v]fps=30,format=yuv420p[v2]',
  '[3:v]fps=30,format=yuv420p[v3]',
  '[v0][v1][v2][v3]concat=n=4:v=1:a=0[v]',
].join(';');

execFileSync(
  'ffmpeg',
  [
    '-y',
    ...videoInputs,
    '-filter_complex',
    videoFilter,
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    pictureMaster,
  ],
  { stdio: 'inherit' },
);

const hasVoiceOver = await exists(voiceOver);
const hasTonalBed = await exists(tonalBed);

if (hasVoiceOver) {
  const audioInputs = ['-i', voiceOver];
  const audioFilter = hasTonalBed
    ? [
        '[1:a]adelay=4000|4000,loudnorm=I=-16:TP=-1.5:LRA=8,apad=whole_dur=170,asplit=2[voice_mix][voice_key]',
        '[2:a]atrim=0:170,volume=0.11[bed]',
        '[bed][voice_key]sidechaincompress=threshold=0.015:ratio=8:attack=25:release=450[ducked]',
        '[voice_mix][ducked]amix=inputs=2:duration=longest:dropout_transition=2,loudnorm=I=-14:TP=-1:LRA=11[a]',
      ].join(';')
    : '[1:a]adelay=4000|4000,loudnorm=I=-14:TP=-1:LRA=11,apad=whole_dur=170[a]';

  if (hasTonalBed) {
    audioInputs.push('-stream_loop', '-1', '-i', tonalBed);
  }

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      pictureMaster,
      ...audioInputs,
      '-filter_complex',
      audioFilter,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-t',
      '170',
      '-movflags',
      '+faststart',
      finalMaster,
    ],
    { stdio: 'inherit' },
  );
  const duration = verifyFinalMaster(finalMaster);
  await copyFile(finalMaster, uploadCopy);
  process.stdout.write(
    `Rendered and verified ${duration.toFixed(2)}s final master and upload copy in ${videoDir}${hasTonalBed ? ' with the approved tonal bed' : ' with approved voice only; no music source was used'}\n`,
  );
} else {
  process.stdout.write(
    `Rendered picture master only. Add ${voiceOver} to render an audible final master; ${tonalBed} is optional only while the plugin-native music provider remains unavailable.\n`,
  );
}
