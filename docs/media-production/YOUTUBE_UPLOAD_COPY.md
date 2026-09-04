# YouTube upload copy

The audible upload file, captions, and thumbnail are complete. The public upload is `https://youtu.be/oCoXdCRVyMo`.

## Title

STAY — Adaptive Independent Living + Crisis Coordination for Alexa+

## Description

STAY helps an older adult manage an ordinary day, ask a trusted Circle for help, and run a resident-defined response plan when a Safety Window is missed—without taking control away from the resident.

Try the public demo: https://saystay.site

Explore the Apache-2.0 source: https://github.com/AmirmLotfy/stay

The protected demonstration is deterministic: Sarah misses two Morning Safety Window checks, her saved Circle plan opens coordination, Sarah asks nearby helper Tom, Tom accepts, and every surface shows “Tom is on the way.” Bedrock does not choose the escalation order, disclose protected details, or close the incident.

STAY combines accessible daily routines, adaptive access preferences, ordinary Help Requests, resident-defined Safety Windows, privacy-scoped Circle coordination, household playbooks, House Memory, incident ownership, a Streamable HTTP MCP server, and an Alexa+ web simulator.

The deployed AWS architecture uses Amazon Cognito, AWS Lambda, Amazon DynamoDB, Amazon EventBridge Scheduler, Amazon EventBridge, Amazon SQS, Amazon SES, API Gateway, private S3, KMS, CloudWatch, X-Ray, Secrets Manager, Budgets, and AWS CDK. The CloudFront/private-S3 upgrade is prepared but account-provider blocked, and the optional Amazon Bedrock/Nova/Strands intent layer remains off because this account is not yet authorized for Nova Micro invocation.

STAY does not contact emergency services, diagnose a condition, detect a fall, or replace Alexa Emergency Assist. Weather, outage, maintenance, Ring, Smart Properties, travel, and physical-device observations shown in this release are explicitly labeled simulations.

Built for the Alexa+ primary track and the AWS Builder and Open Source mini-challenges in the Build, Ship, Shape: Amazon Developer Hackathon.

## Chapters

00:00 STAY and the ordinary day
00:36 Adaptive access and privacy
01:08 A missed Safety Window
01:30 Sarah asks Tom
01:39 Tom is on the way
01:45 Help Board, playbooks, and House Memory
01:56 Alexa+ MCP and deterministic safety
02:20 AWS architecture
02:38 Stay at home, connected, and in control

## Upload settings

- Visibility: Public.
- Audience: Not made for kids.
- Category: Science & Technology.
- Language: English.
- Video file: upload `assets/submission/video/STAY_Devpost_Demo_UPLOAD_v01.mp4`.
- Captions: upload `assets/submission/video/STAY_DEMO.en.srt`, then manually compare every cue with the mixed master.
- Thumbnail: upload `assets/submission/video/STAY_YouTube_Thumbnail.png`. It is the real deployed “Tom is on the way.” product frame and contains no generated interface, fake text, Alexa device imagery, or emergency-service claim.
- Embedding: enabled so Devpost judges can watch in place.
- License: Standard YouTube License unless the entrant deliberately chooses otherwise.

## Replace the automatic captions

Do not re-upload the video. Keep `https://youtu.be/oCoXdCRVyMo` so the verified public URL, embed, analytics, and clean copyright review remain attached to the same upload.

1. In YouTube Studio, open the STAY video and choose **Languages** or **Subtitles**.
2. For English, choose **Upload manual** / **Upload file**, then select **With timing**.
3. Upload `assets/submission/video/STAY_DEMO.en.srt`. Its SHA-256 is `6304dc386bd7f19d851a7c2b82e3ff4ef490afa49a0d3a6dd100780824d9dfed`.
4. Preview the track before publishing. It must show 36 sequential cues and end at `00:02:49,800`.
5. Publish the manual English track. Do not save the inaccurate automatic transcript as a draft or publish edits made against it.
6. Open the public video signed out, enable **CC**, and spot-check:
   - `00:00` — `[Soft felt-piano and marimba music]`
   - `00:04` — “Independent living is often lost…”
   - `01:39` — “Tom is on the way.”
   - `02:39` — `[Music continues, then fades]`
7. Watch once from start to finish with sound and captions enabled. Confirm that cues do not overlap, cover the spoken words, remain readable on mobile, and contain none of the previous automatic errors such as “provenence,” “Dynamob,” or “stateuler.”

After this check, mark the two remaining caption/playback items in `DELIVERY_CHECKLIST.md` complete. No repository or video-file regeneration is needed.

## Tags

STAY, Alexa+, Model Context Protocol, MCP, Amazon Bedrock, Amazon Nova, Strands Agents SDK, AWS, accessibility, independent living, safety coordination, open source, Devpost

## Pinned comment

Try STAY: https://saystay.site

Source and setup instructions: https://github.com/AmirmLotfy/stay

The public demo uses synthetic people and clearly labeled simulated provider data. No emergency service is contacted.

## Post-upload evidence

The final public URL is `https://youtu.be/oCoXdCRVyMo`. Signed-out verification confirmed public playback, 170-second duration, 1080p availability, and embedding. A signed-in read-only inspection on 2026-09-04 found that the current English track is YouTube's imperfect auto-caption transcript; replace it with `assets/submission/video/STAY_DEMO.en.srt` and publish the replacement. The Studio Claim overview reported no claims and no copyrighted content found.
