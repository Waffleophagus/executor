import {
  createRuntimeToolCallHandler,
  createUnimplementedRuntimeToolInvoker,
} from "@executor-v2/engine";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { createPmResolveToolCredentials } from "./credential-resolver";
import { type SecretMaterialStore } from "./secret-material-store";

const emptyCredentialRows = {
  workspaces: {
    getById: () => Effect.succeed(Option.none()),
  },
  sourceAuthBindings: {
    listByWorkspaceScope: () => Effect.succeed([]),
  },
  authConnections: {
    getById: () => Effect.succeed(Option.none()),
  },
  authMaterials: {
    getByConnectionId: () => Effect.succeed(Option.none()),
  },
  oauthStates: {
    getByConnectionId: () => Effect.succeed(Option.none()),
  },
};

const noSecretStore: SecretMaterialStore = {
  kind: "none",
  put: () => Effect.die("unsupported"),
  get: () => Effect.die("unsupported"),
  remove: () => Effect.void,
};

describe("PM runtime tool-call handling", () => {
  it.effect("resolves bearer credentials from secret material handles", () =>
    Effect.gen(function* () {
      const resolveCredentials = createPmResolveToolCredentials(
        {
          workspaces: {
            getById: () =>
              Effect.succeed(
                Option.some({
                  id: "ws_local",
                  organizationId: "org_local",
                  name: "Workspace",
                  createdByAccountId: null,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }),
              ),
          },
          sourceAuthBindings: {
            listByWorkspaceScope: () =>
              Effect.succeed([
                {
                  id: "auth_binding_1",
                  sourceId: "src_demo",
                  connectionId: "conn_demo",
                  organizationId: "org_local",
                  workspaceId: "ws_local",
                  accountId: null,
                  scopeType: "workspace",
                  selector: null,
                  enabled: true,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              ]),
          },
          authConnections: {
            getById: () =>
              Effect.succeed(
                Option.some({
                  id: "conn_demo",
                  organizationId: "org_local",
                  workspaceId: "ws_local",
                  accountId: null,
                  ownerType: "workspace",
                  strategy: "bearer",
                  displayName: "Demo",
                  status: "active",
                  statusReason: null,
                  lastAuthErrorClass: null,
                  metadataJson: null,
                  additionalHeadersJson: null,
                  createdByAccountId: null,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  lastUsedAt: null,
                }),
              ),
          },
          authMaterials: {
            getByConnectionId: () =>
              Effect.succeed(
                Option.some({
                  id: "auth_material_1",
                  connectionId: "conn_demo",
                  backend: "keychain",
                  materialHandle: "keychain:test-token",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }),
              ),
          },
          oauthStates: {
            getByConnectionId: () => Effect.succeed(Option.none()),
          },
        },
        {
          kind: "keychain",
          put: () => Effect.die("not-used"),
          get: () => Effect.succeed("demo-token"),
          remove: () => Effect.void,
        },
      );

      const resolved = yield* resolveCredentials({
        runId: "run_credential_1",
        callId: "call_credential_1",
        toolPath: "source.src_demo.repo_get",
        credentialContext: {
          workspaceId: "ws_local",
          sourceKey: "source:src_demo",
        },
      });

      expect(resolved.headers.Authorization).toBe("Bearer demo-token");
    }),
  );

  it.effect("returns failed callback result for unimplemented invoker", () =>
    Effect.gen(function* () {
      const resolveCredentials = createPmResolveToolCredentials(
        emptyCredentialRows,
        noSecretStore,
      );
      const invokeRuntimeTool = createUnimplementedRuntimeToolInvoker("pm");
      const handleToolCall = createRuntimeToolCallHandler({
        resolveCredentials,
        invokeRuntimeTool,
      });

      const result = yield* handleToolCall({
        runId: "run_2",
        callId: "call_2",
        toolPath: "tools.example.weather",
        input: { city: "London" },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("failed");
        expect(result.error).toContain("tools.example.weather");
      }
    }),
  );
});
