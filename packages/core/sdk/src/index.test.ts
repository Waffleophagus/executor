import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";

import {
  createExecutor,
  makeTestConfig,
  memoryPlugin,
  tool,
  FormElicitation,
  UrlElicitation,
  ElicitationResponse,
  type MemoryToolContext,
} from "./index";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GetItemInput = Schema.Struct({ itemId: Schema.Number });
const Item = Schema.Struct({ id: Schema.Number, name: Schema.String });
const EmptyInput = Schema.Struct({});
const LoginResult = Schema.Struct({ user: Schema.String, status: Schema.String });
const ConnectResult = Schema.Struct({ connected: Schema.Boolean, code: Schema.String });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SDK Executor", () => {
  it.effect("creates an executor with no plugins", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(makeTestConfig());
      expect(executor.scope.name).toBe("test");
      expect(yield* executor.tools.list()).toHaveLength(0);
    }),
  );

  it.effect("memory plugin registers tools and they are discoverable", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "inventory",
              tools: [
                tool({
                  name: "listItems",
                  description: "List all items",
                  inputSchema: EmptyInput,
                  outputSchema: Schema.Array(Item),
                  handler: () => [
                    { id: 1, name: "Widget" },
                    { id: 2, name: "Gadget" },
                  ],
                }),
                tool({
                  name: "getItem",
                  description: "Get an item by ID",
                  inputSchema: GetItemInput,
                  outputSchema: Item,
                  handler: ({ itemId }: { itemId: number }) => ({ id: itemId, name: "Widget" }),
                }),
              ],
            }),
          ] as const,
        }),
      );

      const tools = yield* executor.tools.list();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("listItems");
      expect(tools.map((t) => t.name)).toContain("getItem");
    }),
  );

  it.effect("invokes a tool with typed args", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "inventory",
              tools: [
                tool({
                  name: "getItem",
                  inputSchema: GetItemInput,
                  outputSchema: Item,
                  handler: ({ itemId }: { itemId: number }) => ({ id: itemId, name: "Widget" }),
                }),
              ],
            }),
          ] as const,
        }),
      );

      const result = yield* executor.tools.invoke("inventory.getItem", { itemId: 42 });
      expect(result.data).toEqual({ id: 42, name: "Widget" });
      expect(result.error).toBeNull();
    }),
  );

  it.effect("validates input against schema", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "inventory",
              tools: [
                tool({
                  name: "getItem",
                  inputSchema: GetItemInput,
                  handler: ({ itemId }: { itemId: number }) => ({ id: itemId }),
                }),
              ],
            }),
          ] as const,
        }),
      );

      const exit = yield* executor.tools
        .invoke("inventory.getItem", { itemId: "not-a-number" })
        .pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      const error = yield* Effect.flip(
        executor.tools.invoke("inventory.getItem", { itemId: "not-a-number" }),
      );
      expect(error._tag).toBe("ToolInvocationError");
    }),
  );

  it.effect("tool invocation fails for unknown tool", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(makeTestConfig());
      const error = yield* Effect.flip(
        executor.tools.invoke("nonexistent", {}),
      );
      expect(error._tag).toBe("ToolNotFoundError");
    }),
  );

  it.effect("filters tools by query", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "store",
              tools: [
                tool({
                  name: "listItems",
                  description: "List all items",
                  inputSchema: EmptyInput,
                  handler: () => [],
                }),
                tool({
                  name: "createOrder",
                  description: "Create an order",
                  inputSchema: EmptyInput,
                  handler: () => ({}),
                }),
              ],
            }),
          ] as const,
        }),
      );

      const itemTools = yield* executor.tools.list({ query: "item" });
      expect(itemTools).toHaveLength(1);
      expect(itemTools[0]!.name).toBe("listItems");

      const orderTools = yield* executor.tools.list({ query: "order" });
      expect(orderTools).toHaveLength(1);
      expect(orderTools[0]!.name).toBe("createOrder");
    }),
  );

  it.effect("plugin extension is typed and accessible", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({ namespace: "runtime", tools: [] }),
          ] as const,
        }),
      );

      expect(executor.memory).toBeDefined();
      expect(typeof executor.memory.addTools).toBe("function");

      yield* executor.memory.addTools([
        tool({
          name: "dynamicTool",
          description: "Added at runtime",
          inputSchema: EmptyInput,
          handler: () => "dynamic result",
        }),
      ]);

      const tools = yield* executor.tools.list();
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe("dynamicTool");

      const result = yield* executor.tools.invoke("runtime.dynamicTool", {});
      expect(result.data).toBe("dynamic result");
    }),
  );

  it.effect("stores and lists secrets", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(makeTestConfig());

      const secret = yield* executor.secrets.store({
        name: "API Key",
        value: "sk_test_123",
        purpose: "auth",
      });
      expect(secret.name).toBe("API Key");

      const listed = yield* executor.secrets.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.name).toBe("API Key");
    }),
  );

  it.effect("form elicitation: tool collects user input mid-invocation", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "auth",
              tools: [
                tool({
                  name: "login",
                  inputSchema: EmptyInput,
                  outputSchema: LoginResult,
                  handler: (_, ctx: MemoryToolContext) =>
                    Effect.gen(function* () {
                      const creds = yield* ctx.elicit(
                        new FormElicitation({
                          message: "Enter credentials",
                          requestedSchema: {
                            type: "object",
                            properties: {
                              username: { type: "string" },
                              password: { type: "string" },
                            },
                          },
                        }),
                      );
                      return {
                        user: creds.username as string,
                        status: "logged_in",
                      };
                    }),
                }),
              ],
            }),
          ] as const,
        }),
      );

      const result = yield* executor.tools.invoke("auth.login", {}, {
        onElicitation: () =>
          Effect.succeed(
            new ElicitationResponse({
              action: "accept",
              content: { username: "alice", password: "secret" },
            }),
          ),
      });

      expect(result.data).toEqual({ user: "alice", status: "logged_in" });
    }),
  );

  it.effect("elicitation declined returns error", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "auth",
              tools: [
                tool({
                  name: "login",
                  inputSchema: EmptyInput,
                  handler: (_, ctx: MemoryToolContext) =>
                    ctx.elicit(
                      new FormElicitation({
                        message: "Enter credentials",
                        requestedSchema: {},
                      }),
                    ),
                }),
              ],
            }),
          ] as const,
        }),
      );

      const error = yield* Effect.flip(
        executor.tools.invoke("auth.login", {}, {
          onElicitation: () =>
            Effect.succeed(new ElicitationResponse({ action: "decline" })),
        }),
      );

      expect(error._tag).toBe("ElicitationDeclinedError");
    }),
  );

  it.effect("elicitation with no handler auto-declines", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "auth",
              tools: [
                tool({
                  name: "login",
                  inputSchema: EmptyInput,
                  handler: (_, ctx: MemoryToolContext) =>
                    ctx.elicit(
                      new FormElicitation({
                        message: "Need input",
                        requestedSchema: {},
                      }),
                    ),
                }),
              ],
            }),
          ] as const,
        }),
      );

      const error = yield* Effect.flip(
        executor.tools.invoke("auth.login", {}),
      );
      expect(error._tag).toBe("ElicitationDeclinedError");
    }),
  );

  it.effect("url elicitation: tool requests URL visit", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "oauth",
              tools: [
                tool({
                  name: "connect",
                  inputSchema: EmptyInput,
                  outputSchema: ConnectResult,
                  handler: (_, ctx: MemoryToolContext) =>
                    Effect.gen(function* () {
                      const result = yield* ctx.elicit(
                        new UrlElicitation({
                          message: "Please authorize the app",
                          url: "https://oauth.example.com/authorize?state=abc",
                          elicitationId: "oauth-abc",
                        }),
                      );
                      return { connected: true, code: result.code as string };
                    }),
                }),
              ],
            }),
          ] as const,
        }),
      );

      const result = yield* executor.tools.invoke("oauth.connect", {}, {
        onElicitation: (ctx) => {
          expect(ctx.request._tag).toBe("UrlElicitation");
          return Effect.succeed(
            new ElicitationResponse({
              action: "accept",
              content: { code: "auth-code-123" },
            }),
          );
        },
      });

      expect(result.data).toEqual({ connected: true, code: "auth-code-123" });
    }),
  );

  it.effect("plugin reads and writes secrets through the SDK", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "vault",
              tools: [
                tool({
                  name: "rotateKey",
                  inputSchema: Schema.Struct({
                    secretName: Schema.String,
                    newValue: Schema.String,
                  }),
                  outputSchema: Schema.Struct({
                    oldValue: Schema.String,
                    newValue: Schema.String,
                  }),
                  handler: (
                    { secretName, newValue },
                    ctx: MemoryToolContext,
                  ) =>
                    Effect.gen(function* () {
                      // Read the current secrets
                      const secrets = yield* ctx.sdk.secrets.list();
                      const existing = secrets.find(
                        (s) => s.name === secretName,
                      );

                      let oldValue = "<none>";
                      if (existing) {
                        oldValue = yield* ctx.sdk.secrets.resolve(
                          existing.id,
                        );
                        yield* ctx.sdk.secrets.remove(existing.id);
                      }

                      // Store the new value
                      yield* ctx.sdk.secrets.store({
                        name: secretName,
                        value: newValue,
                        purpose: "api_key",
                      });

                      return { oldValue, newValue };
                    }),
                }),
              ],
            }),
          ] as const,
        }),
      );

      // 1. Write initial secret
      yield* executor.secrets.store({
        name: "DB_PASSWORD",
        value: "hunter2",
        purpose: "database",
      });

      // Verify it's there
      const before = yield* executor.secrets.list();
      expect(before).toHaveLength(1);
      expect(before[0]!.name).toBe("DB_PASSWORD");

      // 2 + 3. Invoke tool that reads the old secret and writes a new one
      const result = yield* executor.tools.invoke("vault.rotateKey", {
        secretName: "DB_PASSWORD",
        newValue: "correct-horse-battery-staple",
      });

      // 4. Verify the tool returned old and new values
      expect(result.data).toEqual({
        oldValue: "hunter2",
        newValue: "correct-horse-battery-staple",
      });

      // 5. Read the updated secret store — should have the new value
      const after = yield* executor.secrets.list();
      expect(after).toHaveLength(1);
      expect(after[0]!.name).toBe("DB_PASSWORD");
    }),
  );

  it.effect("close cleans up plugin resources", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [
            memoryPlugin({
              namespace: "temp",
              tools: [
                tool({
                  name: "ephemeral",
                  inputSchema: EmptyInput,
                  handler: () => "here",
                }),
              ],
            }),
          ] as const,
        }),
      );

      expect(yield* executor.tools.list()).toHaveLength(1);
      yield* executor.close();
      expect(yield* executor.tools.list()).toHaveLength(0);
    }),
  );
});
