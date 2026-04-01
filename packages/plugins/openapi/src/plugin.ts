import { Effect, Layer, Option } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform";

import {
  definePlugin,
  type ExecutorPlugin,
  type PluginContext,
  ToolId,
  ToolInvocationResult,
  ToolInvocationError,
  type ToolRegistration,
} from "@executor/sdk";

import { parse } from "./parse";
import { extract } from "./extract";
import { invoke } from "./invoke";
import {
  type AuthConfig,
  type ExtractedOperation,
  InvocationConfig,
  NoAuth,
  type ServerInfo,
} from "./types";

// ---------------------------------------------------------------------------
// Plugin config — what you pass when adding a spec
// ---------------------------------------------------------------------------

export interface OpenApiSpecConfig {
  /** Raw spec text (JSON or YAML) or a URL to fetch */
  readonly spec: string;
  /** Override the base URL (defaults to first server in spec) */
  readonly baseUrl?: string;
  /** Namespace prefix for tool IDs (e.g. "stripe" → "stripe.listCustomers") */
  readonly namespace?: string;
  /** Auth configuration */
  readonly auth?: AuthConfig;
}

// ---------------------------------------------------------------------------
// Plugin extension — the public API on executor.openapi
// ---------------------------------------------------------------------------

export interface OpenApiPluginExtension {
  /** Add an OpenAPI spec and register its operations as tools */
  readonly addSpec: (
    config: OpenApiSpecConfig,
  ) => Effect.Effect<{ readonly toolCount: number }, Error>;

  /** Remove all tools from a previously added spec by namespace */
  readonly removeSpec: (namespace: string) => Effect.Effect<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resolveBaseUrl = (
  servers: readonly ServerInfo[],
): string => {
  const server = servers[0];
  if (!server) return "";

  let url = server.url;
  if (Option.isSome(server.variables)) {
    for (const [name, value] of Object.entries(server.variables.value)) {
      url = url.replaceAll(`{${name}}`, value);
    }
  }
  return url;
};

const operationDescription = (op: ExtractedOperation): string =>
  Option.getOrElse(op.description, () =>
    Option.getOrElse(op.summary, () =>
      `${op.method.toUpperCase()} ${op.pathTemplate}`,
    ),
  );

const operationToRegistration = (
  op: ExtractedOperation,
  namespace: string,
  invocationConfig: InvocationConfig,
  clientLayer: Layer.Layer<HttpClient.HttpClient>,
): ToolRegistration => {
  const id = ToolId.make(`${namespace}.${op.operationId}`);

  return {
    id,
    name: op.operationId as string,
    description: operationDescription(op),
    tags: [...op.tags, "openapi", namespace],
    inputSchema: Option.getOrUndefined(op.inputSchema),
    outputSchema: Option.getOrUndefined(op.outputSchema),
    invoke: (args) =>
      invoke(op, (args ?? {}) as Record<string, unknown>, invocationConfig).pipe(
        Effect.map(
          (result) =>
            new ToolInvocationResult({
              data: result.data,
              error: result.error,
              status: result.status,
            }),
        ),
        Effect.mapError(
          (err) =>
            new ToolInvocationError({
              toolId: id,
              message: `OpenAPI invocation failed: ${err.message}`,
              cause: err,
            }),
        ),
        Effect.provide(clientLayer),
      ),
  };
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export const openApiPlugin = (options?: {
  /** Provide a custom HttpClient layer. Defaults to FetchHttpClient. */
  readonly httpClientLayer?: Layer.Layer<HttpClient.HttpClient>;
}): ExecutorPlugin<"openapi", OpenApiPluginExtension> => {
  const httpClientLayer =
    options?.httpClientLayer ?? FetchHttpClient.layer;
  const registeredTools = new Map<string, readonly ToolId[]>();

  return definePlugin({
    key: "openapi",
    init: (ctx: PluginContext) =>
      Effect.succeed({
        extension: {
          addSpec: (config: OpenApiSpecConfig) =>
            Effect.gen(function* () {
              const doc = yield* parse(config.spec);
              const result = yield* extract(doc);

              const namespace =
                config.namespace ??
                Option.getOrElse(result.title, () => "api")
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "_");

              // Register shared component schemas first
              const components = doc.components;
              if (components?.schemas) {
                yield* ctx.tools.registerDefinitions(components.schemas);
              }

              const baseUrl = config.baseUrl ?? resolveBaseUrl(result.servers);

              const auth = config.auth ?? new NoAuth();
              const invocationConfig = new InvocationConfig({ baseUrl, auth });

              // Build a client layer with the base URL prepended to every request
              const clientWithBaseUrl = baseUrl
                ? Layer.effect(
                    HttpClient.HttpClient,
                    Effect.map(
                      HttpClient.HttpClient,
                      HttpClient.mapRequest(
                        HttpClientRequest.prependUrl(baseUrl),
                      ),
                    ),
                  ).pipe(Layer.provide(httpClientLayer))
                : httpClientLayer;

              const registrations = result.operations.map((op) =>
                operationToRegistration(
                  op,
                  namespace,
                  invocationConfig,
                  clientWithBaseUrl,
                ),
              );

              yield* ctx.tools.register(registrations);

              const toolIds = registrations.map((r) => r.id);
              registeredTools.set(namespace, toolIds);

              return { toolCount: registrations.length };
            }),

          removeSpec: (namespace: string) =>
            Effect.gen(function* () {
              const toolIds = registeredTools.get(namespace);
              if (toolIds) {
                yield* ctx.tools.unregister(toolIds);
                registeredTools.delete(namespace);
              }
            }),
        },

        close: () =>
          Effect.gen(function* () {
            for (const toolIds of registeredTools.values()) {
              yield* ctx.tools.unregister(toolIds);
            }
            registeredTools.clear();
          }),
      }),
  });
};
