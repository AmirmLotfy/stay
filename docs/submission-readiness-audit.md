# Submission readiness audit

Updated 2026-09-05 during recovery implementation. Source and submission media survived the lost session. The judge demo remains deployed; the new pilot work is a local candidate.

## Decision

**Final Devpost submission is still pending.** The corrected private eligibility handoff passes strict verification. Approved manual captions are saved in YouTube Studio and visibly render in the public player. The participant must finish the complete video/audio/caption review and manually enter and submit the reviewed packet. Authenticated deployed MCP initialize/list/call needs fresh evidence.

## Current evidence

| Gate                   | Evidence                                                                                                                                                                     | Status                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Judge demo             | `https://saystay.site`; deployed stack freshly reports `UPDATE_COMPLETE`; public HTTP/OAuth/MCP boundary checked by strict verifier                                          | Available                                         |
| Public release         | Baseline `4a7aa49240ecd8a69afe7bb35443aaa32fadd5bd`; latest historical CI `33933798929` on `503b56b`; deployment `33886987014` on `d569032`                                  | Preserved                                         |
| Media                  | Strict verifier passes all 21 asset hashes, 170-second master/upload copy, 36 captions and live links                                                                        | 15/15 strict checks passed                        |
| YouTube                | Approved 36-cue SRT persisted in Studio; public player displayed `[Soft felt-piano and marimba music]`; historical signed-out playback/embed and copyright inspection passed | Manual track available; full human review pending |
| Private eligibility    | Participant confirmed both former negative answers were mistakes; ignored local handoff now records the confirmed answers                                                    | Corrected locally                                 |
| Devpost ownership      | Authenticated project under `amirmolotfy` visibly reports **DRAFT, 1/5 steps done**; submission route ID `1166410-stay`, project slug `stay-ljbdk8`                          | Not submitted                                     |
| Official form coverage | Fresh read-only inspection of overview, project details and all 26 additional fields `28285`–`28310`; IDs and meanings match root `devpost-submission.md`                    | Reconciled                                        |
| Prepared tracks        | Alexa+; AWS Builder and Open Source mini-challenges; all remain present in the official form                                                                                 | Preserved in packet                               |
| New pilot code         | Separate identity/data/queues/domain, membership and private contacts, operator commands and empty household UI                                                              | Candidate; no deployment/enrollment               |
| Provider               | AWS credentials now valid; SES sending enabled but sandbox (200/day, 1/sec); no current pilot inbox receipt test                                                             | Restricted                                        |

The live draft still has only its title saved. Pitch, narrative, tags, links, video, screenshots and additional answers await participant entry. No form field or final-submission action was changed in this recovery pass. Do not mistake a prepared answer for a saved Devpost answer.

## Form reconciliation

- Overview: title and elevator pitch; thumbnail JPG/PNG/GIF, max 5 MB, recommended 3:2 ratio.
- Details: Markdown story, up to 25 build tags, try-it links, video link, gallery up to 15 images at max 5 MB each. The seven prepared screenshots fit the gallery count; keep their approved order.
- Fields `28285`–`28288`: submitter, organization, country, Canadian province; private participant handoff supplies personal answers.
- `28289`–`28292`: Alexa+ track, public repository, project timing and any existing-project explanation.
- `28293`–`28299`: AWS Builder and Open Source entries with integration and contribution evidence.
- `28300`–`28307`: feature requests, friction log, testing link and five required feedback answers.
- `28308`–`28310`: age, eligible jurisdiction and employee/affiliation assertions; participant must enter truthfully.

Current text fields show no HTML `maxlength`; server validation may still impose limits. Final form validation and participant review remain necessary. Requirements and deadline should be checked at entry against the [official rules](https://amazonappdev2026.devpost.com/rules).

## Completion gates

1. Reconcile fresh deployed browser and authenticated MCP evidence in `RECOVERY_CHECKPOINT.md`.
2. Participant watches the complete video with sound and approved captions, including signed-out/mobile playback.
3. Participant enters root `devpost-submission.md`, ignored private answers, thumbnail, seven gallery images, judge links and video into the verified draft.
4. Participant reviews Devpost validation, legal assertions and final confirmation; record submitted URL and confirmation only after completion.
5. Pilot deployment, delivery, restore, device and observation gates remain separate; see `pilot-runbook.md`.
