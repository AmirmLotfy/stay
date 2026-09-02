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

if ((await exists(voiceOver)) && (await exists(tonalBed))) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      pictureMaster,
      '-i',
      voiceOver,
      '-stream_loop',
      '-1',
      '-i',
      tonalBed,
      '-filter_complex',
      '[1:a]adelay=4000|4000,loudnorm=I=-16:TP=-1.5:LRA=8[voice];[2:a]atrim=0:170,volume=0.11[music];[voice][music]amix=inputs=2:duration=longest:dropout_transition=2,loudnorm=I=-14:TP=-1:LRA=11[a]',
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
  await copyFile(finalMaster, uploadCopy);
  process.stdout.write(`Rendered final master and upload copy in ${videoDir}\n`);
} else {
  process.stdout.write(
    `Rendered picture master only. Add approved Higgsfield voice and music to ${audioDir} to render the final master.\n`,
  );
}
