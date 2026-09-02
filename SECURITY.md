# Security policy

STAY is safety-adjacent coordination software, not an emergency service or medical system. Reports that could affect resident privacy, authorization boundaries, incident integrity, scheduled checks, or protected access instructions are treated as security issues.

## Supported version

Security fixes are applied to the current `main` branch while the hackathon demonstration remains available. There is no separately supported production release line yet.

## Report a vulnerability

Use GitHub's **Report a vulnerability** control in this repository's Security tab. Do not open a public issue containing exploit details, credentials, household information, or personal data.

Include:

- the affected route, MCP tool, workflow, or commit;
- a minimal reproduction using synthetic data only;
- the expected and observed authorization or safety behavior;
- potential impact; and
- any suggested mitigation.

Do not test against real residents, real access instructions, or accounts you do not own. Do not attempt denial-of-service, social engineering, emergency-provider contact, or extraction of secrets or personal data.

## Response and disclosure

We will acknowledge a reproducible report, assess severity, and coordinate a remediation and disclosure timeline through the private report. Public disclosure should wait until a fix or explicit mitigation is available.

Provider outages, unavailable Alexa+ or Bedrock access, and visibly simulated adapter data are documented product limitations unless they create an authorization, privacy, or integrity failure.
