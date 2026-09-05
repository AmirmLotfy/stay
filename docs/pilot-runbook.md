# STAY five-household pilot runbook

Status: implementation candidate; no pilot deployment or enrollment has occurred. Read `RECOVERY_CHECKPOINT.md` for current verification. The judge demo stays on its deployed revision until a separately reviewed release. Do not migrate its synthetic authenticated identities into a real pilot.

## Enrollment and consent

The operator assists five English-speaking adult households. Every participant must understand that STAY is supplementary coordination, not monitoring or an emergency service. Before creating an identity, record informed consent, its document version and timestamp, the chosen role, the resident's home time zone, and an individually SES-verified email. Confirm the household's response order, who will coordinate a missed check, and the independent arrangements they will use when STAY is unavailable. Do not collect diagnoses, access codes, or precise location in provisioning input.

Store private inputs, exports and the deletion ledger in an encrypted operator-controlled location outside Git. `pilot-private/` is ignored; permissions on exports/receipts are 0600. File permissions do not encrypt disks or backups. Share exports only with the authorized participant using the agreed private channel; do not attach them to issues or public CI artifacts.

`pnpm pilot:operator <operation> --input /absolute/private/input.json` validates without calling AWS. Add `--apply` only for the reviewed operation. Input requires `stack: "StayPilotStack"` and a non-demo `householdId`. Supported operations:

The pilot stack outputs `PilotOperatorPolicyArn` but does not attach it to any identity. An AWS administrator must attach that exact managed policy to a dedicated non-root operator role/user, configure the corresponding local profile, and verify `aws sts get-caller-identity --profile PROFILE` before any `--apply` command. The command itself rejects the root ARN and verifies the stable pilot stack outputs. The policy permits only this stack description, household-table operations, pilot-pool user lifecycle calls and read-only SES identity verification; it cannot deploy infrastructure or send arbitrary email.

| Operation          | Input and effect                                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resume` / `pause` | Explicit enrollment control; missing control defaults to paused. Pause prevents new provisioning/invites, not existing coordination.                                                                                                               |
| `provision`        | Version-1 active `profile` plus exactly one resident and Circle `people`; reserves one of five household slots, creates Cognito users with messages suppressed, then commits records atomically.                                                   |
| `invite`           | Additional nonresident `people` with distinct `memberId`; checks the active profile and enrollment control in the write transaction.                                                                                                               |
| `send-invitations` | Exact previously provisioned `people`; verifies their current membership, email and Cognito scope, then sends the reviewed Cognito invitation emails.                                                                                              |
| `revoke`           | Exact Cognito `subject`; disables membership, email/contact and Circle participation, then disables the Cognito user and signs out sessions. API/MCP/WS/email read authoritative membership on subsequent access.                                  |
| `deliveries`       | Lists only delivery identifiers/status/timestamps for this household.                                                                                                                                                                              |
| `export`           | `output` path must not exist. Creates a private JSON export including current household records and delivery/audit records.                                                                                                                        |
| `offboard`         | Requires resolved incident ownership; closes household, disables memberships and identities. Existing schedules become no-ops; enrollment count remains conservatively reserved.                                                                   |
| `purge`            | After offboarding: exact `confirmHouseholdId` and private receipt `output`. Removes active records and identities, retaining a nonpersonal closed tombstone and local deletion receipt. Re-running with the same receipt resumes interrupted work. |

The email-only Cognito pool uses each verified email as the create-user sign-in value; Cognito generates its internal username and subject. [Cognito create-user contract](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html).

Profile fields are defined in `packages/contracts/src/household.ts`; `people` input in `services/functions/src/pilot-operator.ts`. Consent cannot be future-dated. Circle emails belong only in private notification-contact records. They are never returned by Circle/MCP or placed in domain events.

Provisioning spans Cognito and DynamoDB and is not globally atomic. An interruption can leave suppressed Cognito users and a reserved capacity slot without a profile. Do not blindly retry or send invitations. Inspect exact users by verified sign-in email, compare all immutable household/resident/role attributes, and either complete the intended records with a reviewed recovery operation or remove only the confirmed orphan identities. Keep enrollment paused until reconciled. There is no automated capacity-release command.

## Delivery and incident operations

Pilot workers hold a persisted fenced sender lease through authorization and send, followed by a 1.1-second cooldown, across all households, with two concurrent event workers, one household event per batch, a 60-second worker timeout and six-minute queue visibility. Admission failure before dispatch is retryable; membership/preferences are rechecked after waiting. Unrelated SES senders can still consume the account quota and cause explicit throttling.

Messages contain a neutral household-update notice and sign-in link. Current active membership, contact verification, consent and suppression decide eligibility. All opted-in authorized household members receive this neutral update; addresses and incident details do not leave the private aggregate. Synthetic namespaces are suppressed. SES sandbox operation requires every actual recipient individually verified; production sending is a separate approval/provider gate.

Delivery markers distinguish `processing`, `sent` (SES accepted, not inbox proof), `retry` (explicit provider throttling), `unknown` and `suppressed`. A retry never repeats an accepted send. An interrupted/ambiguous send is held for operator review and eventually reaches the DLQ; it is not automatically resent. Before replaying an unknown attempt, inspect SES/provider evidence and contact the participant through the pre-agreed support channel. Record any authorized resend and its duplicate risk. STAY does not claim exactly-once email. Bounces and complaints disable the matching current address. Old-destination or repeated feedback is harmless.

Monitor API failures, scheduler errors, domain/notification/metrics DLQs and notification age alarms. Confirm the SNS subscription on the owner's existing verified destination and exercise it with a controlled test before onboarding. An alarm subscription existing in CloudFormation is not proof of delivered alerts. Check the queue, delivery state and incident timeline before replay; never delete a batch merely to clear an alarm.

A second scheduled check can catch up earlier delayed deliveries using stored deadlines. Checked-in, cancelled, resolved and already-escalating windows are terminal for scheduled processing. Concurrent writes retry through the queue/provider path and preserve optimistic versions. Offboarding checks incident ownership, closes the versioned profile, then checks again for an incident that committed during closure. If one appeared, access remains closed and the command reports incomplete; arrange external coordination and rerun with the exact `handedOffIncidentIds` recorded by the operator. Do not treat that error as completed offboarding or reopen access implicitly.

If a helper is revoked during an incident, the operator must contact the remaining authorized coordinator and arrange ownership; revocation must not wait for that handoff.

## Backup, deletion and restore rehearsal

DynamoDB PITR and retained encrypted resources protect recovery. Target RPO is five minutes and target RTO is four hours; neither is proven until the rehearsal. On-demand backups require an explicit retention/deletion record. [AWS documents PITR and restore behavior](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamodbDisasterRecoveryStrategy.html).

Before the first household, create a synthetic isolated pilot rehearsal household, record known versions/outbox state, restore to a new table, and keep the restored table disconnected from all Lambdas/streams/schedulers. Reapply the private offboarding/deletion ledger first: remove deleted households, close revoked memberships and suppress their contacts. Compare counts, aggregate versions, privacy settings and membership scopes. Replay tests must prove sent delivery markers do not cause repeat sends. Run REST/MCP/WS two-household isolation tests against the restored candidate, then record measured recovery time and destroy only the approved rehearsal resources after review.

Purging active records does not erase existing backups immediately. PITR history ages out within the configured retention window (up to 35 days); retained/manual snapshots need separately documented expiry. Never reconnect a restored table until the deletion ledger and revocations have been reapplied. Log groups contain identifiers and errors and retain one month; exported files, alarm mail and participant inbox copies need their own retention handling. Explain this to participants before enrollment.

## Deployment and rollback

Build the candidate and preserve its exact Git SHA. Select only `StayPilotStack`, import the existing parent hosted-zone ID, use `pilot.saystay.site`, and keep the CloudFront upgrade disabled. The pilot owns separate Cognito, DynamoDB/KMS, queues, schedules, SES configuration and Lambdas. It shares the existing verified SES domain and Route53 parent zone. The DNS aliases explicitly target `pilot.saystay.site`; never change judge apex records.

```sh
pnpm build
pnpm --filter @stay/infra exec cdk synth --strict --quiet -c stage=pilot -c enableCloudFront=false -c enableCustomDomain=true
pnpm --filter @stay/infra exec cdk diff --strict --no-change-set -c stage=pilot -c enableCloudFront=false -c enableCustomDomain=true
```

Review `pilot-infrastructure-review.md` and the current complete diff before authorizing a deployment. Supply the verified existing hosted zone, owner alert destination and sender parameters. Keep `BedrockModelId` empty. Do not bootstrap, broaden IAM or deploy the demo as an incidental step. Record stack outputs and template digest after deployment. Public signup and demo bootstrap are disabled on the pilot; enrollment remains paused until explicitly resumed.

After this candidate is reviewed and merged to `main`, run the `Review or deploy private pilot` workflow with `operation=diff` and the existing `saystay.site` hosted-zone ID. It uses the existing repository-scoped GitHub OIDC role and creates a CloudFormation change set for `StayPilotStack`; it cannot run from a branch other than `main`. Review that exact run, its source SHA, this cost review and the stack target. Only then run the same workflow with `operation=deploy`, the exact 40-character reviewed main SHA and `confirm_reviewed_diff=true`. The pilot stack does not create another GitHub deployment role. A deployment run always rebuilds and verifies the candidate before assuming AWS credentials.

Rollback: pause enrollment, record the incident and current data versions, deploy the last verified pilot application/template revision using the pilot stack only, and retain current database data. Never run stack destroy or restore an older database merely to roll back UI code. If data repair is required, use a separately restored isolated table and the restore procedure above. Confirm API/MCP scope, delivery markers, schedules and alarms before reopening enrollment.

## Rollout gates

- Fresh CI, local browser tests and authenticated pilot REST/MCP initialize/list/call and WebSocket tests.
- Two real test identities in different households prove read/write/replay/reconnect/email isolation; revoked tokens fail after revocation, including existing WS connections.
- Controlled verified inbox tests prove neutral content, opt-out, removal, bounce/complaint suppression, explicit-throttle retry and ambiguous-send handling.
- Real VoiceOver/Safari and TalkBack/Chrome, keyboard, touch, 200% text, reduced motion and reconnect announcements on supported devices. Automated axe and viewport tests are supporting evidence only.
- Measured backup/restore rehearsal, rollback rehearsal, owner alarm receipt, consent and operator support arrangement.
- Onboard one household only after all gates pass. Expand to five after seven days without unresolved access, safety or delivery defects. Review after fourteen further days. Record dates and defects; calendar time cannot be replaced by synthetic tests.

## Authenticated MCP verification

The pilot requires MFA. Run `apps/web/scripts/verify-live-mcp.mjs` with `STAY_INTERACTIVE_LOGIN=true`, plus `STAY_COGNITO_BASE_URL`, `STAY_COGNITO_ISSUER_URL`, `STAY_CLIENT_ID`, `STAY_REDIRECT_URI` and `STAY_MCP_URL` from the protected pilot outputs/configuration. It opens a visible browser for the operator to complete sign-in and MFA, then validates OAuth state, issuer/audience/expiry, ID-token nonce, PKCE and MCP initialize/list/read-only-call without printing tokens or household content. Noninteractive username/password mode is retained for suitable test identities, but does not bypass MFA. Local syntax checks do not prove this provider flow; record the authenticated result after deployment.
