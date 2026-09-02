# AWS preflight evidence — 2026-09-02

This record contains no credentials, one-time codes, email addresses, or secret values.

## Target and isolation

- Account: `828547077857`
- Principal observed after the approved remote login: account root
- Region: `us-east-1`
- CDK bootstrap: `CREATE_COMPLETE`, bootstrap version `32`
- `StayDemoStack`: absent before deployment
- `saystay.site` hosted zone: absent before deployment
- STAY budget-name collision: none
- Bedrock invocation logging: not configured, therefore disabled

The existing bootstrap roles trust the account but AWS rejects `AssumeRole` from a root principal.
The template-only CDK diff therefore used the authenticated same-account credentials directly. No
resource was created by the preflight or diff.

## Bedrock feature gate

The exact system profile `us.amazon.nova-micro-v1:0` is active and routes Nova Micro through
`us-east-1`, `us-east-2`, and `us-west-2`. AWS returned:

- agreement availability: `AVAILABLE`
- entitlement availability: `AVAILABLE`
- region availability: `AVAILABLE`
- authorization status: `NOT_AUTHORIZED`

A minimal Converse request with `maxTokens: 16` and `temperature: 0` returned
`ValidationException: Operation not allowed`. The initial deployment must therefore leave
`BedrockModelId` empty. STAY has no silent model fallback; deterministic state machines, schedules,
touch forms, and Circle coordination remain available.

The Bedrock IAM policy is conditional on a non-empty model parameter and permits only the exact US
Nova Micro inference profile plus its three routed foundation-model ARNs.

## SES gate

SES reports:

- production access: disabled (sandbox)
- sending: enabled
- enforcement status: `HEALTHY`
- approved demo identity: `SUCCESS` and verified for sending

The same user-approved identity is configured for the alert-only budget, SES sender, and SES demo
recipient. A post-deployment Help Request produced a minimal email delivery marker and SES accepted
the message; inbox receipt remains a separate human check. AWS accepted a truthful transactional
production-access request on 2026-09-03, but review is pending and production access remains
disabled.

## Diff review

The authenticated initial-stack template diff showed one new isolated stack and no replacements.
Reviewed resource groups include the encrypted DynamoDB table and KMS key, private S3 hosting,
Cognito clients, HTTP and WebSocket APIs, Lambdas, EventBridge bus and schedules, queues and
DLQs, logs/metrics/alarms, alert-only budget, Route 53 public hosted zone, Secrets Manager secret,
and the repository/branch-scoped GitHub OIDC role.

No custom-domain certificate or DNS alias is included in the initial template. Those remain behind
the separate `enableCustomDomain=true` update after the user purchases the domain and delegates the
registrar nameservers.

## First deployment attempt

The first CloudFormation attempt did not serve application traffic. Encrypted log-group creation
failed because the customer-managed KMS key policy omitted the regional CloudWatch Logs service
principal. CloudFormation entered automatic rollback. The implementation was corrected without
removing encryption: the key now permits Logs cryptographic operations only when
`kms:EncryptionContext:aws:logs:arn` matches the STAY Lambda or API Gateway log-group prefixes in
this account and region. The infrastructure test asserts that exact policy before redeployment.

## Deployed result

- Stack: `StayDemoStack`, `UPDATE_ROLLBACK_COMPLETE` after the rejected CloudFront upgrade rolled back cleanly
- Region: `us-east-1`
- Public demo/API: `https://s9y6tc7mfc.execute-api.us-east-1.amazonaws.com`
- MCP: `https://s9y6tc7mfc.execute-api.us-east-1.amazonaws.com/mcp`
- WebSocket: `wss://vkcgjbose3.execute-api.us-east-1.amazonaws.com/prod`
- Managed Login: `https://stay-demo-828547077857.auth.us-east-1.amazoncognito.com`
- Hosting mode: `API_GATEWAY_PRIVATE_S3_FALLBACK`
- DynamoDB and Cognito deletion protection: enabled

CloudFront creation is account-provider blocked pending AWS verification. The deployed fallback
keeps both website buckets private and uses API Gateway plus a Lambda S3 reader; no public bucket
or website endpoint was enabled. The CloudFront/private-S3 path remains in CDK as a separately
reviewed upgrade.

Post-deployment evidence includes a TTL-isolated public demo, desktop protected flow, desktop and
mobile axe scans, OAuth authorization code plus PKCE, authenticated MCP `2025-11-25`
initialization, WebSocket event/reconciliation, minimal SES delivery, a CloudWatch domain metric,
zero messages in all three DLQs, and all deployed alarms in `OK`.

The first live EventBridge notification target failed because queues used the AWS-managed
`alias/aws/sqs` key, which cannot grant EventBridge delivery. All application queues and DLQs now
use SQS-managed server-side encryption. The in-place update was reviewed and the complete
EventBridge-to-SQS-to-SES/metric pipeline then passed.
