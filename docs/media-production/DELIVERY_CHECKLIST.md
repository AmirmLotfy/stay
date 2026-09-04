# Demo delivery checklist

- [x] Reconcile the exact live Higgsfield Audio surface, selected model, batch one, active jobs, and displayed cost or Unlimited state; the 2026-09-02 preflight is recorded in `HIGGSFIELD_ASSET_SPECS.md`.
- [x] Record action-time approval and completed spend for three Recraft candidates, two locked-voice narration jobs, and one Sonilo music job.
- [x] Review every completed provider result before marking it candidate or approved; automated speech/transcript checks are recorded, with human final listening retained below.
- [x] Record model, prompt, date, result ID, local filename, and SHA-256 for every used audio asset.
- [x] Recapture all seven product screenshots from the verified public AWS demo, including the functional mobile Updates panel, and record their hashes and deployed provenance.
- [x] Capture the 170-second 1080p picture-only walkthrough and record its hash as local-only evidence.
- [x] Conform the edit to the real product capture and approved voice-over.
- [ ] Replace the current YouTube auto-caption track with `assets/submission/video/STAY_DEMO.en.srt`, publish it, and manually QA all 36 cues against the mixed master. A 2026-09-04 read-only Studio inspection found transcription errors in the current automatic track. The packaged SRT covers all measured narration and the music-only opening/closing.
- [x] Verify 1920×1080, 30 fps, H.264/AAC, 48 kHz stereo, and 170-second runtime below 02:59.
- [ ] Confirm speech is comfortably audible on the user's laptop speakers.
- [x] Verify the final audible master and every current copy field stay within `docs/release-evidence.md`.
- [x] Add `pnpm verify:submission --allow-pending` for current-state auditing; after the public video URL is recorded, the same command without `--allow-pending` must exit successfully before the final Devpost handoff.
- [ ] Watch the published video from start to finish with the replacement English captions enabled.
- [x] Confirm no YouTube copyright claim appears after processing — YouTube Studio Claim overview reported no claims and no copyrighted content found on 2026-09-04.
- [x] Record the verified public YouTube URL in the README, Devpost draft, and final link manifest.
