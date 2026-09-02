# Submission assets

This directory contains judge-facing media generated from a verified STAY build.

- `screenshots/`: deterministic Playwright captures. Keep the numbered filenames in presentation order.
- `video/`: picture-only browser capture, working edit, final master, and upload-ready MP4.
- `audio/`: AI voice-over, AI music/tonal bed, mix stems, and checksums.

YouTube title, description, chapters, tags, caption instructions, and post-upload checks live in `docs/media-production/YOUTUBE_UPLOAD_COPY.md`. Judge-facing URLs and their evidence gates live in `docs/release-links.md`.

Verify every tracked candidate from this directory so the manifest's relative paths resolve correctly:

```bash
cd assets/submission
shasum -a 256 -c candidate-checksums.sha256
```

Do not place credentials, private household data, raw browser profiles, or unreviewed provider downloads here. Every externally generated asset must have a matching entry in `docs/media-production/AUDIO_PROVENANCE.csv` or `docs/media-production/VISUAL_PROVENANCE.csv`.
