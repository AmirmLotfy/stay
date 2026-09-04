# Safety boundaries

STAY is supplementary independent-living coordination. It is not an emergency service, medical device, diagnostic system, fall detector, monitoring service, or replacement for Alexa Emergency Assist.

## Deterministic authority

Only the application state machines may:

- advance a Safety Window check and grace period;
- apply the resident’s saved escalation order;
- activate an incident;
- assign one responder with optimistic concurrency;
- disclose incident-limited access instructions after authorization;
- resolve an incident with the required role.

The model can interpret a short request and write a concise explanation. It cannot execute tools, choose contacts, change policy, disclose sensitive data, or close an incident.

## Explicit emergency language

When a resident uses explicit emergency wording, STAY says:

> STAY can coordinate your preconfigured Circle. It does not contact emergency services or replace Alexa Emergency Assist. Should I ask your Circle now?

Only the resident’s preconfigured Circle plan may run. The message never promises that emergency services, a caregiver, or a device provider was contacted.

## Privacy invariants

Temporary private time may suppress routine status. It cannot suppress:

- help the resident explicitly requests;
- active incident coordination authorized by the resident’s saved plan;
- security and audit records.

Email contains only a neutral sign-in prompt. Address, location, access instructions, spare-key values, health data, and the reason for an incident remain out of email and model context.

The confirmation contract covers ending active private time early, expanding location sharing, removing a primary contact, changing an escalation plan, and disclosing access instructions. Implemented sensitive workflows issue a five-minute opaque token, store only its hash, bind it to actor, entity, purpose, and aggregate version, and consume it atomically with the confirmed write. Incident access disclosure additionally requires an authenticated non-resident Circle identity whose immutable `circle_member_id` matches the incident's current assignment while the incident is active. The disclosure is recorded in the immutable incident timeline and outbox; the note value is never copied into either event.

Access preferences and House Memory are versioned aggregates. House Memory events include category and sensitivity but never the stored value. The MCP tool can read or write only routine entries; sensitive and incident-only values stay outside model context.

## Provider truth

Every observation includes mode (`live`, `simulated`, or `unavailable`), provider, observation time, and optional reason. The submitted release uses simulation for weather, utility, maintenance, Ring, Smart Properties, devices, and travel estimates. A simulated result is never described as detection or real-world action.
