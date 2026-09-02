# Threat model

## Assets

- household membership and role assignments;
- Safety Window and incident policy;
- access instructions and location permissions;
- House Memory;
- audit timelines and notification destinations;
- OAuth tokens, confidential client credentials, and AWS deployment role.

## Trust boundaries and controls

| Threat                              | Control                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-household access              | A Cognito V2 pre-token trigger copies immutable household/resident attributes into signed access-token claims; REST and MCP reject missing partition claims, and clients never submit an authoritative household ID |
| Demo-to-real data access            | Separate TTL namespace and unauthenticated route; API and WebSocket both verify an unexpired session record before deriving household scope; demo fixtures cannot query authenticated partitions                    |
| Replayed or duplicated writes       | Required idempotency key, DynamoDB transaction, TTL ledger, consumer dedupe                                                                                                                                         |
| Lost update or responder race       | Expected version condition; only one assignment transition succeeds                                                                                                                                                 |
| Scheduler duplication or delay      | Payload carries window ID, transition, and expected version; stale events are no-ops; timeline records timing                                                                                                       |
| WebSocket loss or reordering        | REST reconciliation and monotonically increasing aggregate version                                                                                                                                                  |
| Model prompt injection or overreach | Minimal allowlisted context, no contacts/address/keys/location, Zod validation, no tool execution, deterministic policy                                                                                             |
| Sensitive notification leakage      | Neutral email body; authenticated active incident required for protected details                                                                                                                                    |
| Access-instruction misuse           | Incident must be active, actor must be assigned and authorized, confirmation/audit required                                                                                                                         |
| OAuth interception                  | Authorization code + PKCE for public client, confidential Alexa client, exact redirects, rotation and revocation                                                                                                    |
| Direct AWS credential exposure      | No identity pool; browser never receives AWS credentials                                                                                                                                                            |
| MCP DNS rebinding/cross-origin call | Host/origin validation, JSON content type, JWT scope, protocol validation                                                                                                                                           |
| Supply-chain drift                  | Exact versions, committed lockfile, pnpm build-script allowlist, CI verification                                                                                                                                    |
| Runaway spend                       | Isolated stack, on-demand services, alarms, TTL, `$25` alert budget; operator reminded budget is not a cap                                                                                                          |

## Residual risks before public release

- No live penetration test or cloud policy simulation has been performed.
- The CloudFront WAF is a post-hackathon hardening gate documented in the CDK acknowledgment.
- SES reputation, deliverability, and production access require target-account evidence.
- Real Alexa account linking, Local Inspector, and device behavior remain unverified without partner access.
- Screen-reader behavior requires manual assistive-technology evidence in addition to axe.
