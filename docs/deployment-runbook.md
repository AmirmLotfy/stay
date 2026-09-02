# Deployment runbook

Deployment is a reviewed operation. `StayDemoStack` is currently deployed in `us-east-1` with deletion protection enabled and the secure API Gateway/private-S3 hosting fallback active.

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
pnpm exec cdk diff StayDemoStack --strict \
  -c enableCloudFront=false \
  -c enableDeletionProtection=true \
  --method template
```

Review IAM broadening, encrypted API access-log destinations, Cognito callback URLs, deletion protection, KMS, public routes, budget email, resource tags, the Route 53 hosted-zone recurring charge, and the GitHub OIDC trust restricted to `AmirmLotfy/stay` main.

`cdk diff` in the pinned CLI does not accept CloudFormation parameter values. Review the exact four deployment values independently. `BedrockModelId` must be either the live-verified `us.amazon.nova-micro-v1:0` profile or empty. An empty value keeps both the model environment setting and the conditional Bedrock IAM policy disabled.

The first deployment must use the reviewed local AWS session because the project-scoped GitHub OIDC role is created by this stack. After that initial deployment, record the `GitHubDeploymentRoleArn` stack output as the repository secret `AWS_DEPLOY_ROLE_ARN`. Also configure `ALERT_EMAIL`, `SES_FROM_EMAIL`, and `SES_RECIPIENT_EMAIL` as repository secrets without copying their values into logs or documentation.

The OIDC role may assume only the four modern CDK bootstrap roles for this exact account and `us-east-1`. The manual GitHub workflow then enforces the same two-run gate: run it once with `operation=diff`, review the exact output, then start a separate `operation=deploy` run with `confirm_reviewed_diff=true`.

## 4. Deploy the reviewed fallback update

```bash
pnpm exec cdk deploy StayDemoStack --require-approval never \
  -c enableCloudFront=false \
  -c enableDeletionProtection=true \
  --parameters StayDemoStack:AlertEmail=ALERT_EMAIL \
  --parameters StayDemoStack:SesFromEmail=VERIFIED_SES_SENDER \
  --parameters StayDemoStack:SesRecipientEmail=APPROVED_SES_RECIPIENT \
  --parameters StayDemoStack:BedrockModelId=
```

The budget is an alert only. It does not shut down resources.

## 5. Activate `saystay.site` after purchase

The deployed stack already contains the Route 53 public hosted zone. Until delegation is complete, the API Gateway URL remains the public demo URL.

1. Use these authoritative nameservers for the existing STAY hosted zone:

   - `ns-349.awsdns-43.com`
   - `ns-1914.awsdns-47.co.uk`
   - `ns-816.awsdns-38.net`
   - `ns-1302.awsdns-34.org`

2. Purchase `saystay.site`, then replace the registrar nameservers with those exact four values. Do not create a second hosted zone.
3. Wait until public DNS reports the same delegation:

   ```bash
   dig +short NS saystay.site
   ```

4. Generate and review the activation diff using all the same parameters as the first deployment:

   ```bash
   pnpm exec cdk diff StayDemoStack --strict \
     -c enableCloudFront=false \
     -c enableDeletionProtection=true \
     -c enableCustomDomain=true \
     --method template
   ```

5. Only after delegation and diff review, deploy the activation update:

   ```bash
   pnpm exec cdk deploy StayDemoStack --require-approval never \
     -c enableCloudFront=false \
     -c enableDeletionProtection=true \
     -c enableCustomDomain=true \
     --parameters StayDemoStack:AlertEmail=ALERT_EMAIL \
     --parameters StayDemoStack:SesFromEmail=VERIFIED_SES_SENDER \
     --parameters StayDemoStack:SesRecipientEmail=APPROVED_SES_RECIPIENT \
     --parameters StayDemoStack:BedrockModelId=
   ```

The fallback update issues a DNS-validated ACM certificate in `us-east-1`, maps `saystay.site` to the regional HTTP API, creates apex A/AAAA aliases, and adds the custom URL to Cognito, CORS, MCP Origin validation, and the deployed web configuration. The current API Gateway hostname remains the tested fallback. Route 53 hosted-zone charges already apply; domain-registration charges are separate.

CloudFront is a separate upgrade because AWS currently blocks distribution creation for this account pending account verification. After AWS clears that provider gate, review a new diff with `enableCloudFront=true`; never make the S3 bucket public as a workaround.

## 6. Live evidence

- Create a new browser demo and confirm it cannot access an authenticated household.
- Sign in through Managed Login and verify PKCE, refresh rotation, logout, and revocation.
- Run duplicate and stale REST writes.
- Let a real EventBridge Scheduler transition fire; inspect the audit no-op for a duplicate.
- Disconnect/reconnect WebSocket and reconcile by REST.
- Prove one SES delivery to a verified address. The current verified demo identity passed this check; SES remains sandbox-limited.
- Inspect DLQs, logs, X-Ray, metrics, and alarms.
- Run MCP initialize/list/call from the deployed URL with allowed and denied origins/scopes.
- Confirm every simulated adapter label and timestamp.

Current public endpoints:

- Demo/API: `https://s9y6tc7mfc.execute-api.us-east-1.amazonaws.com`
- MCP: `https://s9y6tc7mfc.execute-api.us-east-1.amazonaws.com/mcp`
- WebSocket: `wss://vkcgjbose3.execute-api.us-east-1.amazonaws.com/prod`
- Managed Login: `https://stay-demo-828547077857.auth.us-east-1.amazoncognito.com`

## 7. Teardown decision

The table, keys, and buckets are retained and protected. Stack deletion does not remove them. Inventory retained resources and costs before any cleanup; never use a broad recursive deletion command.
