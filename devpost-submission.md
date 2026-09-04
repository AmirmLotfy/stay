# STAY — Devpost submission copy pack

> Draft only. Nothing has been sent to Devpost. Live project `stay-ljbdk8` remains a draft. The deployment and public video fields are final. Private participant assertions are stored locally in the ignored `devpost-private-answers.md` handoff.

Official requirements were rechecked live through Devpost on 2026-09-03 Cairo time against the [hackathon overview](https://amazonappdev2026.devpost.com/), [resources](https://amazonappdev2026.devpost.com/resources), and [official rules](https://amazonappdev2026.devpost.com/rules). The deadline is October 23, 2026 at 12:00 PM Pacific Time / 19:00 UTC / 22:00 Cairo. Keep the repository, video, and free judge demo available through the judging period ending November 20, 2026 at 12:00 PM Pacific Time.

## Project fields

### Title

STAY

### One-line Summary / Tagline

Help that keeps you at home, connected, and in control.

### Built with

Alexa+, MCP, TypeScript, React, Next.js, Amazon Cognito, AWS Lambda, Amazon DynamoDB, Amazon EventBridge, Amazon EventBridge Scheduler, Amazon SQS, Amazon SES, Amazon CloudFront, Amazon S3, AWS KMS, Amazon CloudWatch, AWS X-Ray, Amazon Bedrock, Amazon Nova, Strands Agents SDK, AWS CDK, Zod, Vitest, Playwright, axe

### Public Repository Link

https://github.com/AmirmLotfy/stay

### Public Demo Link

https://saystay.site

### Demo Video

https://youtu.be/oCoXdCRVyMo

Required format: public English YouTube or Vimeo video, under three minutes. The public page was verified signed out on 2026-09-04: playable, embeddable, 170 seconds, and 1080p available. The upload uses the approved Higgsfield voice/music and the verified public demo URL. Before submission, replace YouTube's current auto-caption transcript with the packaged 36-cue English SRT.

## Problem

Independent living is often lost in the space between “everything is fine” and an emergency: a missed check-in, a small household problem, or a favor nobody clearly owns. Existing safety products can turn a resident’s life into monitoring, while ordinary home tools rarely coordinate the people a resident already trusts.

## Solution

STAY gives an older adult one calm, accessible home for that middle ground. It combines a focused daily view, adaptive access preferences, resident-defined Safety Windows, ordinary Help Requests, household playbooks, a trusted Circle, privacy-filtered House Memory, and incident ownership.

The protected demonstration is deliberately deterministic: Sarah misses two Morning Safety Window checks; her saved plan opens Circle coordination; Sarah asks nearby helper Tom; Tom accepts; and every surface shows **“Tom is on the way.”** Bedrock does not decide the escalation order, disclose protected details, or close the incident.

STAY never claims to contact emergency services, diagnose a condition, detect a fall, or replace Alexa Emergency Assist. Weather, utility, device, maintenance, Ring, Smart Properties, and travel observations are visibly labeled simulations.

## Why This Matters

Independence is sustained by small, reliable acts: remembering one task, knowing that a path is lit, asking for ordinary help early, and making sure one trusted person owns a response. STAY supports those acts without continuous tracking or opaque automated escalation. The resident chooses the Circle, the order, and the disclosure boundary; the system makes that plan dependable.

## Judging Alignment

- **Tech Implementation:** the public repository contains the working MCP SDK import and Streamable HTTP entrypoint, deterministic state machines, generated REST/OpenAPI contracts, DynamoDB transaction/outbox persistence, Strands/Nova intent boundary, deployable CDK, and executable tests—not README-only integration claims.
- **Design:** one warm, coherent interaction system serves resident, Circle, and simulated Alexa+ surfaces with 48 px targets, adaptive access preferences, keyboard/touch coverage, reduced motion, and explicit provenance instead of a generic chatbot shell.
- **Potential Impact:** STAY addresses the common middle ground between an ordinary day and an emergency while preserving resident choice, privacy, response ownership, and graceful operation when AI or providers fail.
- **Quality of the Idea:** resident-authored Safety Windows and deterministic Circle coordination turn Alexa+ and MCP into a practical independent-living workflow rather than a prompt wrapper or opaque monitoring product.

## How We Used AI

STAY uses AI only in its optional convenience plane. The Strands agent and Amazon Bedrock Converse integration are implemented for the exact Nova Micro profile in `us-east-1`, but the deployed account currently reports `NOT_AUTHORIZED`, so the live AI feature gate is off. When authorized, it interprets only a short redacted intent envelope and produces concise, non-critical guidance. Contact details, addresses, access instructions, location, and unrestricted House Memory are excluded. Every model-produced argument is schema-validated, and the deterministic application—not the model—executes commands.

There is no silent model fallback. If Bedrock is unavailable, Safety Windows, scheduled checks, Help Requests, Circle assignment, touch forms, privacy controls, and incident state machines continue to work. The submitted Alexa+ route is a self-hosted Streamable HTTP MCP server plus a web simulator; ten goal-level tools return accessible text, typed structured content, provenance, and hashed widget resources.

## How We Used Codex

Codex was the implementation partner across the monorepo: translating the product brief into strict domain contracts, building and testing state machines, generating OpenAPI and client types, wiring the MCP server and AWS entrypoints, authoring CDK, and running local and public-CI verification. It also helped inspect rendered layouts at desktop, mobile, Echo Show 8, and Echo Show 15 sizes; remove inert controls and generic AI-dashboard motifs; strengthen safety copy; and maintain separate evidence for local, CI, AWS, Alexa-device, and simulated-provider claims.

The build process used short evidence loops: implement one vertical slice, run strict types and focused tests, exercise the rendered workflow, then run format, lint, unit/contract, production build, Playwright/axe, and strict CDK synth gates. Provider actions remained behind explicit approval gates.

## Key Features

- **HOME:** One Thing Mode, home check, path lighting, calendar context, ordinary Help Requests, and House Memory.
- **ACCESS:** voice-first, touch-first, captions, extra response time, repeated information, high legibility, contrast, reduced load, and reduced motion.
- **WINDOWS:** resident-created templates, two deterministic checks, grace periods, early closure, cancellation, resolution, versioned scheduling, and an audit trail.
- **CIRCLE:** scoped roles, priorities, availability, acceptance/decline, response ownership, incident-limited protected details, Help Board, and privacy settings.
- **PLAYBOOKS:** Power Outage, Water Leak, Extreme Heat, Severe Weather, and resident-authored offline plans, with every provider visibly marked live, simulated, or unavailable.
- **INCIDENTS:** activation, verification, assignment, response, escalation, resolution, and an append-only timeline.
- **ALEXA+ MCP:** ten goal-level tools over Streamable HTTP MCP `2025-11-25`, with a legacy initialization compatibility path and accessible widget resources.
- **PUBLIC DEMO:** four-hour browser- or DynamoDB-scoped synthetic sessions that cannot address authenticated household partitions.

## Architecture

The safety plane is deterministic TypeScript. Every write requires an idempotency key and expected version. A DynamoDB transaction updates the aggregate, reserves the idempotency key, and appends an outbox event. DynamoDB Streams publish to a dedicated EventBridge bus; SQS-backed consumers deliver WebSocket hints, minimal SES email, and metrics with DLQs. WebSocket clients reconcile through REST after reconnect.

EventBridge Scheduler creates named one-time open, first-check, and grace-expiry invocations carrying the expected aggregate version. A resident check-in, cancellation, duplicate delivery, delayed delivery, or retry therefore becomes a logged no-op when no longer current.

Cognito uses authorization code plus PKCE for the public PWA client, a confidential account-linking client, token revocation, refresh rotation, and no identity pool. The public demo currently uses API Gateway plus a Lambda reader over a private KMS-encrypted S3 bucket because AWS has not yet cleared this account for CloudFront distribution creation; the CloudFront/private-S3 upgrade remains prepared in CDK. DynamoDB uses KMS, PITR, TTL, on-demand capacity, and Streams. Lambda uses Node 22, ARM64, X-Ray, structured logs, bounded timeouts, and adaptive AWS SDK retries. CloudWatch alarms and a $25 alert-only budget surface failures.

## Testing Instructions

Requirements: Node 22, Corepack, pnpm 11, and Chromium.

```bash
git clone https://github.com/AmirmLotfy/stay.git
cd stay
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @stay/web dev
```

Open `http://localhost:3000`, then run the protected flow:

1. Select **Miss the first check**.
2. Select **Miss the second check**.
3. Select **Sarah asks Tom**.
4. Select **Tom accepts**.
5. Confirm **“Tom is on the way.”** and resolve the incident.

Or use the deployed isolated judge demo without an account:

https://saystay.site

Run the verification gates:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm cdk:synth
```

Public CI evidence for release commit `3385296`: https://github.com/AmirmLotfy/stay/actions/runs/33832437130 — generated-contract drift, format, lint, strict typecheck, unit/contract tests, monorepo coverage, production builds, strict CDK synthesis, and all 36 Playwright scenarios passed.

## Screenshot Shot List

1. `assets/submission/screenshots/01-home-desktop.png` — Today, One Thing, home status, calendar, and simulator.
2. `assets/submission/screenshots/02-access-desktop.png` — adaptive access preferences.
3. `assets/submission/screenshots/03-privacy-desktop.png` — resident-controlled sharing boundaries.
4. `assets/submission/screenshots/04-tom-on-the-way-desktop.png` — protected hero moment and response ownership.
5. `assets/submission/screenshots/05-emergency-boundary-desktop.png` — explicit supplementary-service boundary.
6. `assets/submission/screenshots/06-home-mobile.png` — responsive resident home.
7. `assets/submission/screenshots/07-mobile-updates.png` — functional mobile Updates panel.

Recommended Devpost gallery order: 04, 01, 02, 03, 07, 05, 06.

## Demo Video Outline

- **0:00–0:28:** ordinary day, One Thing, home check, calendar, simulated labels.
- **0:28–0:54:** adaptive access and privacy.
- **0:54–2:00:** two missed checks → Sarah asks Tom → Tom accepts → “Tom is on the way.”
- **2:00–2:35:** Help Board, playbooks, House Memory, and Alexa+ simulator.
- **2:35–2:48:** MCP/AWS architecture and public CI proof.
- **2:48–2:50:** close: stay at home, connected, and in control.

## Challenges and What We Learned

The hardest problem was not generating language; it was making safety coordination coherent under duplicates, stale schedules, concurrent responders, disconnected clients, expired tokens, and unavailable providers. That led to a strict separation between deterministic safety policy and generative intent interpretation.

Alexa+ partner access is not generally available, and current Alexa examples reference a legacy initialization path while the track requires MCP `2025-11-25` or later. STAY therefore registers tools once and serves both protocol eras, and it submits the explicitly permitted simulator path without representing it as device evidence.

We also learned that accessibility settings cannot be a cosmetic preference panel. They must change the actual interaction model while leaving safety policy invariant. The same protected flow is therefore tested touch-only, keyboard-first, and at desktop, mobile, Echo Show 8, and Echo Show 15 dimensions.

## Known Limitations

- Real Alexa+ add-on deployment, Local Inspector, account linking, and device tests require partner access and remain unavailable unless granted.
- Weather, outage, maintenance, Ring, Smart Properties, smart-home devices, and travel estimates are simulated adapters.
- STAY does not contact an emergency provider and is not a medical device or fall detector.
- Nova Micro is regionally available but the AWS account remains `NOT_AUTHORIZED`, so the optional Bedrock intent layer is disabled with no silent model fallback.
- SES is domain-authenticated for `STAY <updates@saystay.site>` with DKIM, custom MAIL FROM/SPF, and DMARC. SES accepted the live sender test; the requested production-access details were sent, but the SES API still reports a denied review and the account remains in the sandbox.
- CloudFront creation is account-provider blocked; the judge demo uses the deployed API Gateway/private-S3 fallback while AWS Support reviews account-verification case `178838741100092`.
- Manual screen-reader and physical-device testing remain release gates; automated axe checks are not presented as full assistive-technology certification.
- Arabic content, payments, native mobile apps, biometrics, and real provider onboarding are outside this release.

## Official Form Fields — Copy Pack

Official requirements fetched live from Devpost on 2026-09-03 Cairo time. Private participant assertions must be copied from the ignored local handoff and truthfully rechecked in the final form.

### 28285 — Submitter Type

`[PRIVATE ANSWER — see devpost-private-answers.md]`

### 28286 — Organization Name (if applicable)

`[PRIVATE ANSWER — see devpost-private-answers.md]`

### 28287 — Submitter Country of Residence

`[PRIVATE ANSWER — see devpost-private-answers.md]`

### 28288 — Canadian province

`[PRIVATE ANSWER — see devpost-private-answers.md]`

### 28289 — Primary Track(s)

Alexa+

### 28290 — Public code repository

https://github.com/AmirmLotfy/stay

### 28291 — New or existing before August 31, 2026

New

Evidence: the public repository was created on 2026-09-01T23:30:20Z and its first commit is dated 2026-09-02T02:30:08+03:00.

### 28292 — Existing-project updates

N/A — STAY is a new project created during the submission period.

### 28293 — AWS Builder Mini Challenge

Yes

### 28294 — AWS services and how they were incorporated

The deployed stack uses Amazon Cognito for OAuth authorization code plus PKCE, scoped JWTs, revocation, and account-linking contracts. AWS Lambda runs REST, MCP, scheduler, stream-publisher, notification, metrics, static-site, and WebSocket handlers. Amazon DynamoDB stores versioned aggregates, TTL-scoped demo/idempotency/confirmation records, independent incident timelines, and a transactional outbox with Streams. Amazon EventBridge Scheduler performs expected-version one-time Safety Window transitions; DynamoDB Streams publish domain events to EventBridge; SQS-backed consumers and DLQs isolate email and metric delivery. Amazon SES is domain-authenticated with Easy DKIM 2048, custom MAIL FROM/SPF, and DMARC and sends minimal mail as `STAY <updates@saystay.site>`; the requested production-access details were sent, but the API still reports a denied review and sandbox-limited delivery. API Gateway provides HTTP and WebSocket APIs and currently serves the PWA through a Lambda reader over private encrypted S3 because CloudFront is account-provider blocked; AWS Support case `178838741100092` carries the account-verification request and exact failure evidence. AWS KMS, Route 53, CloudWatch, X-Ray, Secrets Manager, Budgets, and CDK/cdk-nag provide DNS, encryption, observability, confidential-client storage, cost alerts, and repeatable infrastructure. The Strands Agents SDK plus Amazon Bedrock Converse/Nova Micro integration is implemented for redacted, non-critical intent interpretation, but this account is `NOT_AUTHORIZED`, so the live AI gate remains off and the deterministic application handles every safety workflow. The $25 budget is alert-only, and simulated providers remain visibly labeled.

### 28295 — Open Source Mini Challenge

Yes

### 28296 — Contribution URL

https://github.com/AmirmLotfy/stay/commit/a2cdb02df7ae0e235a1a738f4fe31d93bbc5a762

### 28297 — Project Repository URL

https://github.com/AmirmLotfy/stay

### 28298 — GitHub Username

AmirmLotfy

### 28299 — Open-source contribution description

I created STAY as a new Apache-2.0 open-source project during the hackathon window. It provides a reusable deterministic TypeScript domain for resident-defined Safety Windows, ordinary Help Requests, privacy-scoped Circle coordination, incident ownership, House Memory, and offline playbooks; a standards-based Streamable HTTP MCP server with ten goal-level tools and accessible widget resources; an isolated Alexa+ web simulator; and a deployable AWS CDK stack. The repository includes all source, tests, generated OpenAPI/client contracts, accessibility and safety documentation, deployment instructions, media-production evidence, and public CI. It matters because independent-living coordination needs auditable, failure-tolerant primitives that remain useful when a model or provider is unavailable.

### 28300 — Optional Feature Requests

**Critical — Alexa+ developer access visibility:** provide a public account-level endpoint showing MCP Toolkit/add-on eligibility, requested status, and supported testing surfaces. This would prevent teams from planning device evidence they cannot obtain.

**Important — MCP compatibility matrix:** document which Alexa+ clients use current MCP `2025-11-25` Streamable HTTP initialization and which require legacy initialization/SSE behavior, with tested request/response examples.

**Important — Bedrock model-access preflight:** provide one CLI/API command that resolves the correct regional model or inference profile and performs a minimal non-logging Converse access check.

**Nice-to-have — local Alexa simulator fixtures:** publish accessible reference fixtures for screen sizes, captions, touch targets, and tool/widget response states.

### 28301 — Optional Friction Log

https://github.com/AmirmLotfy/stay/blob/main/docs/friction-log.md

### 28302 — Optional Project Testing Link

https://saystay.site

### 28303 — Feedback 1: tools, APIs, and SDKs used

I used the Model Context Protocol TypeScript SDK to implement ten Alexa+ goal-level tools over Streamable HTTP; the Strands Agents SDK with Amazon Bedrock Converse and Amazon Nova for redacted intent interpretation; AWS SDK for JavaScript v3 for DynamoDB, EventBridge Scheduler, EventBridge, SQS, SES, API Gateway Management API, Cognito-related verification, and Secrets Manager integrations; AWS CDK v2 and cdk-nag for infrastructure; Next.js 16 and React 19 for the PWA/simulator; Zod for domain, REST, MCP, and OpenAPI contracts; and Vitest, Playwright, and axe for deterministic, protocol, responsive, and accessibility testing.

### 28304 — Feedback 2: what worked well

The MCP SDK made it possible to register one typed tool catalog and serve current Streamable HTTP plus the required compatibility path without duplicating business logic. AWS SDK v3’s modular clients, explicit retry configuration, and typed service errors fit small Lambda handlers well. DynamoDB transactions plus Streams provided a strong foundation for aggregate versioning and the outbox pattern, while EventBridge Scheduler’s one-time schedules and delete-after-completion behavior mapped cleanly to Safety Windows. CDK made the HTTP API, WebSocket API, encrypted table, queues, bus, alarms, budget, and IAM relationships reviewable in one strict synth. Zod kept REST, MCP, generated OpenAPI, and client types aligned. Playwright projects made the same protected flow reproducible at desktop, mobile, Echo Show 8, and Echo Show 15 dimensions.

### 28305 — Feedback 3: what needs work

Alexa+ MCP Toolkit access is partner-limited, but the access state is difficult to verify programmatically; a public status endpoint and a simulator-first quickstart would make planning more reliable. Alexa documentation should provide an explicit compatibility table for the hackathon’s MCP `2025-11-25` requirement versus legacy initialization and SSE behavior. Bedrock model IDs and inference-profile access are region/account dependent, so a single official preflight command would reduce deployment drift. MCP SDK v2 documentation could more prominently explain when Streamable HTTP returns JSON versus SSE. CDK/cdk-nag’s granular finding IDs can contain `::`, which conflicts with the current acknowledgment API delimiter; structured finding identifiers would remove the workaround. Finally, SES sandbox and identity requirements should be surfaced earlier in serverless starter guidance.

### 28306 — Feedback 4: onboarding experience

The web and TypeScript foundations were fast: MCP schemas, Zod contracts, and AWS SDK v3 clients reached a local hello-world quickly. The slowest onboarding path was not writing code but reconciling account-specific access: Alexa+ partner availability, exact Bedrock model/profile access in `us-east-1`, and SES identity/sandbox state. CDK’s first synth was straightforward, but least-privilege IAM and cdk-nag acknowledgments required careful reading. A single Alexa+ simulator starter containing OAuth metadata, one MCP tool, one accessible widget, and a deployment/access checklist would materially shorten zero-to-demo time.

### 28307 — Feedback 5: build again?

Yes. MCP is a strong boundary for accessible, goal-level Alexa+ capabilities, and AWS services map well to the reliability needs of resident-defined coordination: DynamoDB transactions for coherent state, Scheduler for exact future checks, EventBridge/SQS for durable fan-out, Cognito for scoped identity, and Bedrock/Strands for a deliberately limited convenience layer. I would build with them again, but I would begin with the account-access and provider-limit preflight even earlier.

### 28308 — Age

`[PRIVATE ELIGIBILITY ANSWER — see devpost-private-answers.md]`

### 28309 — Eligible Jurisdiction

`[PRIVATE ELIGIBILITY ANSWER — see devpost-private-answers.md]`

### 28310 — Employee

`[PRIVATE ELIGIBILITY ANSWER — see devpost-private-answers.md]`

## Submission Readiness Notes

- **Live Devpost state:** authenticated and registered; project ID `1412726`, slug `stay-ljbdk8`, `state=submission_draft`, `published_at=null`, `submitted_at=null`, and project fields currently empty (verified 2026-09-03 Cairo time).
- **Official deadline:** 2026-10-23T19:00:00Z.
- **Optional AWS credit deadline:** registered individuals may use the [official credit request form](https://forms.gle/5hyhr1u6x3fuV2aW7) to request the advertised $150 AWS promotional credit by 2026-10-21 at 12:00 PM Pacific Time while supplies last; this is not required for submission and has not been requested.
- **Judging availability:** keep the public repository, public video, and free judge demo available without restriction through 2026-11-20T20:00:00Z.
- **Official deliverables:** video required; website and zip not required; public GitHub repository required by the event description.
- **Primary track:** Alexa+.
- **Mini challenges:** AWS Builder and Open Source.
- **Repository:** public; Apache-2.0 detected by GitHub; About panel links the live demo; release commit `3385296` has green CI with 36/36 Playwright scenarios.
- **Local product:** implemented and tested; provider edges are explicitly simulated.
- **Media evidence:** seven tracked screenshots recaptured from the public AWS demo, including the functional mobile Updates panel; a tracked 170-second 1080p picture master with the verified demo URL, English SRT, and SHA-256 manifest are present under `assets/submission/`.
- **AWS/public demo:** deployed and verified at `https://saystay.site`; both the custom domain and `https://s9y6tc7mfc.execute-api.us-east-1.amazonaws.com` passed 32/32 applicable live browser scenarios, and the hosting mode remains secure API Gateway/private-S3.
- **Video:** the finished 170-second H.264/AAC master is public at `https://youtu.be/oCoXdCRVyMo`; signed-out checks confirmed playback, embedding, 1080p, and duration. The identical source copy, 36-cue English SRT, and real-product thumbnail remain packaged. The SRT includes the measured narration plus accessible opening/closing music cues. The copyright-claim gate passed, but the current YouTube auto-caption transcript must be replaced with the packaged SRT and reviewed during private playback.
- **Higgsfield:** selected Recraft V4.1 logo, locked Faye Seed Audio narration, and Sonilo Music tonal bed were generated, reviewed, integrated, and provenance-locked. The recorded spend is 56.93 credits.
- **Participant assertions:** stored only in the ignored local handoff. The current values do not pass the official eligibility gate and must not be changed unless the user confirms they were mistakes and truthfully corrects them.
- **Final action:** do not submit without the dedicated final confirmation.
