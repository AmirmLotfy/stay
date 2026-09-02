# YouTube upload copy

The audible upload file, captions, and thumbnail are complete. Use this copy only after the human start-to-finish watch/listen in `DELIVERY_CHECKLIST.md`; replace the bracketed YouTube URL in the repository after upload.

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

## Tags

STAY, Alexa+, Model Context Protocol, MCP, Amazon Bedrock, Amazon Nova, Strands Agents SDK, AWS, accessibility, independent living, safety coordination, open source, Devpost

## Pinned comment

Try STAY: https://saystay.site

Source and setup instructions: https://github.com/AmirmLotfy/stay

The public demo uses synthetic people and clearly labeled simulated provider data. No emergency service is contacted.

## Post-upload evidence

Record the final public URL as `[PUBLIC_YOUTUBE_URL]` in `devpost-submission.md` and `docs/release-links.md`. Confirm the page is public in a signed-out browser, the duration is under three minutes, HD processing is complete, captions are available, embedding works, and no copyright claim appears before using the URL on Devpost.
