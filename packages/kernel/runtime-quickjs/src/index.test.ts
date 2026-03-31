import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ToolInvoker } from "@executor/codemode-core";
import { makeQuickJsExecutor } from "./index";

const makeTestInvoker = (
  handlers: Record<string, (args: unknown) => unknown>,
): ToolInvoker => ({
  invoke: ({ path, args }) => {
    const handler = handlers[path];
    if (!handler) {
      return Effect.fail(new Error(`Unknown tool: ${path}`));
    }
    return Effect.try(() => handler(args));
  },
});

const executor = makeQuickJsExecutor({ timeoutMs: 5_000 });

describe("quickjs executor", () => {
  it.effect("runs plain code", () =>
    Effect.gen(function* () {
      const result = yield* executor.execute(
        `return 1 + 2`,
        makeTestInvoker({}),
      );
      expect(result.result).toBe(3);
      expect(result.error).toBeUndefined();
    }),
  );

  it.effect("invokes a tool and returns its result", () =>
    Effect.gen(function* () {
      const invoker = makeTestInvoker({
        "math.add": (args: any) => ({
          sum: args.a + args.b,
        }),
      });

      const result = yield* executor.execute(
        `
        const res = await tools.math.add({ a: 5, b: 3 });
        return res.sum;
        `,
        invoker,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe(8);
    }),
  );

  it.effect("invokes multiple tools in sequence", () =>
    Effect.gen(function* () {
      const invoker = makeTestInvoker({
        "users.get": (args: any) => ({
          id: args.id,
          name: `User ${args.id}`,
        }),
        "users.greet": (args: any) => ({
          message: `Hello, ${args.name}!`,
        }),
      });

      const result = yield* executor.execute(
        `
        const user = await tools.users.get({ id: 42 });
        const greeting = await tools.users.greet({ name: user.name });
        return greeting.message;
        `,
        invoker,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe("Hello, User 42!");
    }),
  );

  it.effect("handles tool errors", () =>
    Effect.gen(function* () {
      const invoker = makeTestInvoker({
        "db.query": () => {
          throw new Error("connection refused");
        },
      });

      const result = yield* executor.execute(
        `
        try {
          await tools.db.query({ sql: "SELECT 1" });
          return "should not reach";
        } catch (e) {
          return "caught: " + e.message;
        }
        `,
        invoker,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toContain("caught:");
    }),
  );

  it.effect("handles unknown tool path", () =>
    Effect.gen(function* () {
      const invoker = makeTestInvoker({});

      const result = yield* executor.execute(
        `
        try {
          await tools.nonexistent.thing({ x: 1 });
          return "should not reach";
        } catch (e) {
          return "caught: " + e.message;
        }
        `,
        invoker,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toContain("caught:");
    }),
  );

  it.effect("captures console.log output", () =>
    Effect.gen(function* () {
      const result = yield* executor.execute(
        `
        console.log("hello from sandbox");
        console.warn("a warning");
        return "done";
        `,
        makeTestInvoker({}),
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toBe("done");
      expect(result.logs).toContainEqual("[log] hello from sandbox");
      expect(result.logs).toContainEqual("[warn] a warning");
    }),
  );

  it.effect("passes tool result into next tool call", () =>
    Effect.gen(function* () {
      const invoker = makeTestInvoker({
        "stripe.customers.list": () => ({
          data: [
            { id: "cus_1", email: "alice@example.com" },
            { id: "cus_2", email: "bob@example.com" },
          ],
        }),
        "stripe.invoices.create": (args: any) => ({
          id: "inv_1",
          customer: args.customer,
          amount: args.amount,
        }),
      });

      const result = yield* executor.execute(
        `
        const customers = await tools.stripe.customers.list();
        const invoice = await tools.stripe.invoices.create({
          customer: customers.data[0].id,
          amount: 5000,
        });
        return invoice;
        `,
        invoker,
      );

      expect(result.error).toBeUndefined();
      expect(result.result).toEqual({
        id: "inv_1",
        customer: "cus_1",
        amount: 5000,
      });
    }),
  );
});
