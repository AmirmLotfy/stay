# Deployment runbook

Deployment is a reviewed operation. `StayDemoStack` is currently deployed in `us-east-1` with CloudFormation termination protection and stateful-resource deletion protection enabled, plus the secure API Gateway/private-S3 hosting fallback active.

The official rules require the Project to remain free and available for judging. Do not tear down the repository, public video, or `StayDemoStack` before the judging period ends on November 20, 2026 at 12:00 PM Pacific Time / 20:00 UTC unless the Sponsor or Devpost provides different written instructions.

## 1. Identity and target

```bash
aws login
aws sts get-caller-identity
aws configure get region
```

Acceptance: expected AWS account, `us-east-1`, and no shared stack/resource name collision. If the ARN ends in `:root`, stop after read-only inspection. Do not use the root session for bootstrap, diff, deployment, or other mutations; post-bootstrap changes must run through the repository-scoped GitHub OIDC role.

## 2. Bedrock gate

List available foundation models and inference profiles in `us-east-1`. Record the exact Nova Micro ID/profile and run a minimal Converse invocation using no resident data. Do not substitute another model silently. If access is absent, leave `BedrockModelId` blank and report the AI feature as unavailable.

Invocation logging must remain disabled. The application sends only the redacted intent envelope defined in `services/agent`.

## 3. Bootstrap and diff

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test:e2e
cd infrastructure/cdk
pnpm exec cdk bootstrap aws://ACCOUNT_ID/us-east-1
pnpm build
pnpm exec cdk diff StayDemoStack --strict \
  -c enableCloudFront=false \
  -c enableDeletionProtection=true \
  --method template
```

Review IAM broadening, encrypted API access-log destinations, Cognito callback URLs, deletion protection, KMS, public routes, budget email, resource tags, the Route 53 hosted-zone recurring charge, and the GitHub OIDC trust restricted to `AmirmLotfy/stay` main.

`cdk diff` in the pinned CLI does not accept CloudFormation parameter values. Review the exact four deployment values independently. `BedrockModelId` must be either the live-verified `us.amazon.nova-micro-v1:0` profile or empty. An empty value keeps both the model environment setting and the conditional Bedrock IAM policy disabled.

Only the first deployment may need a reviewed non-root local AWS session because the project-scoped GitHub OIDC role is created by this stack. After that initial deployment, record the `GitHubDeploymentRoleArn` stack output as the repository secret `AWS_DEPLOY_ROLE_ARN`. Also configure `ALERT_EMAIL`, `SES_FROM_EMAIL`, and `SES_RECIPIENT_EMAIL` as repository secrets without copying their values into logs or documentation. These four repository secrets were populated on 2026-09-04; verify names and update timestamps with `gh secret list --repo AmirmLotfy/stay`, which never reveals their values.

The OIDC role may assume only the four modern CDK bootstrap roles for this exact account and `us-east-1`. The manual GitHub workflow then enforces the same two-run gate: run it once with `operation=diff`, review the exact output, then start a separate `operation=deploy` run with `confirm_reviewed_diff=true`.

## 4. Deploy the reviewed fallback update

```bash
pnpm build
pnpm exec cdk deploy StayDemoStack --require-approval never \
  -c enableCloudFront=false \
  -c enableDeletionProtection=true \
  --parameters StayDemoStack:AlertEmail=ALERT_EMAIL \
  --parameters StayDemoStack:SesFromEmail=VERIFIED_SES_SENDER \
  --parameters StayDemoStack:SesRecipientEmail=APPROVED_SES_RECIPIENT \
  --parameters StayDemoStack:BedrockModelId=
```

The budget is an alert only. It does not shut down resources.

Verify the stack-level and stateful-resource controls independently after every deployment:

```bash
aws cloudformation describe-stacks --stack-name StayDemoStack \
  --query 'Stacks[0].EnableTerminationProtection'
```

The CDK source sets `terminationProtection: true`, but a no-template-change deployment may take the CLI fast path without reconciling that stack-level flag. If the direct query returns `false`, apply the exact stack control and query again:

```bash
aws cloudformation update-termination-protection \
  --stack-name StayDemoStack \
  --enable-termination-protection
```

Do not infer CloudFormation termination protection from the `DeletionProtectionStatus` output; that output records DynamoDB and Cognito resource-level deletion protection.

## 5. Maintain or redeploy `saystay.site`

The domain is purchased, delegated, and active. The deployed stack contains the original Route 53 public hosted zone, DNS-validated ACM certificate, regional API Gateway custom domain, apex A/AAAA aliases, custom Cognito callback/logout URLs, and the SES domain identity. Transactional mail uses `STAY <updates@saystay.site>`, Easy DKIM with 2048-bit keys, the `mail.saystay.site` custom MAIL FROM domain with SPF, and a `_dmarc.saystay.site` DMARC record. The API Gateway URL remains the public fallback.

1. Use these authoritative nameservers for the existing STAY hosted zone:

   - `ns-349.awsdns-43.com`
   - `ns-1914.awsdns-47.co.uk`
   - `ns-816.awsdns-38.net`
   - `ns-1302.awsdns-34.org`

2. Keep the registrar nameservers set to those exact four values. Do not create a second hosted zone.
3. Before a domain-affecting deployment, confirm public DNS still reports the same delegation:

   ```bash
   dig +short NS saystay.site
   ```

4. Rebuild the public assets with the canonical domain, then generate and review the custom-domain diff using all the same parameters as the first deployment:

   ```bash
   NEXT_PUBLIC_APP_URL=https://saystay.site pnpm --filter @stay/web build
   cd infrastructure/cdk
   pnpm build
   pnpm exec cdk diff StayDemoStack --strict \
     -c enableCloudFront=false \
     -c enableDeletionProtection=true \
     -c enableCustomDomain=true \
     --method template
   ```

5. Only after delegation and diff review, deploy the custom-domain update:

   ```bash
   pnpm build
   pnpm exec cdk deploy StayDemoStack --require-approval never \
     -c enableCloudFront=false \
     -c enableDeletionProtection=true \
     -c enableCustomDomain=true \
     --parameters StayDemoStack:AlertEmail=ALERT_EMAIL \
     --parameters StayDemoStack:SesFromEmail=updates@saystay.site \
     --parameters StayDemoStack:SesRecipientEmail=APPROVED_SES_RECIPIENT \
     --parameters StayDemoStack:BedrockModelId=
   ```

The custom-domain update preserves the DNS-validated ACM certificate in `us-east-1`, maps `saystay.site` to the regional HTTP API, preserves apex A/AAAA aliases, and keeps the custom URL in Cognito, CORS, MCP Origin validation, and the deployed web configuration. CDK also owns the SES identity and authentication DNS records; do not replace them with manually managed duplicates. The API Gateway hostname remains the tested fallback. Route 53 hosted-zone and domain-registration charges are separate.

CloudFront is a separate upgrade because AWS still blocked distribution creation with the account-verification 403 on 2026-09-03. The prepared distribution serves the app shell from private S3 and forwards uncached `v1/*`, `mcp`, and `.well-known/*` behaviors to API Gateway so the upgrade cannot replace the apex API mapping with a static-only surface. After AWS clears the gate, review a fresh diff with `enableCloudFront=true`; never make the S3 bucket public as a workaround.

The AWS Support API is unavailable on the account's Basic Support plan, so account verification requires the signed-in Support Center. Create one **Account and billing** case with this subject:

> Verify account for CloudFront and Amazon Bedrock

Use this factual description:

> This account hosts the public STAY Amazon App Dev Challenge demo in us-east-1. Creating the first CloudFront distribution fails with: “Your account must be verified before you can add new CloudFront resources.” The failed request ID is `613d3483-2414-400f-b09e-f61c4bdc438f`. Amazon Bedrock independently reports the US Nova Micro profile as active and its agreement, entitlement, and region as available, but authorization remains `NOT_AUTHORIZED`; a minimal Converse request returns `ValidationException: Operation not allowed`. Please verify the account and identify any remaining identity or payment prerequisite. No quota increase is requested.

This request was submitted on 2026-09-03 as **Account and billing → Account Activation → Account Verification**, general-question severity, web response. The AWS Support case is `178838741100092`. Do not create a duplicate; follow that case until AWS confirms the account state.

The shared account-verification cause for the two services is an inference until AWS confirms it. Nova is an Amazon model, so do not submit the Anthropic-only first-time-use form as a workaround. After Support confirms verification, rerun the Bedrock availability/Converse checks and a fresh CloudFront CDK diff before deploying either feature gate.

## 6. Live evidence

- Create a new browser demo and confirm it cannot access an authenticated household.
- Sign in through Managed Login and verify PKCE, refresh rotation, logout, and revocation.
- Run duplicate and stale REST writes.
- Let a real EventBridge Scheduler transition fire; inspect the audit no-op for a duplicate.
- Disconnect/reconnect WebSocket and reconcile by REST.
- Confirm the SES identity reports `VerifiedForSendingStatus=true`, DKIM `SUCCESS`, and custom MAIL FROM `SUCCESS`.
- Prove one delivery from `STAY <updates@saystay.site>` to a verified address. SES accepted the 2026-09-03 test; confirm it in the recipient inbox before upgrading this evidence to delivered. The requested process details and message samples were sent in case `178838582000594` on 2026-09-03. Immediately afterward, the SES API still reported `ReviewDetails.Status=DENIED` and `ProductionAccessEnabled=false`; recheck with `aws sesv2 get-account --region us-east-1 --query '{ProductionAccessEnabled:ProductionAccessEnabled,SendingEnabled:SendingEnabled,EnforcementStatus:EnforcementStatus,ReviewStatus:Details.ReviewDetails.Status}'`. Unverified recipients remain blocked until AWS enables production access.
- Inspect DLQs, logs, X-Ray, metrics, and alarms.
- Run MCP initialize/list/call from the deployed URL with allowed and denied origins/scopes.
- Confirm every simulated adapter label and timestamp.

### SES production-access follow-up

AWS requested more detail in Support case `178838582000594`. Keep the current demo limitation explicit; do not imply that public visitors can configure email recipients. The reviewed reply is:

> Hello,
>
> STAY sends low-volume transactional coordination updates only. A send is triggered when a resident opens a help request, a configured Safety Window activates Circle coordination, or a Circle member accepts a response. There are no newsletters, promotions, scheduled campaigns, or bulk sends. During the hackathon demo we expect 0–20 messages on an ordinary day and fewer than 100 on a heavy test day.
>
> The currently deployed public demo routes all SES mail to one verified recipient controlled by the account owner. Public demo visitors cannot add or change email destinations. We do not import, purchase, scrape, rent, or share recipient lists. Before any post-demo household is allowed to notify a real Circle contact, that contact must be explicitly provided for that household and the product must expose a contact-level notification preference; broader sending will remain disabled until that control is deployed. An address will be removed or disabled immediately on request.
>
> The SES account-level suppression list is enabled for both BOUNCE and COMPLAINT. Application send attempts are idempotently recorded in DynamoDB. Transient send failures retry through SQS, repeated failures enter a DLQ, and CloudWatch alarms require operator review. We review SES suppression and delivery metrics and remove any invalid or complaining recipient before another send. Because the service sends only event-triggered transactional coordination—not subscription or marketing email—there is no marketing unsubscribe list. Any request to stop messages is handled by disabling that recipient before the next event.
>
> The sending identity is the verified `saystay.site` domain. Easy DKIM 2048 is `SUCCESS`, the custom `mail.saystay.site` MAIL FROM domain is `SUCCESS` with SPF, and DMARC is published. Mail is sent as `STAY <updates@saystay.site>` with subject `A STAY Circle update`.
>
> Example bodies are:
>
> 1. `Sarah asked their Circle for help. Sign in to STAY to view and respond.`
> 2. `A Circle member accepted Sarah’s request. Sign in to STAY for the current update.`
> 3. `Sarah’s Circle plan has an update. Sign in to STAY to view authorized details.`
>
> Every message ends with: `STAY never includes addresses, access instructions, keys, or location in email.`
>
> Thank you for reviewing the request.

The reply was sent with action-time confirmation on 2026-09-03 and is recorded in the case correspondence. Support shows the customer action as completed, but the SES API still reports review `DENIED` and `ProductionAccessEnabled=false`. Continue to report the account as sandbox-limited until `ProductionAccessEnabled=true` is observed through the SES API.

Current public endpoints:

- Demo/API: `https://saystay.site`
- MCP: `https://saystay.site/mcp`
- Fallback: `https://s9y6tc7mfc.execute-api.us-east-1.amazonaws.com`
- WebSocket: `wss://vkcgjbose3.execute-api.us-east-1.amazonaws.com/prod`
- Managed Login: `https://stay-demo-828547077857.auth.us-east-1.amazoncognito.com`

## 7. Teardown decision

The table, keys, and buckets are retained and protected. Stack deletion does not remove them. Inventory retained resources and costs before any cleanup; never use a broad recursive deletion command.
