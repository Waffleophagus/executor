import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "./parse";
import { extract } from "./extract";
import { createExecutor, makeTestConfig } from "@executor/sdk";
import { openApiPlugin } from "./plugin";

// ---------------------------------------------------------------------------
// Load the Cloudflare OpenAPI spec (~9MB, 1729 paths)
// ---------------------------------------------------------------------------

const specPath = resolve(__dirname, "../fixtures/cloudflare.json");
const specText = readFileSync(specPath, "utf-8");

describe("Real specs: Cloudflare API", () => {
  it.effect("parses the full Cloudflare spec", () =>
    Effect.gen(function* () {
      const doc = yield* parse(specText);
      expect(doc).toBeDefined();
    }),
  );

  it.effect("extracts operations from the Cloudflare spec", () =>
    Effect.gen(function* () {
      const doc = yield* parse(specText);
      const result = yield* extract(doc);

      expect(Option.getOrElse(result.title, () => "")).toBe("Cloudflare API");
      expect(Option.getOrElse(result.version, () => "")).toBe("4.0.0");

      // Should extract thousands of operations
      expect(result.operations.length).toBeGreaterThan(1000);

      // Every operation has an operationId
      for (const op of result.operations) {
        expect(op.operationId).toBeTruthy();
      }

      // Every operation has a valid HTTP method
      const validMethods = new Set([
        "get", "post", "put", "delete", "patch", "head", "options", "trace",
      ]);
      for (const op of result.operations) {
        expect(validMethods.has(op.method)).toBe(true);
      }

      // Spot-check: there should be zone-related operations
      const zoneOps = result.operations.filter((op) =>
        op.pathTemplate.includes("/zones"),
      );
      expect(zoneOps.length).toBeGreaterThan(0);

      // Spot-check: there should be DNS record operations
      const dnsOps = result.operations.filter((op) =>
        op.pathTemplate.includes("/dns_records"),
      );
      expect(dnsOps.length).toBeGreaterThan(0);
    }),
  );

  it.effect("operations have input schemas", () =>
    Effect.gen(function* () {
      const doc = yield* parse(specText);
      const result = yield* extract(doc);

      // Most operations with parameters or request bodies should have input schemas
      const opsWithInput = result.operations.filter((op) =>
        Option.isSome(op.inputSchema),
      );
      expect(opsWithInput.length).toBeGreaterThan(500);
    }),
  );

  it.effect("operations have output schemas", () =>
    Effect.gen(function* () {
      const doc = yield* parse(specText);
      const result = yield* extract(doc);

      // Most GET operations should have output schemas
      const getOps = result.operations.filter((op) => op.method === "get");
      const getOpsWithOutput = getOps.filter((op) =>
        Option.isSome(op.outputSchema),
      );
      // At least half of GETs should have output schemas
      expect(getOpsWithOutput.length).toBeGreaterThan(getOps.length / 2);
    }),
  );

  it.effect("registers all operations as tools via the plugin", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [openApiPlugin()] as const,
        }),
      );

      const result = yield* executor.openapi.addSpec({
        spec: specText,
        namespace: "cloudflare",
      });

      expect(result.toolCount).toBeGreaterThan(1000);

      const tools = yield* executor.tools.list();
      expect(tools.length).toBe(result.toolCount);

      // All tools should be tagged
      for (const tool of tools) {
        expect(tool.tags).toContain("openapi");
        expect(tool.tags).toContain("cloudflare");
      }

      // Spot-check: can find zone list tool
      const zoneTools = yield* executor.tools.list({ query: "zone" });
      expect(zoneTools.length).toBeGreaterThan(0);
    }),
  );

  it.effect("removeSpec cleans up all Cloudflare tools", () =>
    Effect.gen(function* () {
      const executor = yield* createExecutor(
        makeTestConfig({
          plugins: [openApiPlugin()] as const,
        }),
      );

      yield* executor.openapi.addSpec({
        spec: specText,
        namespace: "cloudflare",
      });

      expect((yield* executor.tools.list()).length).toBeGreaterThan(0);

      yield* executor.openapi.removeSpec("cloudflare");

      expect(yield* executor.tools.list()).toHaveLength(0);
    }),
  );
});
