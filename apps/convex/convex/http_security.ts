type RequestDenyOptions = {
  status: number;
  message: string;
};

type InternalSecretOptions = {
  context: string;
  envVarNames: ReadonlyArray<string>;
  headerName?: string;
};

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const denyRequest = (options: RequestDenyOptions): Response =>
  Response.json(
    {
      error: options.message,
    },
    { status: options.status },
  );

const readEnvValue = (name: string): string | undefined => trim(process.env[name]);

const readConfiguredSecret = (envVarNames: ReadonlyArray<string>): string | null => {
  for (const name of envVarNames) {
    const value = readEnvValue(name);
    if (value) {
      return value;
    }
  }

  return null;
};

const readRequestHeader = (request: Request, name: string): string | null =>
  trim(request.headers.get(name) ?? undefined) ?? null;

export const enforceInternalSecret = (
  request: Request,
  options: InternalSecretOptions,
): Response | null => {
  const expectedSecret = readConfiguredSecret(options.envVarNames);
  if (expectedSecret === null) {
    return denyRequest({
      status: 503,
      message: `${options.context} authentication secret is not configured`,
    });
  }

  const providedSecret = readRequestHeader(request, options.headerName ?? "x-internal-secret");
  if (providedSecret === null) {
    return denyRequest({
      status: 401,
      message: `${options.context} authentication is required`,
    });
  }

  if (providedSecret !== expectedSecret) {
    return denyRequest({
      status: 403,
      message: `${options.context} authentication failed`,
    });
  }

  return null;
};
