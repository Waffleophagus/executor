# app-cli

Executor CLI thin-client scaffold.

The CLI proxies all operations to an Executor server target:

- `local` target: connects to `http://127.0.0.1:8788` and auto-starts `apps/pm` as a
  short-lived subprocess if the local server is not already running.
- `cloud` target: proxies to a configured remote base URL.

Implementation note:

- Control-plane commands are executed through the typed `ControlPlaneApi` client from
  `@executor-v2/management-api/client`, so client calls stay aligned with the same
  HttpApi contract used by the server.
- CLI parsing/help/completion behavior is powered by `@effect/cli`.

Supported commands:

- `executor init`
- `executor auth login --client-id ...`
- `executor auth status`
- `executor target show`
- `executor target use <local|cloud>`
- `executor workspace current`
- `executor workspace use <workspace-id>`
- `executor sources list`
- `executor sources add --kind ... --url ...`
- `executor tools list`

Plus generated commands from `ControlPlaneApi` via `HttpApi.reflect`, for example:

- `executor workspaces list`
- `executor workspaces upsert --organization-id org_local --name "Local Workspace"`
- `executor sources upsert --workspace-id ws_local --name sample --kind openapi --endpoint https://example.com/openapi.json`

Generated endpoint commands accept:

- `--<path-param>` for path parameters
- `--<payload-field>` for struct payload fields
- `--payload-json '{...}'` for raw payload JSON

Generated command UX notes:

- Required endpoint fields are marked as required in command help.
- `workspaceId` path parameters can fall back to `--workspace` / current workspace config.

Run locally:

- `bun run --cwd apps/cli start -- target show`
- `bun run --cwd apps/cli start -- sources list --target local`
- `bun run --cwd apps/cli start -- --help`
