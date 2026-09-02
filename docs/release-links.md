# Judge and submission link manifest

This is the single copy source for judge-facing links. Replace only the bracketed deployment and video values after live verification.

| Purpose                           | Link                                                              | Evidence required before use                                                    |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Try STAY                          | `[DEPLOYED_HTTPS_URL]`                                            | Fresh signed-out browser completes the isolated protected flow over HTTPS       |
| Demo video                        | `[PUBLIC_YOUTUBE_URL]`                                            | Public, embeddable, English, HD, captions available, under three minutes        |
| Public source                     | https://github.com/AmirmLotfy/stay                                | Public repository and Apache-2.0 detection                                      |
| Setup instructions                | https://github.com/AmirmLotfy/stay#run-locally                    | Clean clone follows the documented path                                         |
| Public CI                         | https://github.com/AmirmLotfy/stay/actions/runs/33601453126       | Green run for the bounded Bedrock intent-path release candidate                 |
| Friction log                      | https://github.com/AmirmLotfy/stay/blob/main/docs/friction-log.md | Publicly readable                                                               |
| Devpost project                   | https://devpost.com/software/stay-ljbdk8                          | Remains a draft until the separate final submission confirmation                |
| MCP endpoint                      | `[API_HTTPS_URL]/mcp`                                             | Protocol, origin, bearer scope, initialize/list/call, and error tests pass live |
| OAuth protected-resource metadata | `[API_HTTPS_URL]/.well-known/oauth-protected-resource/mcp`        | Public metadata resolves and names the deployed MCP resource                    |

## Devpost copy

- **Project URL / Try it out:** `[DEPLOYED_HTTPS_URL]`
- **Testing link — field 28302:** `[DEPLOYED_HTTPS_URL]`
- **Video:** `[PUBLIC_YOUTUBE_URL]`
- **Repository — field 28290:** `https://github.com/AmirmLotfy/stay`
- **Open Source contribution — field 28296:** `https://github.com/AmirmLotfy/stay/commit/d03c59e05ec3359c33bdcdfcaf44769922885c90`
- **Friction log — field 28301:** `https://github.com/AmirmLotfy/stay/blob/main/docs/friction-log.md`

## Judge walkthrough

1. Open the Try STAY URL in a private browser window; no account is required for the synthetic demo.
2. Select **Miss the first check**.
3. Select **Miss the second check**.
4. Select **Sarah asks Tom**.
5. Select **Tom accepts** and confirm **“Tom is on the way.”**
6. Refresh once to verify the isolated four-hour demo session reconciles from the API.
7. Inspect Access, Privacy, House Memory, Help Board, Playbooks, and the Alexa+ simulator.

The judge URL must never be replaced with an API endpoint, authenticated household URL, localhost address, CloudFormation console link, or unverified deployment output.
