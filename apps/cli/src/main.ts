import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command, Options } from "@effect/cli";
import { FetchHttpClient } from "@effect/platform";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { ControlPlaneApi } from "@executor-v2/management-api";
import { makeControlPlaneClient } from "@executor-v2/management-api/client";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type EndpointCommand, fromApi } from "./http-api-cli";

type ExecutorTarget = "local" | "cloud";

type ExecutorCliConfig = {
  target?: ExecutorTarget;
  cloudBaseUrl?: string;
  cloudToken?: string;
  cloudRefreshToken?: string;
  cloudAuthClientId?: string;
  cloudAuthBaseUrl?: string;
  workspaceId?: string;
};

type RequestOptions = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
};

type WorkspaceRecord = {
  id: string;
};

type DeviceAuthorizationResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

type CloudAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  organization_id?: string;
  user?: {
    id?: string;
    email?: string;
  };
};

type CommonTargetOptions = {
  target: Option.Option<ExecutorTarget>;
  workspace: Option.Option<string>;
  baseUrl: Option.Option<string>;
  json: boolean;
};

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8788";
const DEFAULT_WORKOS_AUTH_BASE_URL = "https://api.workos.com";
const CONFIG_PATH = join(homedir(), ".config", "executor", "cli.json");

const controlPlaneCli = fromApi(ControlPlaneApi);

const toErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const trimTrailingSlash = (input: string): string =>
  input.endsWith("/") ? input.slice(0, -1) : input;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const optionToUndefined = <A>(option: Option.Option<A>): A | undefined =>
  Option.getOrUndefined(option);

const cleanEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
};

const openInBrowser = (url: string): void => {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  Bun.spawn({
    cmd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
};

const printOutput = (value: unknown, asJson: boolean): void => {
  if (asJson) {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      stdout.write("(empty)\n");
      return;
    }

    for (const item of value) {
      stdout.write(`${JSON.stringify(item)}\n`);
    }
    return;
  }

  if (typeof value === "object" && value !== null) {
    stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  stdout.write(`${String(value)}\n`);
};

const safeParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const isTarget = (value: string | undefined): value is ExecutorTarget =>
  value === "local" || value === "cloud";

const loadConfig = async (): Promise<ExecutorCliConfig> => {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) {
    return {};
  }

  try {
    const parsed = JSON.parse(await file.text()) as ExecutorCliConfig;
    return {
      ...(isTarget(parsed.target) ? { target: parsed.target } : {}),
      ...(typeof parsed.cloudBaseUrl === "string"
        ? { cloudBaseUrl: parsed.cloudBaseUrl }
        : {}),
      ...(typeof parsed.cloudToken === "string" ? { cloudToken: parsed.cloudToken } : {}),
      ...(typeof parsed.cloudRefreshToken === "string"
        ? { cloudRefreshToken: parsed.cloudRefreshToken }
        : {}),
      ...(typeof parsed.cloudAuthClientId === "string"
        ? { cloudAuthClientId: parsed.cloudAuthClientId }
        : {}),
      ...(typeof parsed.cloudAuthBaseUrl === "string"
        ? { cloudAuthBaseUrl: parsed.cloudAuthBaseUrl }
        : {}),
      ...(typeof parsed.workspaceId === "string" ? { workspaceId: parsed.workspaceId } : {}),
    };
  } catch {
    return {};
  }
};

const saveConfig = async (config: ExecutorCliConfig): Promise<void> => {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await Bun.write(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
};

const pickTarget = async (
  config: ExecutorCliConfig,
  explicit?: ExecutorTarget,
): Promise<ExecutorTarget> => {
  if (explicit) {
    return explicit;
  }

  if (config.target) {
    return config.target;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    return "local";
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(
      "First run: connect Executor to local or cloud? [local/cloud] (default: local) ",
    ))
      .trim()
      .toLowerCase();
    return answer === "cloud" ? "cloud" : "local";
  } finally {
    rl.close();
  }
};

const promptCloudConfig = async (
  existing: ExecutorCliConfig,
): Promise<Pick<ExecutorCliConfig, "cloudBaseUrl" | "cloudToken">> => {
  if (!stdin.isTTY || !stdout.isTTY) {
    return {
      cloudBaseUrl: existing.cloudBaseUrl,
      cloudToken: existing.cloudToken,
    };
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const urlAnswer = (await rl.question(
      `Cloud base URL${existing.cloudBaseUrl ? ` [${existing.cloudBaseUrl}]` : ""}: `,
    )).trim();
    const tokenAnswer = (await rl.question(
      `Cloud bearer token${existing.cloudToken ? " [saved]" : ""} (optional): `,
    )).trim();

    return {
      cloudBaseUrl: urlAnswer.length > 0 ? urlAnswer : existing.cloudBaseUrl,
      cloudToken: tokenAnswer.length > 0 ? tokenAnswer : existing.cloudToken,
    };
  } finally {
    rl.close();
  }
};

class ExecutorServerClient {
  readonly #target: ExecutorTarget;
  readonly #config: ExecutorCliConfig;
  readonly #baseUrlOverride?: string;
  #localProcess: Bun.Subprocess | null = null;

  constructor(target: ExecutorTarget, config: ExecutorCliConfig, baseUrlOverride?: string) {
    this.#target = target;
    this.#config = config;
    this.#baseUrlOverride = baseUrlOverride?.trim();
  }

  async close(): Promise<void> {
    if (!this.#localProcess) {
      return;
    }

    this.#localProcess.kill();
    await this.#localProcess.exited.catch(() => undefined);
    this.#localProcess = null;
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const baseUrl = await this.#resolveBaseUrl();
    const url = `${baseUrl}${options.path}`;
    const headers = this.#buildHeaders();
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const payload = text.length === 0 ? null : safeParseJson(text);

    if (!response.ok) {
      const detail =
        typeof payload === "object" && payload && "error" in payload
          ? String((payload as { error: unknown }).error)
          : text;
      throw new Error(
        `Request failed (${response.status} ${response.statusText}) for ${options.method} ${options.path}${detail ? `: ${detail}` : ""}`,
      );
    }

    return payload as T;
  }

  async runControlPlane<T>(
    operation: (client: any) => Effect.Effect<T, unknown>,
  ): Promise<T> {
    const baseUrl = await this.#resolveBaseUrl();
    const headers = this.#buildHeaders();

    const program = Effect.gen(function* () {
      const client = yield* makeControlPlaneClient({ baseUrl, headers });
      return yield* operation(client);
    });

    return Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)));
  }

  #buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.#target === "cloud") {
      const token =
        process.env.EXECUTOR_CLOUD_TOKEN?.trim()
        || this.#config.cloudToken?.trim()
        || undefined;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      return headers;
    }

    headers["x-executor-account-id"] =
      process.env.EXECUTOR_LOCAL_ACCOUNT_ID?.trim() || "acct_local";
    return headers;
  }

  async #resolveBaseUrl(): Promise<string> {
    if (this.#baseUrlOverride && this.#baseUrlOverride.length > 0) {
      return trimTrailingSlash(this.#baseUrlOverride);
    }

    if (this.#target === "cloud") {
      const cloudBaseUrl =
        process.env.EXECUTOR_CLOUD_URL?.trim()
        || this.#config.cloudBaseUrl?.trim()
        || "";
      if (cloudBaseUrl.length === 0) {
        throw new Error(
          "Cloud target selected but no base URL configured. Set EXECUTOR_CLOUD_URL or run `executor init --target cloud --cloud-url <url>`.",
        );
      }
      return trimTrailingSlash(cloudBaseUrl);
    }

    const localBaseUrl =
      process.env.EXECUTOR_LOCAL_URL?.trim() || DEFAULT_LOCAL_BASE_URL;

    if (await this.#isHealthy(localBaseUrl)) {
      return localBaseUrl;
    }

    await this.#spawnLocalServer(localBaseUrl);
    return localBaseUrl;
  }

  async #isHealthy(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(800),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async #spawnLocalServer(baseUrl: string): Promise<void> {
    if (this.#localProcess) {
      return;
    }

    const pmDir = resolve(import.meta.dir, "..", "..", "pm");
    const bunBinary = process.execPath;
    const candidateMain = resolve(pmDir, "src", "main.ts");

    this.#localProcess = Bun.spawn({
      cmd: [bunBinary, candidateMain],
      cwd: pmDir,
      env: cleanEnv(),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });

    const started = await this.#waitForHealthy(baseUrl, 10000);
    if (started) {
      return;
    }

    let stderrText = "";
    if (this.#localProcess.stderr && typeof this.#localProcess.stderr !== "number") {
      stderrText = (await new Response(this.#localProcess.stderr).text()).trim();
    }

    const exitCode = await this.#localProcess.exited.catch(() => undefined);
    this.#localProcess = null;
    throw new Error(
      `Failed to start local Executor server subprocess.${typeof exitCode === "number" ? ` Exit code: ${exitCode}.` : ""}${stderrText.length > 0 ? ` ${stderrText}` : ""}`,
    );
  }

  async #waitForHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.#isHealthy(baseUrl)) {
        return true;
      }

      if (this.#localProcess && typeof this.#localProcess.exitCode === "number") {
        return false;
      }

      await sleep(200);
    }

    return false;
  }
}

const ensureWorkspaceId = async (
  client: ExecutorServerClient,
  config: ExecutorCliConfig,
  workspaceOverride?: string,
): Promise<string> => {
  if (workspaceOverride && workspaceOverride.trim().length > 0) {
    return workspaceOverride.trim();
  }

  if (config.workspaceId && config.workspaceId.trim().length > 0) {
    return config.workspaceId;
  }

  const workspaces = await client.runControlPlane((api) =>
    api.workspaces.list({}),
  ) as Array<WorkspaceRecord>;

  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error("No workspaces available. Create one first through the control plane API.");
  }

  const workspaceId = workspaces[0].id;
  config.workspaceId = workspaceId;
  await saveConfig(config);
  return workspaceId;
};

const deriveSourceName = (kind: string, endpoint: string): string => {
  try {
    const url = new URL(endpoint);
    const host = url.hostname.replace(/^api\./, "");
    return `${kind}:${host}`;
  } catch {
    return `${kind}:source`;
  }
};

const postForm = async (
  url: string,
  params: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; payload: unknown }> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  const payload = text.length === 0 ? null : safeParseJson(text);
  return { ok: response.ok, status: response.status, payload };
};

const requestDeviceAuthorization = async (
  authBaseUrl: string,
  clientId: string,
): Promise<DeviceAuthorizationResponse> => {
  const url = `${trimTrailingSlash(authBaseUrl)}/user_management/authorize/device`;
  const response = await postForm(url, { client_id: clientId }, 15000);

  if (!response.ok || !response.payload || typeof response.payload !== "object") {
    throw new Error(
      `Device authorization failed (${response.status}): ${JSON.stringify(response.payload)}`,
    );
  }

  const payload = response.payload as Record<string, unknown>;
  const deviceCode = typeof payload.device_code === "string" ? payload.device_code : null;
  const userCode = typeof payload.user_code === "string" ? payload.user_code : null;
  const verificationUri =
    typeof payload.verification_uri === "string" ? payload.verification_uri : null;
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : null;
  const interval = typeof payload.interval === "number" ? payload.interval : null;

  if (!deviceCode || !userCode || !verificationUri || !expiresIn || !interval) {
    throw new Error("Device authorization response missing required fields.");
  }

  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete:
      typeof payload.verification_uri_complete === "string"
        ? payload.verification_uri_complete
        : undefined,
    expires_in: expiresIn,
    interval,
  };
};

const pollForCloudTokens = async (input: {
  authBaseUrl: string;
  clientId: string;
  deviceCode: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}): Promise<CloudAuthTokenResponse> => {
  const url = `${trimTrailingSlash(input.authBaseUrl)}/user_management/authenticate`;
  const startedAt = Date.now();
  let pollIntervalSeconds = Math.max(1, input.intervalSeconds);

  while (Date.now() - startedAt < input.expiresInSeconds * 1000) {
    const response = await postForm(
      url,
      {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: input.deviceCode,
        client_id: input.clientId,
      },
      20000,
    );

    if (response.ok && response.payload && typeof response.payload === "object") {
      const payload = response.payload as Record<string, unknown>;
      if (typeof payload.access_token === "string") {
        return {
          access_token: payload.access_token,
          ...(typeof payload.refresh_token === "string"
            ? { refresh_token: payload.refresh_token }
            : {}),
          ...(typeof payload.organization_id === "string"
            ? { organization_id: payload.organization_id }
            : {}),
          ...(payload.user && typeof payload.user === "object"
            ? {
                user: {
                  ...(typeof (payload.user as Record<string, unknown>).id === "string"
                    ? { id: (payload.user as Record<string, unknown>).id as string }
                    : {}),
                  ...(typeof (payload.user as Record<string, unknown>).email === "string"
                    ? { email: (payload.user as Record<string, unknown>).email as string }
                    : {}),
                },
              }
            : {}),
        };
      }
    }

    const errorCode =
      response.payload && typeof response.payload === "object"
        ? (response.payload as { error?: unknown }).error
        : undefined;

    if (errorCode === "authorization_pending") {
      await sleep(pollIntervalSeconds * 1000);
      continue;
    }

    if (errorCode === "slow_down") {
      pollIntervalSeconds += 1;
      await sleep(pollIntervalSeconds * 1000);
      continue;
    }

    if (errorCode === "access_denied") {
      throw new Error("Authentication denied.");
    }

    if (errorCode === "expired_token") {
      throw new Error("Authentication timed out.");
    }

    throw new Error(
      `Authentication failed (${response.status}): ${JSON.stringify(response.payload)}`,
    );
  }

  throw new Error("Authentication timed out waiting for authorization.");
};

const withClient = async (
  common: CommonTargetOptions,
  execute: (input: {
    client: ExecutorServerClient;
    config: ExecutorCliConfig;
    workspaceOverride?: string;
    asJson: boolean;
  }) => Promise<void>,
): Promise<void> => {
  const config = await loadConfig();
  const explicitTarget = optionToUndefined(common.target);
  const target = await pickTarget(config, explicitTarget);
  if (!config.target && !explicitTarget) {
    config.target = target;
    await saveConfig(config);
  }
  const client = new ExecutorServerClient(
    target,
    config,
    optionToUndefined(common.baseUrl),
  );

  try {
    await execute({
      client,
      config,
      workspaceOverride: optionToUndefined(common.workspace),
      asJson: common.json,
    });
  } finally {
    await client.close();
  }
};

const commonTargetOptions = () => ({
  target: Options.choice("target", ["local", "cloud"]).pipe(Options.optional),
  workspace: Options.text("workspace").pipe(Options.optional),
  baseUrl: Options.text("base-url").pipe(Options.optional),
  json: Options.boolean("json"),
});

const toKebabCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  if (Option.isOption(value) && Option.isSome(value)) {
    const some = value as Option.Some<unknown>;
    return typeof some.value === "string" ? some.value : undefined;
  }

  return undefined;
};

const runGeneratedEndpoint = (
  endpoint: EndpointCommand,
  values: Record<string, unknown>,
): Effect.Effect<void, string> =>
  Effect.tryPromise({
    try: async () => {
      const common = {
        target: values.target as Option.Option<ExecutorTarget>,
        workspace: values.workspace as Option.Option<string>,
        baseUrl: values.baseUrl as Option.Option<string>,
        json: values.json === true,
      } satisfies CommonTargetOptions;

      await withClient(common, async ({ client, config, workspaceOverride, asJson }) => {
        const flags: Record<string, string | boolean> = {};
        for (const field of [
          ...endpoint.pathFields,
          ...endpoint.payloadFields,
          ...endpoint.urlParamFields,
        ]) {
          const raw = readOptionalString(values[field.name]);
          if (raw !== undefined) {
            flags[field.name] = raw;
          }
        }

        const payloadJson = readOptionalString(values.payloadJson);
        if (payloadJson !== undefined) {
          flags["payload-json"] = payloadJson;
        }

        const handled = await controlPlaneCli.execute({
          groupName: endpoint.groupName,
          endpointName: endpoint.endpointCliName,
          flags,
          resolveDefaultPathValue: async (name) => {
            if (name === "workspaceId") {
              return ensureWorkspaceId(client, config, workspaceOverride);
            }
            return undefined;
          },
          invoke: ({ command, request }) =>
            client.runControlPlane((api: any) => {
              const groupApi = api[command.groupName] as Record<string, unknown> | undefined;
              const endpointFn = groupApi?.[command.endpointName];
              if (typeof endpointFn !== "function") {
                return Effect.dieMessage(
                  `Endpoint not found on client: ${command.groupName}.${command.endpointName}`,
                );
              }
              return (endpointFn as (input: Record<string, unknown>) => Effect.Effect<unknown>)(
                request,
              );
            }),
          print: (value) => printOutput(value, asJson),
        });

        if (!handled) {
          throw new Error(
            `Unhandled generated endpoint: ${endpoint.groupName}.${endpoint.endpointCliName}`,
          );
        }
      });
    },
    catch: toErrorMessage,
  });

const makeGeneratedEndpointCommand = (endpoint: EndpointCommand): Command.Command<any, any, any, any> => {
  const optionConfig: Record<string, unknown> = {
    ...commonTargetOptions(),
    ...(endpoint.hasPayloadSchema
      ? { payloadJson: Options.text("payload-json").pipe(Options.optional) }
      : {}),
  };

  const requiredFlags: Array<string> = [];

  const allFields = [
    ...endpoint.pathFields,
    ...endpoint.payloadFields,
    ...endpoint.urlParamFields,
  ];

  for (const field of allFields) {
    const optionName = toKebabCase(field.name);
    const canFallbackToCurrentWorkspace =
      field.name === "workspaceId" && endpoint.pathFields.some((pathField) => pathField.name === "workspaceId");
    const required = !field.optional && !canFallbackToCurrentWorkspace;

    optionConfig[field.name] = required
      ? Options.text(optionName)
      : Options.text(optionName).pipe(Options.optional);

    if (required) {
      requiredFlags.push(`--${optionName}`);
    }
  }

  const description =
    requiredFlags.length > 0
      ? `${endpoint.method} ${endpoint.path} | required: ${requiredFlags.join(" ")}`
      : `${endpoint.method} ${endpoint.path}`;

  return Command.make(
    endpoint.endpointCliName,
    optionConfig as any,
    (values) => runGeneratedEndpoint(endpoint, values as Record<string, unknown>),
  ).pipe(
    Command.withDescription(description),
  );
};

const generatedByGroup = new Map<string, Array<EndpointCommand>>();
for (const endpoint of controlPlaneCli.commands) {
  const existing = generatedByGroup.get(endpoint.groupName) ?? [];
  existing.push(endpoint);
  generatedByGroup.set(endpoint.groupName, existing);
}

const authStatusCommand = Command.make("status", { json: Options.boolean("json") }, ({ json }) =>
  Effect.tryPromise({
    try: async () => {
      const config = await loadConfig();
      printOutput(
        {
          target: config.target ?? null,
          authenticatedForCloud: Boolean(config.cloudToken?.trim()),
          cloudBaseUrl: config.cloudBaseUrl ?? null,
          cloudAuthClientId: config.cloudAuthClientId ?? null,
          cloudAuthBaseUrl: config.cloudAuthBaseUrl ?? null,
        },
        json,
      );
    },
    catch: toErrorMessage,
  }),
);

const authLoginCommand = Command.make(
  "login",
  {
    clientId: Options.text("client-id").pipe(Options.optional),
    authBaseUrl: Options.text("auth-base-url").pipe(Options.optional),
    noBrowser: Options.boolean("no-browser"),
    json: Options.boolean("json"),
  },
  ({ clientId, authBaseUrl, noBrowser, json }) =>
    Effect.tryPromise({
      try: async () => {
        const config = await loadConfig();
        const resolvedClientId =
          optionToUndefined(clientId)
          || process.env.EXECUTOR_CLOUD_AUTH_CLIENT_ID
          || process.env.WORKOS_CLIENT_ID
          || config.cloudAuthClientId;

        if (!resolvedClientId) {
          throw new Error(
            "Cloud auth requires a client id. Pass --client-id or set EXECUTOR_CLOUD_AUTH_CLIENT_ID (or WORKOS_CLIENT_ID).",
          );
        }

        const resolvedAuthBaseUrl =
          optionToUndefined(authBaseUrl)
          || process.env.EXECUTOR_CLOUD_AUTH_BASE_URL
          || config.cloudAuthBaseUrl
          || DEFAULT_WORKOS_AUTH_BASE_URL;

        const authorization = await requestDeviceAuthorization(
          resolvedAuthBaseUrl,
          resolvedClientId,
        );

        const verificationUrl =
          authorization.verification_uri_complete ?? authorization.verification_uri;

        if (!json) {
          stdout.write(`Open this URL to authenticate:\n${verificationUrl}\n\n`);
          stdout.write(`Code: ${authorization.user_code}\n`);
        }

        if (!noBrowser) {
          openInBrowser(verificationUrl);
        }

        const token = await pollForCloudTokens({
          authBaseUrl: resolvedAuthBaseUrl,
          clientId: resolvedClientId,
          deviceCode: authorization.device_code,
          intervalSeconds: authorization.interval,
          expiresInSeconds: authorization.expires_in,
        });

        config.target = "cloud";
        config.cloudAuthClientId = resolvedClientId;
        config.cloudAuthBaseUrl = resolvedAuthBaseUrl;
        config.cloudToken = token.access_token;
        config.cloudRefreshToken = token.refresh_token;
        await saveConfig(config);

        printOutput(
          {
            ok: true,
            target: config.target,
            cloudBaseUrl: config.cloudBaseUrl ?? null,
            authenticatedForCloud: true,
            organizationId: token.organization_id ?? null,
            user: token.user ?? null,
          },
          json,
        );
      },
      catch: toErrorMessage,
    }),
).pipe(
  Command.withDescription("Authenticate cloud target using device authorization flow"),
);

const authCommand = Command.make("auth").pipe(
  Command.withSubcommands([authLoginCommand, authStatusCommand] as any),
  Command.withDescription("Cloud authentication commands"),
);

const initCommand = Command.make(
  "init",
  {
    target: Options.choice("target", ["local", "cloud"]).pipe(Options.optional),
    cloudUrl: Options.text("cloud-url").pipe(Options.optional),
    cloudToken: Options.text("cloud-token").pipe(Options.optional),
    json: Options.boolean("json"),
  },
  ({ target, cloudUrl, cloudToken, json }) =>
    Effect.tryPromise({
      try: async () => {
        const config = await loadConfig();
        const picked = await pickTarget(config, optionToUndefined(target));
        config.target = picked;

        if (picked === "cloud") {
          const prompted = await promptCloudConfig(config);
          config.cloudBaseUrl =
            optionToUndefined(cloudUrl)
            ?? process.env.EXECUTOR_CLOUD_URL
            ?? prompted.cloudBaseUrl;
          config.cloudToken =
            optionToUndefined(cloudToken)
            ?? process.env.EXECUTOR_CLOUD_TOKEN
            ?? prompted.cloudToken;

          if (!config.cloudBaseUrl) {
            throw new Error("Cloud target requires --cloud-url or EXECUTOR_CLOUD_URL.");
          }
        }

        await saveConfig(config);
        printOutput(
          {
            ok: true,
            target: config.target,
            cloudBaseUrl: config.cloudBaseUrl ?? null,
          },
          json,
        );
      },
      catch: toErrorMessage,
    }),
);

const targetShowCommand = Command.make(
  "show",
  {
    target: Options.choice("target", ["local", "cloud"]).pipe(Options.optional),
    json: Options.boolean("json"),
  },
  ({ target, json }) =>
    Effect.tryPromise({
      try: async () => {
        const config = await loadConfig();
        const explicitTarget = optionToUndefined(target);
        const selected = await pickTarget(config, explicitTarget);
        if (!config.target && !explicitTarget) {
          config.target = selected;
          await saveConfig(config);
        }
        printOutput(
          {
            target: selected,
            cloudBaseUrl: config.cloudBaseUrl ?? null,
            workspaceId: config.workspaceId ?? null,
          },
          json,
        );
      },
      catch: toErrorMessage,
    }),
);

const targetUseCommand = Command.make(
  "use",
  {
    target: Options.choice("target", ["local", "cloud"]),
    cloudUrl: Options.text("cloud-url").pipe(Options.optional),
    cloudToken: Options.text("cloud-token").pipe(Options.optional),
    json: Options.boolean("json"),
  },
  ({ target, cloudUrl, cloudToken, json }) =>
    Effect.tryPromise({
      try: async () => {
        const config = await loadConfig();
        config.target = target;

        if (target === "cloud") {
          const resolvedCloudUrl =
            optionToUndefined(cloudUrl)
            || process.env.EXECUTOR_CLOUD_URL
            || config.cloudBaseUrl;
          const resolvedCloudToken =
            optionToUndefined(cloudToken)
            || process.env.EXECUTOR_CLOUD_TOKEN
            || config.cloudToken;

          if (!resolvedCloudUrl) {
            throw new Error("Cloud target requires --cloud-url (or EXECUTOR_CLOUD_URL).");
          }

          config.cloudBaseUrl = resolvedCloudUrl;
          config.cloudToken = resolvedCloudToken;
        }

        await saveConfig(config);
        printOutput({ ok: true, target: config.target }, json);
      },
      catch: toErrorMessage,
    }),
);

const targetCommand = Command.make("target").pipe(
  Command.withSubcommands([targetShowCommand, targetUseCommand] as any),
  Command.withDescription("Executor target selection"),
);

const workspaceCurrentCommand = Command.make(
  "current",
  commonTargetOptions(),
  (common) =>
    Effect.tryPromise({
      try: async () => {
        await withClient(common as CommonTargetOptions, async ({ client, config, workspaceOverride, asJson }) => {
          const workspaceId = await ensureWorkspaceId(client, config, workspaceOverride);
          printOutput({ workspaceId }, asJson);
        });
      },
      catch: toErrorMessage,
    }),
);

const workspaceUseCommand = Command.make(
  "use",
  {
    workspaceId: Options.text("workspace-id"),
    json: Options.boolean("json"),
  },
  ({ workspaceId, json }) =>
    Effect.tryPromise({
      try: async () => {
        const config = await loadConfig();
        config.workspaceId = workspaceId.trim();
        await saveConfig(config);
        printOutput({ ok: true, workspaceId: config.workspaceId }, json);
      },
      catch: toErrorMessage,
    }),
);

const workspaceCommand = Command.make("workspace").pipe(
  Command.withSubcommands([workspaceCurrentCommand, workspaceUseCommand] as any),
  Command.withDescription("Current workspace settings"),
);

const sourcesListCommand = Command.make("list", commonTargetOptions(), (common) =>
  Effect.tryPromise({
    try: async () => {
      await withClient(common as CommonTargetOptions, async ({ client, config, workspaceOverride, asJson }) => {
        const workspaceId = await ensureWorkspaceId(client, config, workspaceOverride);
        const sources = await client.runControlPlane((api) =>
          api.sources.list({ path: { workspaceId } }),
        );
        printOutput(sources, asJson);
      });
    },
    catch: toErrorMessage,
  }),
);

const sourcesAddCommand = Command.make(
  "add",
  {
    ...commonTargetOptions(),
    kind: Options.choice("kind", ["openapi", "mcp", "graphql", "internal"]),
    url: Options.text("url"),
    name: Options.text("name").pipe(Options.optional),
  },
  (input) =>
    Effect.tryPromise({
      try: async () => {
        const common: CommonTargetOptions = {
          target: input.target,
          workspace: input.workspace,
          baseUrl: input.baseUrl,
          json: input.json,
        };
        await withClient(common, async ({ client, config, workspaceOverride, asJson }) => {
          const workspaceId = await ensureWorkspaceId(client, config, workspaceOverride);
          const source = await client.runControlPlane((api) =>
            api.sources.upsert({
              path: { workspaceId },
              payload: {
                name: optionToUndefined(input.name) ?? deriveSourceName(input.kind, input.url),
                kind: input.kind,
                endpoint: input.url,
                enabled: true,
              },
            }),
          );
          printOutput(source, asJson);
        });
      },
      catch: toErrorMessage,
    }),
);

const toolsListCommand = Command.make("list", commonTargetOptions(), (common) =>
  Effect.tryPromise({
    try: async () => {
      await withClient(common as CommonTargetOptions, async ({ client, config, workspaceOverride, asJson }) => {
        const workspaceId = await ensureWorkspaceId(client, config, workspaceOverride);
        const tools = await client.runControlPlane((api) =>
          api.tools.listWorkspaceTools({ path: { workspaceId } }),
        );
        printOutput(tools, asJson);
      });
    },
    catch: toErrorMessage,
  }),
);

const generatedSourcesCommands = (generatedByGroup.get("sources") ?? [])
  .filter((command) => command.endpointCliName !== "list")
  .map(makeGeneratedEndpointCommand);

const generatedToolsCommands = (generatedByGroup.get("tools") ?? [])
  .filter((command) => command.endpointCliName !== "list-workspace-tools")
  .map(makeGeneratedEndpointCommand);

const sourcesCommand = Command.make("sources").pipe(
  Command.withSubcommands([
    sourcesAddCommand,
    sourcesListCommand,
    ...(generatedSourcesCommands as any),
  ] as any),
  Command.withDescription("Source management commands"),
);

const toolsCommand = Command.make("tools").pipe(
  Command.withSubcommands([
    toolsListCommand,
    ...(generatedToolsCommands as any),
  ] as any),
  Command.withDescription("Tool discovery commands"),
);

const generatedGroupCommands: Array<Command.Command<any, any, any, any>> = [];
for (const [groupName, commands] of generatedByGroup) {
  if (groupName === "sources" || groupName === "tools") {
    continue;
  }

  const endpointCommands = commands.map(makeGeneratedEndpointCommand);
  if (endpointCommands.length === 0) {
    continue;
  }

  generatedGroupCommands.push(
    Command.make(groupName).pipe(
      Command.withSubcommands(endpointCommands as any),
      Command.withDescription(`Generated commands for ${groupName}`),
    ),
  );
}

const root = Command.make("executor").pipe(
  Command.withSubcommands([
    initCommand,
    authCommand,
    targetCommand,
    workspaceCommand,
    sourcesCommand,
    toolsCommand,
    ...(generatedGroupCommands as any),
  ] as any),
  Command.withDescription("Executor CLI"),
);

const runCli = Command.run(root, {
  name: "executor",
  version: "0.1.0",
});

const program = runCli(process.argv).pipe(
  Effect.provide(BunContext.layer as any),
) as Effect.Effect<void, unknown, never>;

BunRuntime.runMain(program);
