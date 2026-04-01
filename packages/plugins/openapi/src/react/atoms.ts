import { ScopeId } from "@executor/sdk";

import { OpenApiClient } from "./client";

// ---------------------------------------------------------------------------
// Default scope
// ---------------------------------------------------------------------------

const DEFAULT_SCOPE = ScopeId.make("default");

// ---------------------------------------------------------------------------
// Query atoms
// ---------------------------------------------------------------------------

export const openApiSpecsAtom = (scopeId: ScopeId = DEFAULT_SCOPE) =>
  OpenApiClient.query("openapi", "listSpecs", {
    path: { scopeId },
    timeToLive: "30 seconds",
  });

// ---------------------------------------------------------------------------
// Mutation atoms
// ---------------------------------------------------------------------------

export const previewOpenApiSpec = OpenApiClient.mutation(
  "openapi",
  "previewSpec",
);

export const addOpenApiSpec = OpenApiClient.mutation("openapi", "addSpec");

export const removeOpenApiSpec = OpenApiClient.mutation(
  "openapi",
  "removeSpec",
);
