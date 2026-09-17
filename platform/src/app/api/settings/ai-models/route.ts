import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { verifyAzureAccessPassword } from "@/lib/ai/azure-access";
import {
  getAiProviderConfiguration,
  getAiProviderStatus,
  updateAiProviderConfiguration,
  type AiProvider,
  type AiTaskKey,
} from "@/lib/ai/provider-config";
import {
  listVercelLanguageModels,
  listVercelModelEndpoints,
} from "@/lib/ai/vercel-models";
import {
  clearStoredVercelGatewayApiKey,
  saveVercelGatewayApiKey,
} from "@/lib/ai/provider-credentials";
import { checkProviderHealth, probeProviderStructuredOutput } from "@/lib/ai/providers/registry";

async function authenticate() {
  return getServerSession(authOptions);
}

export async function GET(request: Request) {
  if (!(await authenticate())) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  try {
    const model = new URL(request.url).searchParams.get("model");
    if (model) return NextResponse.json({ endpoints: await listVercelModelEndpoints(model) });
    const [configuration, status, models] = await Promise.all([
      getAiProviderConfiguration(),
      getAiProviderStatus(),
      listVercelLanguageModels(),
    ]);
    return NextResponse.json({
      configuration,
      status,
      models,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível consultar os modelos." },
      { status: 502 },
    );
  }
}

export async function PUT(request: Request) {
  const session = await authenticate();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const input = await request.json() as {
    expectedRevision?: number;
    activeProvider?: AiProvider;
    azurePassword?: string;
    tasks?: Record<AiTaskKey, { vercelModel: string; vercelProvider?: string; azureModel: string }>;
  };
  try {
    if (input.activeProvider === "azure" && !verifyAzureAccessPassword(input.azurePassword)) {
      return NextResponse.json({ error: "Senha de acesso ao Azure inválida." }, { status: 403 });
    }
    const configuration = await updateAiProviderConfiguration({
      expectedRevision: Number(input.expectedRevision),
      activeProvider: input.activeProvider as AiProvider,
      azureAccessAuthorized: input.activeProvider === "azure",
      tasks: input.tasks as Record<AiTaskKey, { vercelModel: string; vercelProvider?: string; azureModel: string }>,
      updatedBy: session.user?.email ?? "dashboard",
    });
    return NextResponse.json({ configuration, status: await getAiProviderStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar os modelos.";
    return NextResponse.json({ error: message }, { status: message.includes("alterada") ? 409 : 400 });
  }
}

export async function PATCH(request: Request) {
  const session = await authenticate();
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const input = await request.json() as { apiKey?: string; clear?: boolean };
  try {
    if (input.clear) await clearStoredVercelGatewayApiKey();
    else await saveVercelGatewayApiKey(input.apiKey ?? "", session.user?.email ?? "dashboard");
    return NextResponse.json({ status: await getAiProviderStatus() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível atualizar a chave Vercel." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await authenticate())) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const input = await request.json() as {
    provider?: AiProvider;
    model?: string;
    mode?: "connection" | "model" | "capability";
    inferenceProvider?: string;
    azurePassword?: string;
  };
  if (input.provider !== "vercel" && input.provider !== "azure") {
    return NextResponse.json({ error: "Provedor de IA inválido." }, { status: 400 });
  }
  if (input.provider === "azure" && !verifyAzureAccessPassword(input.azurePassword)) {
    return NextResponse.json({ error: "Senha de acesso ao Azure inválida." }, { status: 403 });
  }
  const model = input.model?.trim();
  if (!model || model.length > 200) return NextResponse.json({ error: "Modelo inválido." }, { status: 400 });
  const mode = input.mode ?? "connection";
  if (mode !== "connection" && mode !== "model" && mode !== "capability") {
    return NextResponse.json({ error: "Tipo de teste inválido." }, { status: 400 });
  }
  const inferenceProvider = input.inferenceProvider?.trim();
  if (inferenceProvider && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(inferenceProvider)) {
    return NextResponse.json({ error: "Provedor de inferência inválido." }, { status: 400 });
  }
  if (mode === "capability" && input.provider === "vercel" && !inferenceProvider) {
    return NextResponse.json({ error: "Fixe um provedor de inferência para executar um teste determinístico." }, { status: 400 });
  }
  try {
    if (mode === "capability") {
      return NextResponse.json({
        capability: await probeProviderStructuredOutput(input.provider, model, inferenceProvider),
      });
    }
    return NextResponse.json({
      health: await checkProviderHealth(input.provider, model, mode, inferenceProvider),
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : "";
    const type = typeof error === "object" && error && "type" in error && typeof error.type === "string" ? error.type : "";
    const requestId = typeof error === "object" && error && "request_id" in error && typeof error.request_id === "string" ? error.request_id : "";
    const message = input.provider === "vercel" && type === "no_providers_available"
      ? "O modelo está catalogado, mas nenhum provedor está disponível para executá-lo agora. Escolha outro modelo e teste novamente."
      : input.provider === "vercel" && status === 401
      ? "Autenticação inválida. Use uma AI Gateway API key criada em Vercel → AI Gateway → API Keys (formato vck_...), não um Personal Access Token."
      : input.provider === "vercel" && status === 403
        ? "A chave autenticou, mas não possui permissão para este projeto, equipe ou modelo."
        : status === 429
          ? "O provedor recusou o teste por limite de uso ou orçamento. Verifique o budget da chave."
          : status === 404 || code === "model_not_found"
            ? "O modelo selecionado não está disponível para esta conta."
            : "O provedor não respondeu corretamente ao teste.";
    return NextResponse.json({
      error: message,
      diagnostic: {
        upstreamStatus: status || null,
        code: code || null,
        type: type || null,
        requestId: requestId || null,
      },
    }, { status: 502 });
  }
}