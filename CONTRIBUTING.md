# Contributing

STAY is safety-adjacent coordination software. Changes must preserve resident control and must not blur simulated, local, cloud, or device evidence.

1. Create a focused branch and keep state-machine changes separate from visual-only work.
2. Add legal and illegal transition tests for every lifecycle change.
3. Never send contact details, addresses, access instructions, location, or unrestricted House Memory to a model.
4. Keep every provider observation labeled `live`, `simulated`, or `unavailable` with provider and timestamp.
5. Run `pnpm verify`; run `pnpm test:e2e` when behavior or UI changes.
6. Do not deploy or submit from a pull request. Those actions require their dedicated review gates.

Security issues should not be filed publicly. Use GitHub’s private vulnerability reporting after the public repository is enabled.
