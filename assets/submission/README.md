# Submission assets

This directory contains judge-facing media generated from a verified STAY build.

- `screenshots/`: deterministic Playwright captures. Keep the numbered filenames in presentation order.
- `video/`: real browser capture, deterministic cards, final audible master, upload-ready MP4, measured English captions, and YouTube thumbnail.
- `audio/`: approved Higgsfield Faye voice-over, approved Higgsfield Sonilo tonal bed, and locked voice identity.
- `stay-open-threshold-logo.svg` and `stay-open-threshold-logo-2048.png`: approved Higgsfield Recraft V4.1 identity exports.

YouTube title, description, chapters, tags, caption instructions, and post-upload checks live in `docs/media-production/YOUTUBE_UPLOAD_COPY.md`. Judge-facing URLs and their evidence gates live in `docs/release-links.md`.

Verify every tracked candidate from this directory so the manifest's relative paths resolve correctly:

```bash
cd assets/submission
shasum -a 256 -c candidate-checksums.sha256
```

Do not place credentials, private household data, raw browser profiles, or unreviewed provider downloads here. Every externally generated asset must have a matching entry in `docs/media-production/AUDIO_PROVENANCE.csv` or `docs/media-production/VISUAL_PROVENANCE.csv`.
