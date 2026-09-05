# STAY final submission handoff

Everything in this file is prepared for the participant's manual Devpost entry. Nothing has been submitted to Devpost.

## Public video and source kit

- Verified public video: `https://youtu.be/oCoXdCRVyMo`

- Uploaded-video source copy: `assets/submission/video/STAY_Devpost_Demo_UPLOAD_v01.mp4`
- English captions: `assets/submission/video/STAY_DEMO.en.srt`
- Caption replacement procedure: `docs/media-production/YOUTUBE_UPLOAD_COPY.md#replace-the-automatic-captions`
- Thumbnail: `assets/submission/video/STAY_YouTube_Thumbnail.png`
- Ready-to-copy title, description, chapters, tags, and pinned comment: `docs/media-production/YOUTUBE_UPLOAD_COPY.md`
- Archival master: `assets/submission/video/STAY_Devpost_Demo_MASTER_v01.mp4`

The upload and archival files are byte-identical, 170 seconds, 1920 × 1080, H.264 High at 30 fps with AAC-LC 48 kHz stereo. SHA-256: `63354dc8a1a25809bb530aed28d417279c941da97817636cf3a825b00814f00c`.

The approved 36-cue SRT is now saved in YouTube Studio and its opening music caption visibly renders in the public player (2026-09-05). The historical signed-out check confirmed public, embeddable, 170-second, 1080p playback. Complete the final start-to-finish audio/caption review and signed-out/mobile check before submission. No video or source asset was regenerated.

## Devpost copy kit

- All public field answers: `devpost-submission.md`
- Private participant answers: `devpost-private-answers.md` (local and intentionally ignored by Git)
- Judge link manifest: `docs/release-links.md`
- Submission readiness audit: `docs/submission-readiness-audit.md`

The live project URL is `https://saystay.site`. The public repository is `https://github.com/AmirmLotfy/stay`. Public CI for release evidence commit `503b56b` is `https://github.com/AmirmLotfy/stay/actions/runs/33933798929`; it includes the deterministic 8/8 submission-media gate and all 40 browser scenarios (36 apply to the deployed public runtime). The reviewed AWS diff is `https://github.com/AmirmLotfy/stay/actions/runs/33886709356`; the successful OIDC deployment is `https://github.com/AmirmLotfy/stay/actions/runs/33886987014`.

## Gallery order

Upload these screenshots in this order:

1. `assets/submission/screenshots/04-tom-on-the-way-desktop.png`
2. `assets/submission/screenshots/01-home-desktop.png`
3. `assets/submission/screenshots/02-access-desktop.png`
4. `assets/submission/screenshots/03-privacy-desktop.png`
5. `assets/submission/screenshots/07-mobile-updates.png`
6. `assets/submission/screenshots/05-emergency-boundary-desktop.png`
7. `assets/submission/screenshots/06-home-mobile.png`

All seven were captured from the deployed public demo after the responsive-accessibility release. Their checksums and provenance are recorded in `assets/submission/candidate-checksums.sha256` and `docs/media-production/VISUAL_PROVENANCE.csv`.

The draft was freshly reverified under `amirmolotfy` on 2026-09-06: **DRAFT, 1/5 steps done**. All 26 official additional fields remain blank and their IDs still match the copy pack. [Continue the verified draft](https://devpost.com/submit-to/30992-build-ship-shape-amazon-developer-hackathon/manage/submissions/1166410-stay/project-overview).

## Final human gates

1. The participant confirmed on 2026-09-05 that both negative eligibility answers were entry errors. The ignored private handoff records Yes; copy the confirmed answers into the official form.
2. The approved manual English captions are available. Complete a private start-to-finish video, audio, and caption review plus signed-out/mobile playback. The copyright-claim gate has passed.
3. Paste the prepared Devpost answers and gallery in the order above.
4. Recheck the public demo, repository, video embedding, track, mini-challenges, and official form.
5. Use Devpost's final confirmation only when every gate passes.

AWS Support cases `178838582000594` (SES production access) and `178838741100092` (account verification for CloudFront and Bedrock) remain provider-controlled. The deployed deterministic demo does not depend on either pending capability.
