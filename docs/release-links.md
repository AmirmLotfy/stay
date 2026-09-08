# Judge and submission link manifest

This is the single copy source for judge-facing links.

Fresh anonymous HTTP revalidation on 2026-09-08 returned 200 for the demo, YouTube watch/embed, public repository, setup README, friction log, final main CI and OAuth metadata. An unauthenticated MCP initialize request returned the expected 401. The public GitHub page exposes the Apache-2.0 license label; raw README, license and friction-log files are publicly readable.

| Purpose                           | Link                                                              | Evidence required before use                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Try STAY                          | https://saystay.site                                              | Fresh deployed suite completes all 36 applicable scenarios; anonymous HTTP returns 200                                                             |
| Demo video                        | https://youtu.be/oCoXdCRVyMo                                      | Public, embeddable, English, 1080p, 170 seconds; approved manual SRT active and public continuity passed; participant sound/content review pending |
| Public source                     | https://github.com/AmirmLotfy/stay                                | Anonymous HTTP returns 200 and GitHub exposes the Apache-2.0 license label                                                                         |
| Setup instructions                | https://github.com/AmirmLotfy/stay#run-locally                    | Anonymous README is readable and contains the `Run locally` section                                                                                |
| Public CI                         | https://github.com/AmirmLotfy/stay/actions/runs/34164700108       | Final `main` `1adafd5`; full pipeline, media, coverage, both stack syntheses, and 44 browser scenarios passed                                      |
| Friction log                      | https://github.com/AmirmLotfy/stay/blob/main/docs/friction-log.md | Anonymous page/raw file both return 200                                                                                                            |
| Devpost project                   | https://devpost.com/software/stay-ljbdk8                          | Remains a draft until the separate final submission confirmation                                                                                   |
| MCP endpoint                      | https://saystay.site/mcp                                          | Current public boundary returns the expected 401; prior authenticated initialize/list/call proof needs a fresh recovery run                        |
| OAuth protected-resource metadata | https://saystay.site/.well-known/oauth-protected-resource/mcp     | Public metadata resolves and names the deployed MCP resource                                                                                       |

## Devpost copy

- **Project URL / Try it out:** `https://saystay.site`
- **Testing link — field 28302:** `https://saystay.site`
- **Video:** `https://youtu.be/oCoXdCRVyMo`
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
