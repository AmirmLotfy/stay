# STAY — Devpost submission draft

> Draft only. Do not submit until the dedicated final confirmation and live evidence gates pass.

## Tagline

Help that keeps you at home, connected, and in control.

## Inspiration

Independent living is often lost in the space between “everything is fine” and “this is an emergency”: a missed check-in, a small household problem, or a favor nobody clearly owns. STAY gives a resident one calm place to manage that middle ground with people they already trust.

## What it does

STAY combines an accessible resident home, a scoped Circle coordination space, deterministic Safety Windows, ordinary Help Requests, house playbooks, incident ownership, and privacy-controlled House Memory. The centerpiece is a missed Morning Window: two deterministic checks happen before Sarah’s saved plan activates; Sarah asks nearby helper Tom; Tom accepts; everyone sees “Tom is on the way.”

STAY does not contact emergency services, diagnose conditions, detect falls, or replace Alexa Emergency Assist. It coordinates only the resident’s preconfigured Circle. Weather, utility, device, maintenance, and travel estimates are visibly simulated.

## How we built it

The public Alexa+ route is a self-hosted Streamable HTTP MCP server plus a polished web simulator. Ten goal-level tools return accessible text, typed structured content, provenance, and hashed widget resources. Cognito OAuth metadata and scopes are prepared for account linking.

The safety plane is deterministic TypeScript. Versioned DynamoDB transactions update aggregates and append outbox events; Streams publish to EventBridge; idempotent consumers update WebSockets, minimal SES email, metrics, and DLQs. EventBridge Scheduler carries expected versions so duplicate or stale checks are no-ops.

Strands with Amazon Bedrock/Nova is limited to redacted intent interpretation and concise explanations. The application validates and executes every command. If Bedrock is unavailable, Safety Windows, Circle coordination, scheduler transitions, and touch forms continue to work.

## Challenges

- Supporting both the hackathon’s MCP requirement and Alexa’s currently documented legacy initialization without duplicating tool definitions.
- Treating unreliable delivery, duplicate events, and concurrent responders as core domain behavior rather than demo exceptions.
- Creating an interface that feels like a quiet home tool rather than a monitoring dashboard.
- Preserving a truthful boundary between implemented core workflows and simulated provider edges.

## Accomplishments

- Complete touch-only and voice-simulator protected flow with no model dependency.
- Optimistic concurrency, idempotency, append-only timelines, privacy invariants, reconnect reconciliation, and provider provenance.
- Resident/Circle surfaces, all planned playbook types, accessibility preferences, and isolated public demo sessions.
- Reproducible Node 22/pnpm monorepo, strict contracts, OpenAPI/client generation, tests, CDK, cdk-nag, and open-source documentation.

## What we learned

[Summarize the strongest friction-log observations after the deployed release candidate is verified.]

## What’s next

If Alexa+ partner access arrives, add live account linking, Local Inspector, and device testing without changing domain contracts. Production follow-up includes manual assistive-technology testing, CloudFront WAF, live provider qualification, SES production access, operational game days, and household research.

## Built with

Alexa+, MCP, TypeScript, React, Next.js, AWS CDK, Amazon Cognito, AWS Lambda, Amazon DynamoDB, Amazon EventBridge, Amazon SQS, Amazon SES, Amazon CloudFront, Amazon S3, AWS KMS, Amazon CloudWatch, AWS X-Ray, Amazon Bedrock, Amazon Nova, Strands Agents SDK, Zod, Vitest, Playwright, axe.

## Links

- Source: https://github.com/AmirmLotfy/stay
- Demo: `[DEPLOYED_URL]`
- Video: `[PUBLIC_ENGLISH_VIDEO_UNDER_3_MINUTES]`

## Tracks

- Primary: Alexa+
- Mini-challenges: AWS Builder, Open Source
