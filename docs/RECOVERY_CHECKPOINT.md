# STAY recovery checkpoint

Updated: 2026-09-06. Resume here before making release claims.

## Baseline

- Recovered source: `4a7aa49240ecd8a69afe7bb35443aaa32fadd5bd`.
- Deployed implementation: `d569032`; deployment run `33886987014` succeeded.
- Public CI: `33933798929` on `503b56b`; 40 browser scenarios passed historically.
- Judge URL: https://saystay.site
- Video: https://youtu.be/oCoXdCRVyMo
- Repository: https://github.com/AmirmLotfy/stay
- Devpost: https://devpost.com/software/stay-ljbdk8 (last verified draft; final entry/submission is participant-owned).

## Accepted decisions

- Finish the hackathon packet, then prepare an invite-only pilot.
- The participant confirmed both negative age/jurisdiction answers were entry errors and authorized correcting the private handoff. Do not publish private answers.
- Pilot: five English-speaking adult households; owner-assisted invitations; web and email; owner operates support and alerts; $25/month AWS target, not a spending stop.
- Preserve the judge demo. Prepare separate pilot identity/data/queues and `pilot.saystay.site`.
- Keep AI, physical Alexa, home devices, payments, public signup and Arabic out of the pilot milestone.
- Deterministic code controls safety. STAY does not contact emergency services.

## Evidence and remaining gates

- Recovery audit: public site 200, unauthenticated MCP 401, OAuth metadata 200, YouTube embed 200, correct DNS; local media 8/8.
- AWS read-only identity succeeds but is root; scoped non-root deployment/operator credentials are required; demo stack is UPDATE_COMPLETE. SES remains sandbox with sending enabled, 200/day and 1/sec. Pilot stack does not exist.
- Approved YouTube captions are saved and visibly render in the public player. Full human audio/caption review remains pending. Devpost is DRAFT, 1/5 steps done under amirmolotfy; all 26 additional fields rechecked. Authenticated MCP and final participant entry/submission remain pending.
- Pilot implementation and fresh validation are in progress. No pilot deployment or household enrollment has occurred.
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

Current worktree contains the recovery and pilot candidate (not deployed). Real households load independent empty state; stored membership checks protect REST/MCP/WebSocket delivery; private contact/profile preferences use versioned contracts and request-bound replay keys. Operator commands prepare provision/invite/revoke/export/offboard/purge and pause enrollment. Neutral SES delivery rechecks membership and preferences, suppresses demo/opt-out/bounce/complaint recipients, retries explicit throttling and holds ambiguous sends for review. Scheduled checks use household-scoped immutable names, recover out-of-order transitions and atomically persist incidents. Pilot infra imports existing DNS/SES/OIDC while isolating identity, data and processing. See `pilot-runbook.md`, `pilot-infrastructure-review.md` and `pilot-design-evidence.md`.

Fresh evidence on 2026-09-05:

- Strict submission verifier: **15 passed, 0 pending, 0 failed**, no pending exceptions.
- Deployed judge browser suite: **36 passed, 4 local-only cases skipped**, installed Chrome, one worker, 11.8 minutes. This tests the existing deployment, not the new pilot.
- Local browser suite: **44 passed** (40 demo plus four viewport pilot contract scenarios). Following the final pilot retry/UI change, four pilot scenarios were rerun successfully; the final copy and skip-link styling also passed all four pilot scenarios.
- Fresh uncached monorepo test run: **18 tasks passed, 0 cached**. After independent review fixes, **85 function tests passed**, including concurrent two-household email pacing and an incident racing with offboarding. MCP: **11 tests passed**.
- Coverage command passed without lowering thresholds. New provider-command and SES SDK branches remain partly untested; local mocks do not prove cloud delivery.
- Strict demo and pilot synthesis passed; read-only pilot diff showed one new stack. The final scheduler DLQ additions passed the synth/diff rerun. Subsequent email pacing, bounded pilot metrics and Cognito provisioning changes passed focused tests, type checking and lint; the final build/synthesis and GitHub CI passed as recorded below.
- Read-only AWS cost query September 1–5 returned effectively $0 unblended account cost; this may reflect credits/reporting lag and is not a pilot forecast.
- No registered users were returned by the current demo Cognito pool. Fresh authenticated MCP verification needs a reviewed synthetic test identity or valid supplied credentials; the script now verifies initialize, list and read-only call.

External gates still open: full human video review; participant Devpost entry/final submission; approved pilot deployment/cost; controlled inbox/feedback/alert tests; restore and rollback rehearsal; real-device accessibility; actual participant consent/identities; seven-day then fourteen-day observations. Do not mark the whole completion plan achieved from this checkpoint.

Candidate branch: `codex/stay-recovery-pilot`. Full `pnpm verify` passed before the final independent review. Review found and fixed SES sandbox pacing and an offboarding race. Pilot notification admission holds a fenced shared lease through authorization and send, then starts a cooldown; detail remains in logs while one pilot metric limits recurring cost. CI now includes strict pilot synthesis. Current cost calculations and identity limitations are recorded in `pilot-infrastructure-review.md`. The independent reviewer reproduced the original latency gap, then verified its fix with 15 notification tests (18 paced sends across two households with variable authorization latency). Cognito provisioning now uses the verified email for the email-only pool. No deployment, final Devpost submission, or household enrollment has occurred.

## Saved candidate and CI milestone — 2026-09-06

- Pilot implementation: `69680b5b2e53c2c8301e2b509f50fb8a54f4228d`.
- Final code revision, including interactive MFA verification: `b38cee99dec5e38b0625ac31d61eff2bc69ea5a9`.
- [Draft PR #3](https://github.com/AmirmLotfy/stay/pull/3) is pushed on `codex/stay-recovery-pilot`; no merge or deployment occurred.
- [CI 33991750541](https://github.com/AmirmLotfy/stay/actions/runs/33991750541) **passed** on the final code revision: generated contracts, format, lint, type checking, tests, coverage, media checks, build, strict demo and pilot synthesis, and **44 browser scenarios**.
- Final strict `pnpm verify:submission`: **15 passed, 0 pending, 0 failed**. This is packet/link verification, not a final Devpost submission or full human playback review.
- Final independent fix review: sender lease held through variable-latency authorization/dispatch with fenced release and cooldown; 15 notification tests passed. Offboarding's post-closure incident recheck prevents falsely reporting completed handoff.
- Local final functions: **85 passed**; type checking, lint, build, coverage and strict pilot synthesis passed. Read-only pilot diff creates one stack.
- A documentation-only follow-up records these results; it does not change the tested implementation.

Resume commands: `git status --short`, `git log -3 --oneline`, `gh pr view 3`, `gh run view 33991750541`, then read this checkpoint. Do not rerun or deploy the judge stack to resume the pilot.

Required user/provider inputs are pending: participant review/merge of draft PR #3, participant full video review and Devpost entry/submission, and actual pilot consent/verified identities. The only local AWS profile remains root-backed and must not be used for pilot operations. The candidate now supplies a pilot-only workflow that can perform the reviewed diff/deploy through the existing main-branch GitHub OIDC role after merge; the deploy action is still pending. After deployment, complete live authenticated isolation/MCP/WS, inbox/feedback/alert, restore/rollback and device accessibility checks before enrollment. The actual seven-day and fourteen-day observation gates remain unchanged.
