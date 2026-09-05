# Pilot infrastructure review

Prepared 2026-09-05. Status: strict local synthesis passed and read-only `cdk diff --no-change-set` completed against AWS; **not deployed**. `StayPilotStack` does not currently exist. The existing `StayDemoStack` reports `UPDATE_COMPLETE`.

The candidate adds one stack with its own encrypted product table/key, eleven Lambda functions including CDK helpers, eleven log groups, six SQS queues, two SNS topics, six actionable alarms, a separate required-MFA Cognito pool, an SES feedback configuration and the pilot API/domain. Existing Route53 zone and GitHub OIDC provider are imported, and the verified SES identity is referenced. The diff creates pilot resources; the demo is not selected for update. Alias-name tests explicitly protect the judge apex. The IAM wildcard acknowledgment is scoped to this stack's CloudFormation ARN versions, with existing granular justifications retained.

Read-only cloud checks work, but the current CLI caller is root. Pilot mutations require a scoped non-root deployment/operator identity; the existing GitHub OIDC path trusts only main and must not be silently broadened. SES currently reports sandbox mode, sending enabled, 200 messages/24h and one message/second. This is enough only for individually verified pilot recipients; inbox receipt and feedback tests remain unperformed. Bedrock and CloudFront remain outside this candidate's requirements.

## Advisory monthly estimate

US East (N. Virginia), checked 2026-09-05 against current AWS pricing examples. Five households, at most 45 active identities, 100,000 HTTP requests, 100,000 WebSocket messages and 500,000 connection minutes/month; 200,000 Lambda invocations averaging 512 MB/0.5 seconds, plus 1,000 paced email sends; 2 million DynamoDB read units and 200,000 write units including transactions, one GB stored and backed up; one GB log ingestion. These are workload assumptions, not measured usage. Free tiers/credits are excluded from the calculations.

| Component                                            | Calculation or allowance                                                                                                           | Monthly USD |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------: |
| KMS key and requests                                 | One key $1; allow 100,000 requests at $0.03/10,000                                                                                 |       $1.30 |
| Secret                                               | One at $0.40 plus request allowance                                                                                                |       $0.45 |
| CloudWatch                                           | Six standard alarms $0.60; one pilot custom metric $0.30; 1 GB logs $0.50 plus storage/query allowance                             |       $1.60 |
| API Gateway                                          | 0.1M HTTP × $1/M; 0.1M WS messages × $1/M; 0.5M connection minutes × $0.25/M                                                       |       $0.33 |
| Lambda                                               | 50,000 GB-seconds × conservative x86 rate $0.0000166667, $0.04 requests, plus pacing/worker allowance; deployment uses cheaper ARM |       $1.10 |
| DynamoDB                                             | 2M reads × $0.125/M + 0.2M writes × $0.625/M + 1 GB storage $0.25 + PITR $0.20                                                     |       $0.83 |
| Cognito                                              | 45 Plus MAUs × $0.020 (configured threat protection tier)                                                                          |       $0.90 |
| SES                                                  | 1,000 messages × $0.10/1,000 plus small transfer allowance                                                                         |       $0.11 |
| Queues, SNS, schedules, S3, DNS, traces and transfer | Provisional combined allowance; validate observed usage                                                                            |        $2–5 |
| **Incremental pilot planning range**                 | Rounded with contingency                                                                                                           |   **$9–13** |

The pilot uses one total-event custom metric in `STAY/Pilot`; event/aggregate detail remains in logs. Detailed API route metrics are disabled for this stage; default service metrics and the six alarms remain. Current demo `STAY/Demo` lists 30 metric series. At $0.30/series for continuous full-month reporting those alone would be $9; actual billing is prorated by reporting hours and this inventory is not a bill. Existing demo route metrics and usage add further cost. A conservative combined allowance is **$20–30/month**, so the $25 target is still unproven. The pre-release read-only cost query returned effectively $0 for September 1–5, which can reflect free allowances/credits/reporting lag and cannot establish a forecast.

Account-wide $20 alert thresholds are informational and do not stop usage. Investigate at $15 forecast, pause enrollment at $20 forecast until reviewed, and obtain the operator's decision before expanding usage. Existing coordination must not be silently disabled by a budget alert. Rehearsal backups/restored tables, log growth, continuous client polling and unrelated account use can exceed these assumptions.

Rate sources: [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/), [KMS](https://aws.amazon.com/kms/pricing/), [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/), [API Gateway](https://aws.amazon.com/api-gateway/pricing/), [Lambda](https://aws.amazon.com/lambda/pricing/), [DynamoDB](https://aws.amazon.com/dynamodb/pricing/), [Cognito](https://aws.amazon.com/cognito/pricing/), [SES](https://aws.amazon.com/ses/pricing/). The table is a reproducible planning calculation, not a saved AWS Calculator quote. The grouped $2–5 allowance and combined demo range need operator review before deployment.

## Outstanding release evidence

Owner review of the final candidate and combined cost forecast; separate deployment authorization; confirmed SNS owner subscription and alert receipt; verified inbox/SES feedback tests; authenticated pilot tests; restore/rollback rehearsal; real-device accessibility and observation periods. See `pilot-runbook.md`.
