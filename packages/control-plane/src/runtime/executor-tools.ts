import {
  type ElicitationResponse,
  type OnElicitation,
  type ToolInvocationContext,
  type ToolMetadata,
  toTool,
  type ToolMap,
  type ToolPath,
} from "@executor-v3/codemode-core";
import {
  ExecutionIdSchema,
  ExecutionInteractionIdSchema,
  SourceSchema,
  type Source,
  type WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  type ExecutorAddSourceInput,
  type RuntimeSourceAuthService,
} from "./source-auth-service";
import {
  deriveSchemaJson,
  deriveSchemaTypeSignature,
} from "./schema-type-signature";

const ExecutorOpenApiSourceAuthInputSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("none"),
  }),
  Schema.Struct({
    kind: Schema.Literal("bearer"),
    headerName: Schema.optional(Schema.NullOr(Schema.String)),
    prefix: Schema.optional(Schema.NullOr(Schema.String)),
    token: Schema.optional(Schema.NullOr(Schema.String)),
    tokenEnvVar: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

const ExecutorMcpSourceAddInputSchema = Schema.Struct({
  kind: Schema.optional(Schema.Literal("mcp")),
  endpoint: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  namespace: Schema.optional(Schema.NullOr(Schema.String)),
});

const ExecutorOpenApiSourceAddInputSchema = Schema.Struct({
  kind: Schema.Literal("openapi"),
  endpoint: Schema.String,
  specUrl: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  namespace: Schema.optional(Schema.NullOr(Schema.String)),
  auth: Schema.optional(Schema.NullOr(ExecutorOpenApiSourceAuthInputSchema)),
});

const ExecutorSourcesAddSchema = Schema.Union(
  ExecutorMcpSourceAddInputSchema,
  ExecutorOpenApiSourceAddInputSchema,
);

const ExecutorSourcesAddInputSchema = Schema.standardSchemaV1(
  ExecutorSourcesAddSchema,
);

const ExecutorSourcesAddOutputSchema = Schema.standardSchemaV1(SourceSchema);

export const EXECUTOR_SOURCES_ADD_MCP_INPUT_SIGNATURE = deriveSchemaTypeSignature(
  ExecutorMcpSourceAddInputSchema,
  240,
);

export const EXECUTOR_SOURCES_ADD_OPENAPI_INPUT_SIGNATURE = deriveSchemaTypeSignature(
  ExecutorOpenApiSourceAddInputSchema,
  420,
);

export const EXECUTOR_SOURCES_ADD_INPUT_HINT = deriveSchemaTypeSignature(
  ExecutorSourcesAddInputSchema,
  320,
);

export const EXECUTOR_SOURCES_ADD_OUTPUT_SIGNATURE = deriveSchemaTypeSignature(
  SourceSchema,
  260,
);

export const EXECUTOR_SOURCES_ADD_INPUT_SCHEMA_JSON = JSON.stringify(
  deriveSchemaJson(ExecutorSourcesAddSchema) ?? {},
);

export const EXECUTOR_SOURCES_ADD_OUTPUT_SCHEMA_JSON = JSON.stringify(
  deriveSchemaJson(SourceSchema) ?? {},
);

export const EXECUTOR_SOURCES_ADD_HELP_LINES = [
  "Source add input shapes:",
  `- MCP: ${EXECUTOR_SOURCES_ADD_MCP_INPUT_SIGNATURE}`,
  '  Omit kind or set kind: "mcp". endpoint is the MCP server URL.',
  `- OpenAPI: ${EXECUTOR_SOURCES_ADD_OPENAPI_INPUT_SIGNATURE}`,
  "  endpoint is the base API URL. specUrl is the OpenAPI document URL.",
  "  If credentials are needed, executor prompts with form or URL interaction.",
] as const;

export const buildExecutorSourcesAddDescription = (): string =>
  [
    "Add an MCP or OpenAPI source to the current workspace.",
    ...EXECUTOR_SOURCES_ADD_HELP_LINES,
  ].join("\n");

const toExecutionId = (value: unknown) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Missing execution run id for executor.sources.add");
  }

  return ExecutionIdSchema.make(value);
};

const asToolPath = (value: string): ToolPath => value as ToolPath;

const trimOrNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveOpenApiSourceLabel = (input: {
  name?: string | null;
  endpoint: string;
}): string => trimOrNull(input.name) ?? input.endpoint;

const promptForBearerToken = (input: {
  args: Extract<ExecutorAddSourceInput, { kind: "openapi" }>;
  interactionId: string;
  path: ToolPath;
  sourceKey: string;
  metadata?: ToolMetadata;
  invocation?: ToolInvocationContext;
  onElicitation?: OnElicitation;
}) =>
  Effect.gen(function* () {
    if (!input.onElicitation) {
      return yield* Effect.fail(
        new Error("executor.sources.add requires an elicitation-capable host"),
      );
    }

    const response: ElicitationResponse = yield* input.onElicitation({
      interactionId: input.interactionId,
      path: input.path,
      sourceKey: input.sourceKey,
      args: input.args,
      metadata: input.metadata,
      context: input.invocation,
      elicitation: {
        mode: "form",
        message: `Enter the API token to connect ${resolveOpenApiSourceLabel(input.args)}`,
        requestedSchema: {
          type: "object",
          properties: {
            token: {
              type: "string",
              title: "API token",
            },
          },
          required: ["token"],
          additionalProperties: false,
        },
      },
    }).pipe(Effect.mapError((cause) => cause instanceof Error ? cause : new Error(String(cause))));

    if (response.action !== "accept") {
      return yield* Effect.fail(
        new Error(`Source add was not completed for ${resolveOpenApiSourceLabel(input.args)}`),
      );
    }

    const token =
      response.content && typeof response.content.token === "string"
        ? response.content.token.trim()
        : "";

    if (token.length === 0) {
      return yield* Effect.fail(
        new Error("API token was not provided for executor.sources.add"),
      );
    }

    return token;
  });

export const createExecutorToolMap = (input: {
  workspaceId: WorkspaceId;
  sourceAuthService: RuntimeSourceAuthService;
}): ToolMap => ({
  "executor.sources.add": toTool({
    tool: {
      description: buildExecutorSourcesAddDescription(),
      inputSchema: ExecutorSourcesAddInputSchema,
      outputSchema: ExecutorSourcesAddOutputSchema,
      execute: async (
        args:
          | {
              kind?: "mcp";
              endpoint: string;
              name?: string | null;
              namespace?: string | null;
            }
          | {
              kind: "openapi";
              endpoint: string;
              specUrl: string;
              name?: string | null;
              namespace?: string | null;
              auth?:
                | {
                    kind: "none";
                  }
                | {
                    kind: "bearer";
                    headerName?: string | null;
                    prefix?: string | null;
                    token?: string | null;
                    tokenEnvVar?: string | null;
                  }
                | null;
            },
        context,
      ): Promise<Source> => {
        const executionId = toExecutionId(context?.invocation?.runId);
        const interactionId = ExecutionInteractionIdSchema.make(
          `executor.sources.add:${crypto.randomUUID()}`,
        );
        const preparedArgs: ExecutorAddSourceInput =
          args.kind === "openapi"
            ? {
                ...args,
                workspaceId: input.workspaceId,
                executionId,
                interactionId,
                auth:
                  args.auth?.kind === "bearer"
                  && !trimOrNull(args.auth.token)
                  && !trimOrNull(args.auth.tokenEnvVar)
                    ? {
                        ...args.auth,
                        token: await Effect.runPromise(
                          promptForBearerToken({
                            args: {
                              ...args,
                              auth: args.auth,
                              workspaceId: input.workspaceId,
                              executionId,
                              interactionId,
                            },
                            interactionId,
                            path: context.path ?? asToolPath("executor.sources.add"),
                            sourceKey: context.sourceKey,
                            metadata: context.metadata,
                            invocation: context.invocation,
                            onElicitation: context.onElicitation,
                          }),
                        ),
                      }
                    : args.auth ?? null,
              }
            : {
                kind: args.kind,
                endpoint: args.endpoint,
                name: args.name ?? null,
                namespace: args.namespace ?? null,
                workspaceId: input.workspaceId,
                executionId,
                interactionId,
              };
        const result = await Effect.runPromise(
          input.sourceAuthService.addExecutorSource(
            preparedArgs,
            context?.onElicitation
              ? {
                  mcpDiscoveryElicitation: {
                    onElicitation: context.onElicitation,
                    path: context.path ?? asToolPath("executor.sources.add"),
                    sourceKey: context.sourceKey,
                    args,
                    metadata: context.metadata,
                    invocation: context.invocation,
                  },
                }
              : undefined,
          ),
        );

        if (result.kind === "connected") {
          return result.source;
        }

        if (!context?.onElicitation) {
          throw new Error("executor.sources.add requires an elicitation-capable host");
        }

        const response: ElicitationResponse = await Effect.runPromise(
          context.onElicitation({
            interactionId,
            path: context.path ?? asToolPath("executor.sources.add"),
            sourceKey: context.sourceKey,
            args: preparedArgs,
            metadata: context.metadata,
            context: context.invocation,
            elicitation: {
              mode: "url",
              message: `Open the provider sign-in page to connect ${result.source.name}`,
              url: result.authorizationUrl,
              elicitationId: result.sessionId,
            },
          }),
        );

        if (response.action !== "accept") {
          throw new Error(`Source add was not completed for ${result.source.id}`);
        }

        return await Effect.runPromise(
          input.sourceAuthService.getSourceById({
            workspaceId: input.workspaceId,
            sourceId: result.source.id,
          }),
        );
      },
    },
      metadata: {
        inputHint: EXECUTOR_SOURCES_ADD_INPUT_HINT,
        outputHint: EXECUTOR_SOURCES_ADD_OUTPUT_SIGNATURE,
        inputSchemaJson: EXECUTOR_SOURCES_ADD_INPUT_SCHEMA_JSON,
        outputSchemaJson: EXECUTOR_SOURCES_ADD_OUTPUT_SCHEMA_JSON,
        sourceKey: "executor",
        interaction: "auto",
      },
    }),
});
