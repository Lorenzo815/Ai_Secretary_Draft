import "server-only";

const MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

export interface VercelModelEndpoint {
  provider: string;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  uptimeLastHour: number | null;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  zeroDataRetention: boolean;
}

export interface VercelLanguageModel {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextWindow: number | null;
  maxTokens: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutput: boolean;
  suitabilityIndex: number;
}

interface CatalogModel {
  id?: unknown;
  name?: unknown;
  owned_by?: unknown;
  description?: unknown;
  type?: unknown;
  context_window?: unknown;
  max_tokens?: unknown;
  tags?: unknown;
  supported_parameters?: unknown;
  modalities?: { input?: unknown; output?: unknown };
  pricing?: { input?: unknown; output?: unknown };
}

export async function listVercelLanguageModels(): Promise<VercelLanguageModel[]> {
  const response = await fetch(MODELS_URL, {
    cache: "force-cache",
    next: { revalidate: 3_600 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`O catálogo da Vercel respondeu HTTP ${response.status}.`);
  const result = await response.json() as { data?: CatalogModel[] };
  if (!Array.isArray(result.data)) throw new Error("O catálogo da Vercel retornou um formato inválido.");

  return result.data
    .filter((model) => model.type === "language" && typeof model.id === "string" && outputsText(model))
    .map((model) => {
      const tags = stringArray(model.tags);
      const parameters = stringArray(model.supported_parameters);
      const supportsTools = tags.includes("tool-use") || parameters.includes("tools");
      const supportsImages = stringArray(model.modalities?.input).includes("image");
      const supportsReasoning = tags.includes("reasoning") || parameters.includes("reasoning");
      const supportsStructuredOutput = tags.includes("structured-output")
        || parameters.includes("response_format")
        || parameters.includes("structured_output");
      const contextWindow = finiteNumber(model.context_window);
      const maxTokens = finiteNumber(model.max_tokens);
      return {
        id: model.id as string,
        name: typeof model.name === "string" && model.name.trim() ? model.name : model.id as string,
        provider: typeof model.owned_by === "string" ? model.owned_by : (model.id as string).split("/")[0],
        description: typeof model.description === "string" ? model.description.slice(0, 500) : "",
        contextWindow,
        maxTokens,
        inputPricePerMillion: pricePerMillion(model.pricing?.input),
        outputPricePerMillion: pricePerMillion(model.pricing?.output),
        supportsTools,
        supportsImages,
        supportsReasoning,
        supportsStructuredOutput,
        suitabilityIndex: calculateSuitabilityIndex({
          contextWindow,
          maxTokens,
          supportsTools,
          supportsReasoning,
          supportsStructuredOutput,
        }),
      };
    })
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name));
}

function outputsText(model: CatalogModel) {
  const outputs = model.modalities?.output;
  return !Array.isArray(outputs) || outputs.includes("text");
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function pricePerMillion(value: unknown) {
  const perToken = finiteNumber(value);
  return perToken === null ? null : Number((perToken * 1_000_000).toFixed(6));
}

function calculateSuitabilityIndex(input: {
  contextWindow: number | null;
  maxTokens: number | null;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutput: boolean;
}) {
  const contextScore = input.contextWindow === null ? 0
    : input.contextWindow >= 1_000_000 ? 25
      : input.contextWindow >= 200_000 ? 20
        : input.contextWindow >= 100_000 ? 15
          : input.contextWindow >= 32_000 ? 10 : 5;
  const outputScore = input.maxTokens === null ? 0
    : input.maxTokens >= 100_000 ? 15
      : input.maxTokens >= 32_000 ? 12
        : input.maxTokens >= 8_000 ? 8 : input.maxTokens > 0 ? 4 : 0;
  return contextScore
    + outputScore
    + (input.supportsReasoning ? 25 : 0)
    + (input.supportsTools ? 20 : 0)
    + (input.supportsStructuredOutput ? 15 : 0);
}

interface CatalogEndpoint {
  provider_name?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  uptime_last_1h?: unknown;
  supported_parameters?: unknown;
  has_zdr?: unknown;
}

export async function listVercelModelEndpoints(modelId: string): Promise<VercelModelEndpoint[]> {
  const normalized = modelId.trim();
  if (!normalized || normalized.length > 200 || !normalized.includes("/")) {
    throw new Error("Modelo Vercel inválido.");
  }
  const path = normalized.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${MODELS_URL}/${path}/endpoints`, {
    cache: "force-cache",
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Os provedores do modelo responderam HTTP ${response.status}.`);
  const result = await response.json() as { data?: { endpoints?: CatalogEndpoint[] } };
  if (!Array.isArray(result.data?.endpoints)) {
    throw new Error("A lista de provedores do modelo retornou um formato inválido.");
  }
  return result.data.endpoints
    .filter((endpoint): endpoint is CatalogEndpoint & { provider_name: string } => (
      typeof endpoint.provider_name === "string" && endpoint.provider_name.length > 0
    ))
    .map((endpoint) => {
      const parameters = stringArray(endpoint.supported_parameters);
      return {
        provider: endpoint.provider_name,
        inputPricePerMillion: pricePerMillion(endpoint.pricing?.prompt),
        outputPricePerMillion: pricePerMillion(endpoint.pricing?.completion),
        uptimeLastHour: finiteNumber(endpoint.uptime_last_1h),
        supportsTools: parameters.includes("tools") && parameters.includes("tool_choice"),
        supportsStructuredOutput: parameters.includes("response_format") || parameters.includes("structured_output"),
        zeroDataRetention: endpoint.has_zdr === true,
      };
    })
    .sort((left, right) => (
      endpointCost(left) - endpointCost(right) || left.provider.localeCompare(right.provider)
    ));
}

function endpointCost(endpoint: VercelModelEndpoint) {
  return (endpoint.inputPricePerMillion ?? Infinity) + (endpoint.outputPricePerMillion ?? Infinity);
}
