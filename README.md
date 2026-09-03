# STAY

**Adaptive Independent Living + Crisis Coordination for Alexa+**

[Try the public demo](https://saystay.site) · [Main CI](https://github.com/AmirmLotfy/stay/actions/workflows/ci.yml?query=branch%3Amain) · [Architecture](docs/architecture.md) · [Safety boundaries](docs/safety-boundaries.md)

STAY helps an older adult manage an ordinary day, ask a trusted Circle for help, and run a resident-defined response plan when a Safety Window is missed. The product is designed around one promise: useful coordination without taking control away from the resident.

The protected demonstration works entirely without a language model:

> Sarah misses two Morning Window checks → Sarah asks Tom → Tom accepts → **“Tom is on the way.”**

STAY never claims to contact emergency services, diagnose a condition, detect a fall, or replace Alexa Emergency Assist. Weather, outage, maintenance, Ring, Smart Properties, travel-time, and physical-device data are explicit simulations in this release.

## Current evidence

| Capability                                                        | Status                | Evidence boundary                                                                                                            |
| ----------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Resident/Circle PWA and Alexa-style simulator                     | Deployed              | [Public isolated demo](https://saystay.site); direct deployed desktop/mobile captures                                        |
| Deterministic Safety Window, help, incident, and playbook engines | Deployed and verified | Versioned API writes, outbox/EventBridge, WebSocket event, email delivery, metric marker, and zero DLQ backlog               |
| Streamable HTTP MCP server and ten tools                          | Deployed and verified | OAuth authorization code + PKCE and authenticated MCP `2025-11-25` initialize passed live                                    |
| Strands + Amazon Bedrock intent layer                             | Provider-limited      | Code is implemented; Nova Micro is available but this account is `NOT_AUTHORIZED`, so the live AI gate remains off           |
| AWS topology                                                      | Deployed              | `StayDemoStack` is `UPDATE_COMPLETE` in `us-east-1`; stack termination and stateful-resource deletion protection are enabled |
| SES delivery                                                      | Verified, sandboxed   | SES accepted an authenticated test from `STAY <updates@saystay.site>`; inbox confirmation is still required                  |
| Real Alexa+ device/add-on                                         | Unavailable           | Partner access is not assumed; the compliant web simulator is the guaranteed submission path                                 |
| Simulated edge providers                                          | Implemented           | Every observation includes mode, provider, timestamp, and reason                                                             |
| Payments                                                          | Not implemented       | Monetization is documentation-only                                                                                           |

See [release evidence](docs/release-evidence.md) for the checklist that prevents local or simulator results from being reported as cloud or device proof.

## Run locally

Requirements: Node 22, Corepack, pnpm 11, and a Chromium-compatible browser.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @stay/web dev
```

Open `http://localhost:3000`. Use **Miss the first check**, **Miss the second check**, **Sarah asks Tom**, and **Tom accepts** in the protected demo card.

The local fallback creates a four-hour browser-only session. When deployed, the same surface creates a four-hour DynamoDB-backed demo session, sends protected-flow writes through the isolated `/v1/demo/*` routes, hydrates after refresh, and reconnects WebSocket updates with REST reconciliation. Demo session IDs are validated before API and WebSocket access; they cannot address authenticated household partitions. The fixture contains no real personal data.

## Repository map

```text
apps/
  web/                 Resident, Circle, and Alexa+ simulator PWA
  alexa-widget/        Compact/fullscreen MCP widget bundle
packages/
  contracts/           Zod contracts, OpenAPI generation, client types
  domain/              Deterministic state machines, permissions, privacy
  adapters/            Simulated/unavailable edge provider interfaces
  design-system/       STAY color, typography, target, and motion tokens
  i18n/                English copy and RTL-ready direction helpers
  persistence/         DynamoDB aggregates, outbox, idempotency, confirmations
  test-fixtures/       Isolated Sarah/Tom fixtures
services/
  functions/           REST, scheduler, outbox, email, WebSocket entrypoints
  mcp-server/          OAuth-aware Streamable HTTP MCP server and widgets
  agent/               Strands/Nova intent interpreter with a hard feature gate
infrastructure/cdk/    StayDemoStack, cdk-nag, alarms, budget, and OIDC role
docs/                  Product, safety, security, runbook, and submission evidence
```

## Contracts and protocol

All REST routes are under `/v1`: `home`, `tasks`, `access`, `circle`, `safety-windows`, `help-requests`, `incidents`, `playbooks`, `privacy`, `house-memory`, `metrics`, and `demo-sessions`.

Writes require `Idempotency-Key` and optimistic `expectedVersion`. The repository transaction updates the aggregate, appends an outbox event, and reserves the idempotency key together. DynamoDB Streams publish outbox events to a dedicated EventBridge bus.

Creating a Safety Window prepares three named one-time EventBridge Scheduler invocations: open, first check, and second check after the configured grace period. Each payload carries the expected aggregate version; a check-in, cancellation, retry, duplicate, or delayed delivery therefore becomes a logged no-op when it is no longer current.

Generate OpenAPI and TypeScript client contracts with:

```bash
pnpm --filter @stay/contracts generate:openapi
```

The MCP endpoint defines these goal-level tools:

- `get_home_overview`
- `manage_task_session`
- `manage_safety_window`
- `request_help`
- `get_circle_availability`
- `manage_incident`
- `manage_house_memory`
- `execute_playbook`
- `manage_privacy`
- `perform_home_action`

Every result contains accessible text, typed `structuredContent`, provenance, and a hashed `ui://stay/...` widget URI. The official MCP SDK serves current protocol traffic and a stateless legacy 2025 path from the same registration factory so tool definitions cannot drift. In AWS, each tool request reconciles versioned state from DynamoDB and writes through the same aggregate/outbox/idempotency transaction as REST; local tests use a household-scoped in-memory substitute only.

## Bedrock boundary

The Strands agent interprets a short, redacted intent envelope only. It receives no contact details, address, access instructions, location, or unrestricted House Memory. It has no application tools and cannot execute actions. The deterministic application validates and executes commands.

There is no model fallback. If `BEDROCK_MODEL_ID` is absent, inaccessible, or in the wrong region, the AI feature is disabled and the tested workflows, scheduler, touch forms, and Circle coordination continue to operate.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm cdk:synth
```

Playwright covers 36 desktop, mobile, simulated Echo Show 8/15 scenarios: keyboard and skip navigation, touch-only protected flow, emergency copy, automated WCAG checks, 48 × 48 touch targets, adaptive Access preferences, system-aware persistent themes, RTL shell readiness, routine Help Board requests, resident Safety Window creation/check-in, responsive header and notification-panel behavior, and the deployed TTL-isolated API-session client. Additional manual screen-reader and real-device evidence remains a release gate.

## Public AWS demo

The current judge URL is:

https://saystay.site

The secure fallback serves the static PWA from a private KMS-encrypted S3 bucket through API Gateway and a Lambda reader because AWS has not yet verified this account for new CloudFront distributions. The CloudFront/private-S3 topology remains in CDK as a separately gated upgrade; no public S3 fallback is used.

The deployed MCP endpoint is `https://saystay.site/mcp`. Cognito Managed Login, the WebSocket API, DynamoDB/KMS/PITR/TTL/Streams, EventBridge/SQS consumers, authenticated SES delivery from `STAY <updates@saystay.site>`, logs, alarms, X-Ray, Secrets Manager, and the $25 monthly alert-only budget are deployed. AWS accepted the transactional SES production-access request and the requested follow-up in case `178838582000594`; the last verified API state remains `DENIED` with `ProductionAccessEnabled=false`, so the sandbox is still active while Support reviews the reply. Bedrock remains disabled until the exact Nova Micro profile passes a live Converse authorization check.

For a reviewed redeployment:

```bash
aws login
aws sts get-caller-identity
aws configure get region
pnpm build
pnpm cdk:synth
cd infrastructure/cdk
pnpm build
pnpm exec cdk diff StayDemoStack --strict -c enableCloudFront=false -c enableDeletionProtection=true --method template
```

The current CDK CLI evaluates parameters at deploy time, not during `cdk diff`. Review the
parameter values separately, then supply stack-qualified values to the reviewed deploy command in
the [deployment runbook](docs/deployment-runbook.md). Leave `BedrockModelId` empty unless the exact
Nova Micro profile passes the live invocation gate.

The purchased `saystay.site` domain is delegated to the existing Route 53 hosted zone through `ns-349.awsdns-43.com`, `ns-1914.awsdns-47.co.uk`, `ns-816.awsdns-38.net`, and `ns-1302.awsdns-34.org`. The deployed custom-domain update includes an ACM certificate, a regional API Gateway custom domain, DNS A/AAAA aliases, and Cognito callback/logout URLs. Keep those exact nameservers at the registrar; do not create a second hosted zone. If AWS later clears the CloudFront account gate, review the separate `enableCloudFront=true` upgrade.

The `$25` AWS Budget is alert-only; it does not stop spend. The Route 53 hosted zone has a recurring AWS charge even before the domain is activated.

Full steps: [deployment runbook](docs/deployment-runbook.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
