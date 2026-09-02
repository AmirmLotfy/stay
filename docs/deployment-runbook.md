# Deployment runbook

Deployment is a reviewed operation. Local tests, successful synth, or authenticated tooling do not authorize resource creation.

## 1. Identity and target

```bash
aws login
aws sts get-caller-identity
aws configure get region
```

Acceptance: expected AWS account, `us-east-1`, and no shared stack/resource name collision.

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
pnpm diff -- --parameters AlertEmail=ALERT_EMAIL --parameters SesFromEmail=VERIFIED_SES_SENDER --parameters SesRecipientEmail=APPROVED_SES_RECIPIENT --parameters BedrockModelId=VERIFIED_MODEL_ID
```

Review IAM broadening, encrypted API access-log destinations, Cognito callback URLs, deletion protection, KMS, public routes, budget email, resource tags, the Route 53 hosted-zone recurring charge, and the GitHub OIDC trust restricted to `AmirmLotfy/stay` main.

The first deployment must use the reviewed local AWS session because the project-scoped GitHub OIDC role is created by this stack. After that initial deployment, record the `GitHubDeploymentRoleArn` stack output as the repository secret `AWS_DEPLOY_ROLE_ARN`. Also configure `ALERT_EMAIL`, `SES_FROM_EMAIL`, and `SES_RECIPIENT_EMAIL` as repository secrets without copying their values into logs or documentation.

The OIDC role may assume only the four modern CDK bootstrap roles for this exact account and `us-east-1`. The manual GitHub workflow then enforces the same two-run gate: run it once with `operation=diff`, review the exact output, then start a separate `operation=deploy` run with `confirm_reviewed_diff=true`.

## 4. Deploy

```bash
pnpm deploy -- --parameters AlertEmail=ALERT_EMAIL --parameters SesFromEmail=VERIFIED_SES_SENDER --parameters SesRecipientEmail=APPROVED_SES_RECIPIENT --parameters BedrockModelId=VERIFIED_MODEL_ID
```

The budget is an alert only. It does not shut down resources.

## 5. Activate `saystay.site` after purchase

The first deployment deliberately creates only the Route 53 public hosted zone. The working CloudFront URL remains the public demo URL, so certificate validation cannot delay the initial release.

1. Read the `DomainDelegationNameServers` stack output. It contains the authoritative nameservers for the one STAY hosted zone.
2. Purchase `saystay.site`, then replace the registrar nameservers with those exact four values. Do not create a second hosted zone.
3. Wait until public DNS reports the same delegation:

   ```bash
   dig +short NS saystay.site
   ```

4. Generate and review the activation diff using all the same parameters as the first deployment:

   ```bash
   pnpm diff -- -c enableCustomDomain=true --parameters AlertEmail=ALERT_EMAIL --parameters SesFromEmail=VERIFIED_SES_SENDER --parameters SesRecipientEmail=APPROVED_SES_RECIPIENT --parameters BedrockModelId=VERIFIED_MODEL_ID
   ```

5. Only after delegation and diff review, deploy the activation update:

   ```bash
   pnpm deploy -- -c enableCustomDomain=true --parameters AlertEmail=ALERT_EMAIL --parameters SesFromEmail=VERIFIED_SES_SENDER --parameters SesRecipientEmail=APPROVED_SES_RECIPIENT --parameters BedrockModelId=VERIFIED_MODEL_ID
   ```

The update issues a DNS-validated ACM certificate in `us-east-1`, attaches `saystay.site` to CloudFront, creates apex A/AAAA aliases, and adds the custom URL to Cognito, CORS, MCP Origin validation, and the deployed web configuration. The CloudFront hostname remains a tested fallback. Route 53 hosted-zone charges begin with the first deployment; domain-registration charges are separate.

## 6. Live evidence

- Create a new browser demo and confirm it cannot access an authenticated household.
- Sign in through Managed Login and verify PKCE, refresh rotation, logout, and revocation.
- Run duplicate and stale REST writes.
- Let a real EventBridge Scheduler transition fire; inspect the audit no-op for a duplicate.
- Disconnect/reconnect WebSocket and reconcile by REST.
- Prove one SES delivery to a verified address. If provider-limited, record that status without implying delivery.
- Inspect DLQs, logs, X-Ray, metrics, and alarms.
- Run MCP initialize/list/call from the deployed URL with allowed and denied origins/scopes.
- Confirm every simulated adapter label and timestamp.

## 7. Teardown decision

The table, keys, and buckets are retained and protected. Stack deletion does not remove them. Inventory retained resources and costs before any cleanup; never use a broad recursive deletion command.
