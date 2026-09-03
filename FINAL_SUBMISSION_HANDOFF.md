# STAY final submission handoff

Everything in this file is prepared for the participant's manual YouTube upload and Devpost entry. Nothing has been submitted to Devpost.

## YouTube upload kit

- Video to upload: `assets/submission/video/STAY_Devpost_Demo_UPLOAD_v01.mp4`
- English captions: `assets/submission/video/STAY_DEMO.en.srt`
- Thumbnail: `assets/submission/video/STAY_YouTube_Thumbnail.png`
- Ready-to-copy title, description, chapters, tags, and pinned comment: `docs/media-production/YOUTUBE_UPLOAD_COPY.md`
- Archival master: `assets/submission/video/STAY_Devpost_Demo_MASTER_v01.mp4`

The upload and archival files are byte-identical, 170 seconds, 1920 × 1080, H.264 High at 30 fps with AAC-LC 48 kHz stereo. SHA-256: `63354dc8a1a25809bb530aed28d417279c941da97817636cf3a825b00814f00c`.

Before upload, watch and listen to the full file and compare the SRT cues. After upload, confirm Public visibility, HD processing, captions, embedding, and no copyright claim. Then replace `[PUBLIC_YOUTUBE_URL]` in `devpost-submission.md` and `docs/release-links.md`.

## Devpost copy kit

- All public field answers: `devpost-submission.md`
- Private participant answers: `devpost-private-answers.md` (local and intentionally ignored by Git)
- Judge link manifest: `docs/release-links.md`
- Submission readiness audit: `docs/submission-readiness-audit.md`

The live project URL is `https://saystay.site`. The public repository is `https://github.com/AmirmLotfy/stay`. Public CI for reliability commit `d6411a6` is `https://github.com/AmirmLotfy/stay/actions/runs/33815696171`.

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

## Final human gates

1. Correct the Age of Majority and Eligible Jurisdiction answers only if the recorded `No` values were mistakes and the truthful answers are `Yes`. An individual submission is not eligible with the current values.
2. Complete the full video, audio, and caption review.
3. Upload the YouTube kit and record its public URL.
4. Paste the prepared Devpost answers and gallery in the order above.
5. Recheck the public demo, repository, video embedding, track, mini-challenges, and official form.
6. Use Devpost's final confirmation only when every gate passes.

AWS Support cases `178838582000594` (SES production access) and `178838741100092` (account verification for CloudFront and Bedrock) remain provider-controlled. The deployed deterministic demo does not depend on either pending capability.
