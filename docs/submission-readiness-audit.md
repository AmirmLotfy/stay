# Submission readiness audit

Updated 2026-09-08 after authenticated form, public-link, final-CI and pilot change-set revalidation. Source and submission media survived the lost session. The judge demo remains deployed; the pilot implementation is merged but undeployed.

## Decision

**Final Devpost submission is still pending.** The corrected private eligibility handoff passes strict verification. Approved manual captions are saved in YouTube Studio and visibly render in the public player. The participant must finish the complete video/audio/caption review and manually enter and submit the reviewed packet. Authenticated deployed MCP initialize/list/call needs fresh evidence.

## Current evidence

| Gate                   | Evidence                                                                                                                                                                                                                                          | Status                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Judge demo             | `https://saystay.site`; fresh public HTTP/OAuth/MCP boundary checks passed; 36/36 applicable deployed browser scenarios passed in 5.3 minutes; last recorded stack state is `UPDATE_COMPLETE`                                                     | Available                                                                  |
| Public release         | Final `main` `1adafd50519dba6d595832d3b136dfd7bb49d086`; [CI 34164700108](https://github.com/AmirmLotfy/stay/actions/runs/34164700108) passed the complete pipeline and 44 browser scenarios; judge deployment remains `33886987014` on `d569032` | Preserved; pilot code not deployed                                         |
| Media                  | Strict verifier passes all 21 asset hashes, 170-second master/upload copy, 36 captions and live links                                                                                                                                             | 15/15 strict checks passed                                                 |
| YouTube                | Approved 36-cue SRT persisted in Studio; an uninterrupted public-player pass reached 2:50 with the opening cue and synchronized manual captions visible at 1:01 and 2:01 before normal autoplay                                                   | Stream/caption continuity passed; participant sound/content review pending |
| Private eligibility    | Participant confirmed both former negative answers were mistakes; ignored local handoff now records the confirmed answers                                                                                                                         | Corrected locally                                                          |
| Devpost ownership      | Reverified read-only 2026-09-08 under `amirmolotfy`: **DRAFT, 1/5 steps done**; submission route `1166410-stay`, project slug `stay-ljbdk8`                                                                                                       | Not submitted                                                              |
| Official form coverage | Fresh read-only inspection confirms all 26 additional fields `28285`–`28310` remain blank; IDs and meanings match root `devpost-submission.md`                                                                                                    | Reconciled                                                                 |
| Prepared tracks        | Alexa+; AWS Builder and Open Source mini-challenges; all remain present in the official form                                                                                                                                                      | Preserved in packet                                                        |
| New pilot code         | Separate identity/data/queues/domain, membership and private contacts, operator commands and empty household UI; merged to `main` with an exact non-executed 150-addition change set                                                              | Prepared; no deployment/enrollment                                         |
| Provider               | Local AWS auth was refreshed as account root and used only for read-only inspection. Live SES remains sandboxed with review denied; `saystay.site` is verified with DKIM success. The exact pilot change set remains available and unexecuted     | Current read-only evidence; deployment gated                               |

The live draft still has only its title saved. Pitch, thumbnail, narrative, tags, links, video, screenshots and additional answers await participant entry. The terms checkbox remains unchecked. No form field, save action or final-submission action was changed in this recovery pass. Do not mistake a prepared answer for a saved Devpost answer.

## Form reconciliation

- Overview: title and elevator pitch; project-thumbnail candidate is `assets/submission/video/STAY_YouTube_Thumbnail.png`, a reviewed 1920×1080 PNG at 212,239 bytes. Devpost recommends 3:2, so inspect the crop preview before saving.
- Details: Markdown story, up to 25 build tags, try-it links, video link, gallery up to 15 images at max 5 MB each. All seven prepared screenshots are valid PNGs below 233 KB; keep the exact upload order in `devpost-submission.md`.
- Fields `28285`–`28288`: submitter, organization, country, Canadian province; private participant handoff supplies personal answers.
- `28289`–`28292`: Alexa+ track, public repository, project timing and any existing-project explanation.
- `28293`–`28299`: AWS Builder and Open Source entries with integration and contribution evidence.
- `28300`–`28307`: feature requests, friction log, testing link and five required feedback answers.
- `28308`–`28310`: age, eligible jurisdiction and employee/affiliation assertions; participant must enter truthfully.

Current text fields show no HTML `maxlength`; server validation may still impose limits. Final form validation and participant review remain necessary. Requirements and deadline should be checked at entry against the [official rules](https://amazonappdev2026.devpost.com/rules).

## Completion gates

1. Capture fresh authenticated MCP initialize/list/call evidence in `RECOVERY_CHECKPOINT.md`; public boundaries and all 36 applicable deployed browser scenarios are current.
2. Participant watches the complete video with sound and approved captions, including signed-out/mobile playback.
3. Participant enters root `devpost-submission.md`, ignored private answers, thumbnail, seven gallery images, judge links and video into the verified draft.
4. Participant reviews Devpost validation, legal assertions and final confirmation; record submitted URL and confirmation only after completion.
5. Pilot deployment, delivery, restore, device and observation gates remain separate; see `pilot-runbook.md`.

## Recovery and pilot evidence — 2026-09-08

[PR #3](https://github.com/AmirmLotfy/stay/pull/3) was merged. After two workflow-only corrections, final `main` is `1adafd50519dba6d595832d3b136dfd7bb49d086` and [CI 34164700108](https://github.com/AmirmLotfy/stay/actions/runs/34164700108) passed the complete pipeline with coverage, strict demo/pilot synthesis and all 44 browser scenarios. The approved diff-only [pilot workflow 34164714532](https://github.com/AmirmLotfy/stay/actions/runs/34164714532) prepared `stay-pilot-review-1adafd50519dba6d595832d3b136dfd7bb49d086` in `CREATE_COMPLETE` / `AVAILABLE` state with 150 additions, zero modifications and zero removals. It did not execute the change set. The public judge deployment remains `d569032`.

Fresh `pnpm verify:submission` returned **15 passed, 0 pending, 0 failed**. Fresh public checks returned 200 for the site and OAuth metadata and the expected 401 for unauthenticated MCP. The installed-Chromium deployed suite then passed all **36 applicable scenarios** in 5.3 minutes; four pilot-only and four route-mocked local cases skipped as designed. Read-only Cognito inspection found zero demo users and only authorization-code clients, so a fresh authenticated MCP initialize/list/call test requires a reviewed identity and cannot be replaced by a machine flow. Complete live/manual gates in `RECOVERY_CHECKPOINT.md` remain open.

The master and upload video files are byte-identical and both video/audio streams decode for the full 170 seconds without errors. Audio measures −14.6 LUFS integrated with −0.9 dBFS true peak, and only the intentional closing tail exceeds one second of near-silence. The 36-cue SRT converts cleanly with no malformed or overlapping cues and ends at 169.8 seconds. Representative frames cover the intended title, protected product flow, architecture and closing cards. A fresh public-player check shows manual English selected separately from English auto-generated and renders the approved opening music cue. An uninterrupted pass reached 2:50 with synchronized manual captions visible at 1:01 and 2:01 before normal autoplay. YouTube's CC control still exposes a stale “unavailable” accessibility label, but the settings menu and visible caption confirm the manual track is active. This technical evidence still requires participant start-to-finish sound/content review on the public player.

Live AWS read-only revalidation on 2026-09-08 confirmed the refreshed local identity is `arn:aws:iam::828547077857:root`, so no deployment or operator mutation was attempted. The reviewed pilot change set remains `CREATE_COMPLETE` / `AVAILABLE` with 150 additions and no modifications/removals. CloudFormation reports the expected empty `REVIEW_IN_PROGRESS` placeholder for the prepared create change set; it has no outputs and no pilot resources are deployed. The demo stack is `UPDATE_COMPLETE` with termination protection enabled and no recorded modified/deleted resource drift. SES still reports `ProductionAccessEnabled=false`, `SendingEnabled=true`, review `DENIED`; the `saystay.site` identity is verified and DKIM is successful. Nova Micro catalog entries are active, but invocation authorization was not retested.
