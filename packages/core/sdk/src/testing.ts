import { Effect } from "effect";

import { ScopeId, ToolId, SecretId, PolicyId } from "./ids";
import {
  ToolNotFoundError,
  SecretNotFoundError,
} from "./errors";
import type { ToolRegistration, InvokeOptions } from "./tools";
import type { Secret } from "./secrets";
import type { Policy } from "./policies";
import type { Scope } from "./scope";
import type { ExecutorConfig } from "./executor";
import type { ExecutorPlugin } from "./plugin";

// ---------------------------------------------------------------------------
// In-memory ToolRegistry
// ---------------------------------------------------------------------------

const makeInMemoryToolRegistry = () => {
  const tools = new Map<
    string,
    ToolRegistration
  >();

  return {
    list: (filter?: {
      readonly tags?: readonly string[];
      readonly query?: string;
    }) =>
      Effect.sync(() => {
        let result = [...tools.values()];
        if (filter?.tags?.length) {
          const tagSet = new Set(filter.tags);
          result = result.filter((t) =>
            t.tags?.some((tag) => tagSet.has(tag)),
          );
        }
        if (filter?.query) {
          const q = filter.query.toLowerCase();
          result = result.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.description?.toLowerCase().includes(q),
          );
        }
        return result.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          tags: t.tags ? [...t.tags] : [],
        }));
      }),

    schema: (toolId: ToolId) =>
      Effect.fromNullable(tools.get(toolId)).pipe(
        Effect.mapError(() => new ToolNotFoundError({ toolId })),
        Effect.map((t) => ({
          id: t.id,
          inputSchema: t.inputSchema,
          outputSchema: t.outputSchema,
        })),
      ),

    invoke: (toolId: ToolId, args: unknown, options?: InvokeOptions) =>
      Effect.gen(function* () {
        const tool = yield* Effect.fromNullable(tools.get(toolId)).pipe(
          Effect.mapError(() => new ToolNotFoundError({ toolId })),
        );
        return yield* tool.invoke(args, options);
      }),

    register: (newTools: readonly ToolRegistration[]) =>
      Effect.sync(() => {
        for (const t of newTools) {
          tools.set(t.id, t);
        }
      }),

    unregister: (toolIds: readonly ToolId[]) =>
      Effect.sync(() => {
        for (const id of toolIds) {
          tools.delete(id);
        }
      }),
  };
};

// ---------------------------------------------------------------------------
// In-memory SecretStore
// ---------------------------------------------------------------------------

const makeInMemorySecretStore = () => {
  const secrets = new Map<string, Secret & { value: string }>();
  let counter = 0;

  return {
    list: (scopeId: ScopeId) =>
      Effect.succeed(
        [...secrets.values()].filter((s) => s.scopeId === scopeId),
      ),
    get: (secretId: SecretId) =>
      Effect.fromNullable(secrets.get(secretId)).pipe(
        Effect.mapError(() => new SecretNotFoundError({ secretId })),
      ),
    resolve: (secretId: SecretId) =>
      Effect.fromNullable(secrets.get(secretId)).pipe(
        Effect.mapError(() => new SecretNotFoundError({ secretId })),
        Effect.map((s) => s.value),
      ),
    store: (input: {
      readonly scopeId: ScopeId;
      readonly name: string;
      readonly value: string;
      readonly purpose?: string;
    }) =>
      Effect.sync(() => {
        const id = SecretId.make(`secret-${++counter}`);
        const secret = {
          id,
          scopeId: input.scopeId,
          name: input.name,
          purpose: input.purpose,
          createdAt: new Date(),
          value: input.value,
        };
        secrets.set(id, secret);
        return secret;
      }),
    remove: (secretId: SecretId) =>
      Effect.fromNullable(secrets.get(secretId)).pipe(
        Effect.mapError(() => new SecretNotFoundError({ secretId })),
        Effect.map(() => secrets.delete(secretId)),
      ),
  };
};

// ---------------------------------------------------------------------------
// In-memory PolicyEngine
// ---------------------------------------------------------------------------

const makeInMemoryPolicyEngine = () => {
  const policies = new Map<string, Policy>();
  let counter = 0;

  return {
    list: (scopeId: ScopeId) =>
      Effect.succeed(
        [...policies.values()].filter((p) => p.scopeId === scopeId),
      ),
    check: (_input: { readonly scopeId: ScopeId; readonly toolId: ToolId }) =>
      Effect.void,
    add: (policy: Omit<Policy, "id" | "createdAt">) =>
      Effect.sync(() => {
        const id = PolicyId.make(`policy-${++counter}`);
        const full: Policy = { ...policy, id, createdAt: new Date() };
        policies.set(id, full);
        return full;
      }),
    remove: (policyId: PolicyId) =>
      Effect.succeed(policies.delete(policyId)),
  };
};

// ---------------------------------------------------------------------------
// makeTestConfig — one-liner to build a test ExecutorConfig
// ---------------------------------------------------------------------------

export const makeTestConfig = <
  const TPlugins extends readonly ExecutorPlugin<string, object>[] = [],
>(
  options?: {
    readonly name?: string;
    readonly plugins?: TPlugins;
  },
): ExecutorConfig<TPlugins> => {
  const scope: Scope = {
    id: ScopeId.make("test-scope"),
    parentId: null,
    name: options?.name ?? "test",
    createdAt: new Date(),
  };

  return {
    scope,
    tools: makeInMemoryToolRegistry(),
    secrets: makeInMemorySecretStore(),
    policies: makeInMemoryPolicyEngine(),
    plugins: options?.plugins,
  };
};
