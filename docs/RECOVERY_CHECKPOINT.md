# STAY recovery checkpoint

Updated: 2026-09-08. Resume here before making release claims. The requirement-by-requirement status is in `PROJECT_COMPLETION_MATRIX.md`.

## Baseline

- Recovered source: `4a7aa49240ecd8a69afe7bb35443aaa32fadd5bd`.
- Current source: `1adafd50519dba6d595832d3b136dfd7bb49d086` on `main`; CI `34164700108` passed the complete pipeline and 44 browser scenarios.
- Public judge deployment remains `d569032`; deployment run `33886987014` succeeded.
- Judge URL: https://saystay.site
- Video: https://youtu.be/oCoXdCRVyMo
- Repository: https://github.com/AmirmLotfy/stay
- Devpost: https://devpost.com/software/stay-ljbdk8 (submitted 2026-09-08; authenticated editor reports Submitted, 5/5 steps done).

## Accepted decisions

- Finish the hackathon packet, then prepare an invite-only pilot.
- The participant confirmed both negative age/jurisdiction answers were entry errors and authorized correcting the private handoff. Do not publish private answers.
- Pilot: five English-speaking adult households; owner-assisted invitations; web and email; owner operates support and alerts; $25/month AWS target, not a spending stop.
- Preserve the judge demo. Prepare separate pilot identity/data/queues and `pilot.saystay.site`.
- Keep AI, physical Alexa, home devices, payments, public signup and Arabic out of the pilot milestone.
- Deterministic code controls safety. STAY does not contact emergency services.

## Evidence and remaining gates

- Fresh 2026-09-08 recovery audit: strict submission verification **15/15**; public site 200, unauthenticated MCP 401, OAuth metadata 200, YouTube embed 200, correct DNS, 21 asset hashes, 170-second media and 36 caption cues.
- Fresh anonymous judge-link pass on 2026-09-08: demo, YouTube watch/embed, public repository, setup README, friction log, final main CI and OAuth metadata each returned 200; unauthenticated MCP initialize returned the expected 401. GitHub exposes the Apache-2.0 license label and the raw README/license/friction files are public.
- Fresh GitHub deployment-role inspection on 2026-09-08: the live one-hour OIDC trust requires STS audience and exact immutable subject `repo:AmirmLotfy@178108135/stay@1354119197:ref:refs/heads/main`; there are no attached managed policies and the inline policy covers change-set/artifact operations plus the four account/region CDK bootstrap roles.
- Local AWS authentication was refreshed on 2026-09-08 and identifies as account `828547077857` root. Per the deployment runbook, it was used only for read-only inspection and must not be used for pilot mutations. The authorized first pilot deployment executed its reviewed change set but failed on the account's Lambda concurrency quota; the failed stack has since been removed. Read-only inspection found retained failed-create resources: a zero-user Cognito pool with no clients, generated website and access-log buckets, one empty Lambda log group, an empty deletion-protected product table and its KMS key. They require separate controlled cleanup. The demo stack is `UPDATE_COMPLETE`, termination protection is enabled and no modified/deleted resource drift is recorded. SES is still sandboxed (`ProductionAccessEnabled=false`, review `DENIED`) with sending enabled and a verified/DKIM-successful `saystay.site` identity. Nova Micro catalog entries are active, but no billable authorization invocation was made. A fresh main-bound change set is required before retrying the pilot.
- Approved YouTube captions are saved and visibly render in the public player. A public-player continuity pass ran from 0:00 through 2:50 without interruption; the manual track showed the approved opening cue and synchronized text at 1:01 and 2:01 before normal autoplay began. Devpost was completed on 2026-09-08 under `amirmolotfy`: Submitted, 5/5 steps done, with all 26 additional fields and the full media/copy packet saved. Authenticated pilot MCP remains pending.
- Pilot implementation and fresh validation are complete on `main`. The first authorized deployment failed and was recovered without creating a usable pilot. No household enrollment has occurred. The next deployment must use a fresh exact-main diff and change set.
- Real-device accessibility, email inbox receipt, restore rehearsal, one-household seven-day observation and five-household fourteen-day observation remain release gates.

## Verification commands

```sh
pnpm verify:submission
pnpm exec turbo run test --force
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm cdk:synth
pnpm test:e2e
STAY_E2E_BASE_URL=https://saystay.site pnpm test:e2e --workers=1
```

Record each new result with revision, timestamp, command, environment and limitations. Update this checkpoint and release evidence at every milestone; never label a prepared or blocked step complete.

## Implementation milestone

Current worktree contains the recovery and pilot candidate (not deployed). Real households load independent empty state; stored membership checks protect REST/MCP/WebSocket delivery; private contact/profile preferences use versioned contracts and request-bound replay keys. Operator commands prepare provision/invite/revoke/export/offboard/purge and pause enrollment. Neutral SES delivery rechecks membership and preferences, suppresses demo/opt-out/bounce/complaint recipients, retries explicit throttling and holds ambiguous sends for review. Scheduled checks use household-scoped immutable names, recover out-of-order transitions and atomically persist incidents. Pilot infra imports existing DNS and SES resources, reuses the existing main-scoped GitHub deployment role, and isolates identity, data and processing. See `pilot-runbook.md`, `pilot-infrastructure-review.md` and `pilot-design-evidence.md`.

Fresh evidence on 2026-09-05:

- Strict submission verifier: **15 passed, 0 pending, 0 failed**, no pending exceptions.
- Deployed judge browser suite on 2026-09-05: **36 passed, 4 local-only cases skipped**, installed Chrome, one worker, 11.8 minutes. This historical run predates the four pilot-only viewport cases.
- Local browser suite: **44 passed** (40 demo plus four viewport pilot contract scenarios). Following the final pilot retry/UI change, four pilot scenarios were rerun successfully; the final copy and skip-link styling also passed all four pilot scenarios.
- Fresh uncached monorepo test run: **18 tasks passed, 0 cached**. After independent review fixes, **85 function tests passed**, including concurrent two-household email pacing and an incident racing with offboarding. MCP: **11 tests passed**.
- Coverage command passed without lowering thresholds. New provider-command and SES SDK branches remain partly untested; local mocks do not prove cloud delivery.
- Strict demo and pilot synthesis passed; read-only pilot diff showed one new stack. The final scheduler DLQ additions passed the synth/diff rerun. Subsequent email pacing, bounded pilot metrics and Cognito provisioning changes passed focused tests, type checking and lint; the final build/synthesis and GitHub CI passed as recorded below.
- Live read-only AWS cost query on 2026-09-08 returned effectively $0 estimated unblended account cost for September 1–9, and the existing STAY $25 monthly alert budget reported $0 calculated actual spend. Free allowances, credits and reporting lag can make both incomplete; neither is a pilot forecast or spending stop.
- Fresh read-only Cognito inspection on 2026-09-08 returned zero users in the deployed demo pool and two clients (public web and Alexa account linking). Source inspection confirms both use authorization code; no client-credentials flow exists. Fresh authenticated MCP verification therefore needs a reviewed synthetic test identity or valid supplied credentials; the verifier checks initialize, list and read-only call without printing tokens or household content.

External gates still open: the action-time-confirmed public cover refresh; pilot deployment and live validation; controlled inbox/feedback/alert tests; restore and rollback rehearsal; real-device accessibility; actual participant consent/identities; seven-day then fourteen-day observations. Do not mark the whole completion plan achieved from this checkpoint.

Merged pilot baseline: `474cdf102e66aa763cba90400a4a72b5b341522e` on `main`. Full `pnpm verify` passed before the final independent review. Review found and fixed SES sandbox pacing and an offboarding race. Pilot notification admission holds a fenced shared lease through authorization and send, then starts a cooldown; detail remains in logs while one pilot metric limits recurring cost. CI includes strict pilot synthesis. Current cost calculations and identity limitations are recorded in `pilot-infrastructure-review.md`. The independent reviewer reproduced the original latency gap, then verified its fix with 15 notification tests (18 paced sends across two households with variable authorization latency). Cognito provisioning uses the verified email for the email-only pool. Later deployment and Devpost milestones are recorded below; no household enrollment has occurred.

## Saved candidate and CI milestone — 2026-09-06

- Pilot implementation: `69680b5b2e53c2c8301e2b509f50fb8a54f4228d`.
- Final code revision, including interactive MFA verification: `b38cee99dec5e38b0625ac31d61eff2bc69ea5a9`.
- Reviewed deployment and OAuth hardening revision: `4f87953922855535990c6e2cd3232092d577923e`.
- Final browser OAuth boundary revision: `e6af603f7c5538bb27e3de4ce282374f2045734f`.
- Final concurrent-session hardening revision: `d11f25ea76314e01479642cdcdb2dae90f9934d5`.
- Final explicit transport-isolation evidence revision: `af3180e08ef803c8805304a27d8e72beb3670bca`.
- [PR #3](https://github.com/AmirmLotfy/stay/pull/3) was initially saved as a draft on `codex/stay-recovery-pilot`; its later merge is recorded in the 2026-09-08 milestone below. No deployment occurred at this milestone.
- [CI 33991750541](https://github.com/AmirmLotfy/stay/actions/runs/33991750541) **passed** on the final code revision: generated contracts, format, lint, type checking, tests, coverage, media checks, build, strict demo and pilot synthesis, and **44 browser scenarios**.
- [CI 33993550879](https://github.com/AmirmLotfy/stay/actions/runs/33993550879) **passed** on the deployment/OAuth revision with the same full pipeline and **44 browser scenarios**. Local `pnpm verify`, strict pilot synthesis, `actionlint`, the 8-check local media verifier and all 44 browser scenarios also passed.
- [CI 33994247473](https://github.com/AmirmLotfy/stay/actions/runs/33994247473) **passed** on the final browser OAuth boundary revision: generated contracts, format, lint, type checking, tests, coverage, media checks, build, strict demo and pilot synthesis, and **44 browser scenarios**.
- [CI 34067220504](https://github.com/AmirmLotfy/stay/actions/runs/34067220504) **passed** on the concurrent-session hardening revision with the same full pipeline and **44 browser scenarios**. The browser now shares one Cognito refresh grant across concurrent household reads, preventing refresh-token rotation races. A service regression test also proves that broadcast removes an already-issued WebSocket connection after membership revocation and sends it no event. Local `pnpm verify`, strict pilot synthesis and all 44 browser scenarios passed; the functions package now has **86 passing tests**.
- [CI 34067605433](https://github.com/AmirmLotfy/stay/actions/runs/34067605433) **passed** on the final transport-isolation evidence revision with the complete pipeline and **44 browser scenarios**. Direct tests now prove signed MCP claims for another household cannot load data and an explicitly supplied WebSocket connection ID cannot receive another household's event. The functions package has **87 passing tests** and MCP has **12 passing tests**.
- The web and authenticated MCP verifier now bind OAuth responses to a nonce and verify Cognito's RS256 signature, issuer, audience, token use and expiry against the issuer JWKS. The fallback site's Content Security Policy explicitly permits the exact managed-login and regional issuer origins needed for token exchange and key retrieval. The pilot template omits the legacy shared email destination and a duplicate OIDC/deployment role, and emits an unattached least-privilege operator policy. The manual workflow always generates an exact change-set diff and only deploys a confirmed 40-character `main` revision.
- Final strict `pnpm verify:submission`: **15 passed, 0 pending, 0 failed**. This is packet/link verification, not a final Devpost submission or full human playback review.
- Final independent fix review: sender lease held through variable-latency authorization/dispatch with fenced release and cooldown; 15 notification tests passed. Offboarding's post-closure incident recheck prevents falsely reporting completed handoff.
- Local final functions: **85 passed**; type checking, lint, build, coverage and strict pilot synthesis passed. Read-only pilot diff creates one stack.
- A documentation-only follow-up records these results; it does not change the tested implementation.

Resume commands: `git status --short`, `git log -3 --oneline`, `gh pr view 8`, `gh run view 34164700108`, `gh run view 34164714532`, then read this checkpoint. Do not rerun or deploy the judge stack to resume the pilot.

Devpost submission and pilot deployment authorization are complete. The only local AWS profile remains root-backed and must not be used for pilot mutations. Pilot diff and deployment run through the existing main-branch GitHub OIDC role. Actual participant consent and verified household identities are still required before enrollment. After deployment, complete live authenticated isolation/MCP/WS, inbox/feedback/alert, restore/rollback and device accessibility checks. The seven-day and fourteen-day observation gates remain unchanged.

## Merge and pilot diff milestone — 2026-09-08

- [PR #3](https://github.com/AmirmLotfy/stay/pull/3) was approved and merged as `474cdf102e66aa763cba90400a4a72b5b341522e`. [Main CI 34068187568](https://github.com/AmirmLotfy/stay/actions/runs/34068187568) passed the full pipeline and all 44 browser scenarios.
- The approved diff-only [pilot workflow 34068703180](https://github.com/AmirmLotfy/stay/actions/runs/34068703180) verified the exact main source and immutable GitHub OIDC claims, passed full verification and strict pilot synthesis, assumed the scoped non-root deployment role, and validated the private parameters. It did not deploy the pilot stack.
- That run failed before change-set creation because the pinned CDK CLI does not accept `--parameters` on `cdk diff`; it ignored them and CloudFormation reported missing `AlertEmail`, `SesFromEmail` and `ExistingHostedZoneId`. This matches the limitation already recorded in `deployment-runbook.md` and `friction-log.md`.
- The workflow correction prints a parameter-independent template diff, prepares a non-executed CloudFormation change set with `cdk deploy --method prepare-change-set`, binds its name to the full main SHA, and records only safe resource changes. A future deploy run must recheck and execute that stored change set. No pilot resources or household data have been created.
- [Pilot workflow 34164130583](https://github.com/AmirmLotfy/stay/actions/runs/34164130583) passed full verification, strict pilot synthesis, scoped OIDC, parameter validation and template diff, then successfully prepared the non-executed change set for `b01349b1e7d71cd99e496f52111aa37a66c5adf7`. Its metadata guard failed because `describe-change-set` does not return the requested `ChangeSetType` field. Deployment and output-verification steps were skipped. The guard correction relies on the returned completion and execution statuses plus the resource changes.
- [PR #7](https://github.com/AmirmLotfy/stay/pull/7) passed the complete CI pipeline with 44 browser scenarios and merged as `1adafd50519dba6d595832d3b136dfd7bb49d086`; [main CI 34164700108](https://github.com/AmirmLotfy/stay/actions/runs/34164700108) passed on that exact revision.
- The final approved diff-only [pilot workflow 34164714532](https://github.com/AmirmLotfy/stay/actions/runs/34164714532) succeeded. It recorded template SHA-256 `8168d9d19b49d5bd01bc425fae830b666294c13437bed52717c8f080efe36354` and prepared `stay-pilot-review-1adafd50519dba6d595832d3b136dfd7bb49d086` with `CREATE_COMPLETE` / `AVAILABLE` status. The exact change set contains **150 additions, zero modifications and zero removals**. CloudFront, active Bedrock IAM, a new hosted zone and a new GitHub OIDC provider are absent; the single template-only `BedrockInvokePolicy` is omitted by the false `BedrockEnabled` condition. Deployment and post-deployment output checks were skipped. The separate deployment action remains unauthorized.
- Fresh deployed-browser revalidation on 2026-09-08: `STAY_E2E_BASE_URL=https://saystay.site pnpm test:e2e --workers=1` completed with **36 passed and 8 skipped in 5.3 minutes**. Four pilot-onboarding viewport cases skipped because the pilot is undeployed; four route-mocked runtime-config cases skipped because they are deliberately local-only. This verifies every applicable judge-demo scenario but does not test the undeployed pilot.
- Fresh media decode on 2026-09-08: master and upload SHA-256 both `63354dc8a1a25809bb530aed28d417279c941da97817636cf3a825b00814f00c` and `cmp` confirmed byte identity. FFmpeg decoded all 170 seconds of 1920×1080 H.264 High video and 48 kHz stereo AAC-LC audio without errors. Audio measured −14.6 LUFS integrated, 3.4 LU range and −0.9 dBFS true peak; the only ≥1-second near-silence was the 1.94-second closing tail. The SRT converted to 36 WebVTT packets with no malformed or overlapping cues and ends at 169.8 seconds. A 17-frame contact sheet showed the intended title, product-flow, architecture and closing sequence. This technical pass does not replace the participant's full human playback review.
- Fresh public caption/playback check on 2026-09-08: the YouTube player settings list manual **English** and **English (auto-generated)** as separate tracks, with manual English selected. The approved opening cue, `[Soft felt-piano and marimba music]`, renders visibly. An uninterrupted public-player pass advanced from 0:00 to 2:50, with synchronized manual-caption text visible at 1:01 and 2:01; YouTube then advanced normally to autoplay. YouTube's CC checkbox retains an incorrect “unavailable” accessibility description even while its value is on and the manual track is displayed. This establishes public stream and caption continuity but does not replace the participant's sound/content review.
- Fresh requirement-audit validation on 2026-09-08: `pnpm exec turbo run test --force` completed **18/18 tasks with zero cached**, including 87 function, 40 domain, 13 web-unit, 12 MCP and 5 infrastructure tests. Generated OpenAPI/client output produced no drift. Focused pilot suites passed 38 function tests and 12 MCP tests, and `playwright test tests/e2e/pilot.spec.ts --workers=1` passed all four desktop/mobile/Echo pilot viewports. The resulting plan-to-evidence map is `PROJECT_COMPLETION_MATRIX.md`.

## First pilot deployment attempt — 2026-09-08

- The participant authorized execution of the exact reviewed pilot change set and completion of the Devpost workflow. [Pilot deployment run 34173765635](https://github.com/AmirmLotfy/stay/actions/runs/34173765635) bound itself to `main` commit `1adafd50519dba6d595832d3b136dfd7bb49d086`, passed source/OIDC/verification/synthesis/parameter/change-set checks, and executed the stored change set.
- AWS Lambda rejected `stay-pilot-notification` because this account has a ten-execution regional concurrency quota and any reserved concurrency would violate Lambda's required ten unreserved executions. CloudFormation entered rollback before a usable pilot existed. The pilot template now leaves function concurrency unreserved and retains the SQS event source's `MaximumConcurrency: 2` delivery bound. The infrastructure test asserts that account-incompatible reserved concurrency is absent.
- Rollback stopped at `ROLLBACK_FAILED` because the new Cognito pool had deletion protection and the generated versioned website bucket contained deployment objects. The failed pool contains zero users and no household was provisioned. A narrowly guarded workflow recovery operation verifies this exact failed status and the two exact `DELETE_FAILED` logical resources, assumes the non-root CDK deployment role, disables stack termination protection, and removes only the failed stack while retaining those two resources for controlled cleanup. It cannot run from any branch or revision other than the exact supplied `main` commit.
- Local `pnpm verify`, strict pilot synthesis and the focused infrastructure suite passed after the concurrency and recovery changes. No judge-demo resource was modified. A new reviewed diff and deployment are required after the correction reaches `main`.
- The first guarded recovery run `34175544461` correctly assumed the non-root bootstrap deployment role and disabled termination protection, but CloudFormation rejected `--retain-resources` while the stack was still `ROLLBACK_FAILED`; that option is accepted only after a delete reaches `DELETE_FAILED`. The recovery step now performs and verifies the expected first failed delete, asserts `DELETE_FAILED`, then retries while retaining only the two previously verified resources.
- The second guarded recovery run `34176284595` passed source, verification, synthesis, OIDC and role-chaining checks. Its first explicit stack deletion succeeded because the retained resources' template policies applied; the workflow incorrectly treated that valid outcome as a failure. Read-only AWS inspection then proved `StayPilotStack` no longer exists, while the zero-user pool `us-east-1_0Z5OxpCpg` and generated bucket `staypilotstack-websitebucket75c24d94-im6ng8ngwmep` remain retained for separate controlled cleanup. The recovery workflow now accepts either successful first deletion or the guarded `DELETE_FAILED` retry path and is idempotent when no failed stack remains.
- Main CI `34176261190` passed on recovery revision `a1a29f7ae2e6c4d198a2065357e08d0b1a278c90`. A fresh main-bound pilot diff and deployment are required after this recovery correction is merged.

## Pilot retry name-collision correction — 2026-09-08

- [PR #10](https://github.com/AmirmLotfy/stay/pull/10) merged the submission-cover assets and recovery-workflow correction as `6c226d46bf006bb4eb2c5d7ee5fc33e97c079bd7`; its full [CI run 34178189852](https://github.com/AmirmLotfy/stay/actions/runs/34178189852) passed, including all 44 browser scenarios.
- Fresh exact-main review [34178504420](https://github.com/AmirmLotfy/stay/actions/runs/34178504420) passed full verification, strict pilot synthesis, OIDC, parameter validation and the template diff. CloudFormation then rejected non-executed change-set preparation because the retained empty log group `/aws/lambda/stay-pilot-identity-claims` already owns an explicit physical name from the removed stack. No change set or deployment was executed.
- The retry candidate omits explicit physical names from all pilot log groups, allowing CloudFormation to create stack-unique names after a failed-create recovery. Demo log-group names remain unchanged. The pilot KMS key policy allows only the `StayPilotStack-*` log-group namespace. Infrastructure tests, type checking and strict pilot synthesis pass; the synthesized template contains eleven encrypted auto-named log groups.
- The user's standing action policy is **Always Confirm at Action-Time**. A successful exact-main review may proceed without a public mutation, but executing the pilot change set and saving either public cover replacement require fresh confirmation immediately before the action.
