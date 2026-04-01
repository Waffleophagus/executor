import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { ScopeId } from "@executor/sdk";

import {
  OpenApiParseError,
  OpenApiExtractionError,
} from "../errors";
import { SpecPreview } from "../preview";

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

const scopeIdParam = HttpApiSchema.param("scopeId", ScopeId);

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

const AddSpecPayload = Schema.Struct({
  spec: Schema.String,
  baseUrl: Schema.optional(Schema.String),
  namespace: Schema.optional(Schema.String),
  headers: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});

const PreviewSpecPayload = Schema.Struct({
  spec: Schema.String,
});

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const AddSpecResponse = Schema.Struct({
  toolCount: Schema.Number,
  namespace: Schema.String,
});

const ListSpecsResponse = Schema.Array(
  Schema.Struct({
    namespace: Schema.String,
    toolCount: Schema.Number,
  }),
);

// ---------------------------------------------------------------------------
// Errors with HTTP status
// ---------------------------------------------------------------------------

const ParseError = OpenApiParseError.annotations(
  HttpApiSchema.annotations({ status: 400 }),
);
const ExtractionError = OpenApiExtractionError.annotations(
  HttpApiSchema.annotations({ status: 400 }),
);

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

const namespaceParam = HttpApiSchema.param("namespace", Schema.String);

export class OpenApiGroup extends HttpApiGroup.make("openapi")
  .add(
    HttpApiEndpoint.post("previewSpec")`/scopes/${scopeIdParam}/openapi/preview`
      .setPayload(PreviewSpecPayload)
      .addSuccess(SpecPreview)
      .addError(ParseError)
      .addError(ExtractionError),
  )
  .add(
    HttpApiEndpoint.post("addSpec")`/scopes/${scopeIdParam}/openapi/specs`
      .setPayload(AddSpecPayload)
      .addSuccess(AddSpecResponse)
      .addError(ParseError)
      .addError(ExtractionError),
  )
  .add(
    HttpApiEndpoint.get("listSpecs")`/scopes/${scopeIdParam}/openapi/specs`
      .addSuccess(ListSpecsResponse),
  )
  .add(
    HttpApiEndpoint.del("removeSpec")`/scopes/${scopeIdParam}/openapi/specs/${namespaceParam}`
      .addSuccess(Schema.Struct({ removed: Schema.Boolean })),
  )
  .prefix("/v1") {}
