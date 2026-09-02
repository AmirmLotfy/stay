# Editor-neutral delivery handoff

## Inputs

- Picture-only browser capture: `assets/submission/video/stay-screen-capture.webm`
- Approved screenshots: `assets/submission/screenshots/01-*.png` through `06-*.png`
- Voice-over: `assets/submission/audio/stay-voiceover-approved.wav`
- Music or tonal bed when a provenance-complete Higgsfield source is available: `assets/submission/audio/stay-tonal-bed-approved.wav`
- Voice/music provenance: `AUDIO_PROVENANCE.csv`
- Captions: `STAY_DEMO.en.srt`

## Edit rules

- Traditional, deterministic editing only: cuts, crops, transforms, typography, color, fades, and audio mixing.
- Do not generatively alter product screens or remove simulated-provider and safety labels.
- Keep the “Tom is on the way.” frame on screen for at least five seconds.
- Voice remains fully intelligible. Target integrated loudness is about −14 LUFS, true peak no higher than −1 dBTP.
- Music stays at least 16 dB below narration and ducks further during the missed-window sequence.
- If Higgsfield still exposes no native music action, deliver a voice-only master rather than substituting stock, licensed, human-composed, or falsely attributed music. Record that limitation; a voice-only master does not satisfy the preferred music brief.
- Use straight cuts and restrained 150–220 ms fades; no glitch, neural-network, hologram, or chatbot motifs.
- Final frame contains the product name, one-line promise, public demo URL, and public repository URL.

## Delivery

- `STAY_Devpost_Demo_MASTER_v01.mp4`: 1920×1080, H.264 High, 30 fps, AAC 48 kHz, under 02:59.
- `STAY_Devpost_Demo_UPLOAD_v01.mp4`: upload-identical copy unless YouTube rejects the master.
- Generate SHA-256 checksums for the master, upload copy, voice, music, captions, and screenshot set.
