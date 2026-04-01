// Re-export effect-atom essentials so consumers don't need direct deps
export {
  Atom,
  AtomHttpApi,
  Result,
  RegistryContext,
  RegistryProvider,
  useAtom,
  useAtomMount,
  useAtomRefresh,
  useAtomSet,
  useAtomSuspense,
  useAtomValue,
} from "@effect-atom/atom-react";

// Base URL management
export { getBaseUrl, setBaseUrl } from "./base-url";

// Typed API client
export { ExecutorApiClient } from "./client";

// Query & mutation atoms
export {
  toolsAtom,
  toolSchemaAtom,
  secretsAtom,
  secretStatusAtom,
  invokeTool,
  setSecret,
  removeSecret,
} from "./atoms";

// Provider
export { ExecutorProvider } from "./provider";

// Plugin contracts
export type { SourcePlugin } from "./source-plugin";
