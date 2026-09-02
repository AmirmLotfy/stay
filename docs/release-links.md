# Judge and submission link manifest

This is the single copy source for judge-facing links. Only the video value remains pending the user's manual YouTube upload.

| Purpose                           | Link                                                              | Evidence required before use                                                    |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Try STAY                          | https://saystay.site                                              | Fresh signed-out browser completes the isolated protected flow over HTTPS       |
| Demo video                        | `[PUBLIC_YOUTUBE_URL]`                                            | Public, embeddable, English, HD, captions available, under three minutes        |
| Public source                     | https://github.com/AmirmLotfy/stay                                | Public repository and Apache-2.0 detection                                      |
| Setup instructions                | https://github.com/AmirmLotfy/stay#run-locally                    | Clean clone follows the documented path                                         |
| Public CI                         | https://github.com/AmirmLotfy/stay/actions/runs/33686752727       | Green run for release-evidence baseline `30a1cab`; 24/24 scenarios passed       |
| Friction log                      | https://github.com/AmirmLotfy/stay/blob/main/docs/friction-log.md | Publicly readable                                                               |
| Devpost project                   | https://devpost.com/software/stay-ljbdk8                          | Remains a draft until the separate final submission confirmation                |
| MCP endpoint                      | https://saystay.site/mcp                                          | Protocol, origin, bearer scope, initialize/list/call, and error tests pass live |
| OAuth protected-resource metadata | https://saystay.site/.well-known/oauth-protected-resource/mcp     | Public metadata resolves and names the deployed MCP resource                    |

## Devpost copy

- **Project URL / Try it out:** `https://saystay.site`
- **Testing link — field 28302:** `https://saystay.site`
- **Video:** `[PUBLIC_YOUTUBE_URL]`
- **Repository — field 28290:** `https://github.com/AmirmLotfy/stay`
- **Open Source contribution — field 28296:** `https://github.com/AmirmLotfy/stay/commit/a2cdb02df7ae0e235a1a738f4fe31d93bbc5a762`
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
