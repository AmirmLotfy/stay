# STAY

**Adaptive Independent Living + Crisis Coordination for Alexa+**

STAY helps an older adult manage an ordinary day, ask a trusted Circle for help, and run a resident-defined response plan when a Safety Window is missed. The product is designed around one promise: useful coordination without taking control away from the resident.

The protected demonstration works entirely without a language model:

> Sarah misses two Morning Window checks → Sarah asks Tom → Tom accepts → **“Tom is on the way.”**

STAY never claims to contact emergency services, diagnose a condition, detect a fall, or replace Alexa Emergency Assist. Weather, outage, maintenance, Ring, Smart Properties, travel-time, and physical-device data are explicit simulations in this release.

## Current evidence

| Capability                                                        | Status              | Evidence boundary                                                                            |
| ----------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| Resident/Circle PWA and Alexa-style simulator                     | Implemented locally | Static Next.js build; browser-only fallback plus deployed TTL-isolated API session client    |
| Deterministic Safety Window, help, incident, and playbook engines | Implemented locally | Unit and contract tests; no Bedrock dependency                                               |
| Streamable HTTP MCP server and ten tools                          | Implemented locally | MCP SDK protocol/origin tests, including `2025-11-25` negotiation                            |
| Strands + Amazon Bedrock intent layer                             | Feature-gated       | Code is implemented; exact `BEDROCK_MODEL_ID` and live access are not yet verified           |
| AWS topology                                                      | Prepared            | CDK synth/nag are local evidence only; no stack has been deployed from this checkout         |
| SES delivery                                                      | Prepared            | Requires a verified sender/recipient and live delivery proof                                 |
| Real Alexa+ device/add-on                                         | Unavailable         | Partner access is not assumed; the compliant web simulator is the guaranteed submission path |
| Simulated edge providers                                          | Implemented         | Every observation includes mode, provider, timestamp, and reason                             |
| Payments                                                          | Not implemented     | Monetization is documentation-only                                                           |

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

Every result contains accessible text, typed `structuredContent`, provenance, and a hashed `ui://stay/...` widget URI. The official MCP SDK serves current protocol traffic and a stateless legacy 2025 path from the same registration factory so tool definitions cannot drift.

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

Playwright covers 20 desktop, mobile, simulated Echo Show 8/15 scenarios: keyboard, touch-only protected flow, emergency copy, automated WCAG checks, adaptive Access preferences, routine Help Board requests, resident Safety Window check-in, and the deployed TTL-isolated API-session client. Additional manual screen-reader and real-device evidence remains a release gate.

## AWS deployment gate

No AWS resource should be created until the operator has reviewed the account, region, exact Bedrock model/profile, bootstrap state, tags, cost controls, and `cdk diff`.

```bash
aws login
aws sts get-caller-identity
aws configure get region
pnpm build
pnpm cdk:synth
pnpm cdk:diff -- --parameters AlertEmail=you@example.com --parameters SesFromEmail=verified@example.com --parameters SesRecipientEmail=approved@example.com
```

The `$25` AWS Budget is alert-only; it does not stop spend. Deployment requires a separate human review and is intentionally not performed by the build.

Full steps: [deployment runbook](docs/deployment-runbook.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
