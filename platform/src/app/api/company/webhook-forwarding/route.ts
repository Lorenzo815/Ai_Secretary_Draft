import { ManagementError } from "@/lib/access/management";
import { managementResponse, readManagementInput, requirePrincipal } from "@/lib/access/server";
import { getForwardingSettings, saveForwardingSettings, testForwardingEndpoint } from "@/lib/whatsapp/forwarding";

export const maxDuration = 30;

export async function GET() {
  return managementResponse(async () => ({ settings: await getForwardingSettings(await requirePrincipal(true)) }));
}

export async function PUT(request: Request) {
  return managementResponse(async () => {
    const principal = await requirePrincipal(true);
    return { settings: await saveForwardingSettings(principal, await readManagementInput(request)) };
  });
}

export async function POST(request: Request) {
  return managementResponse(async () => {
    const principal = await requirePrincipal(true);
    const input = await readManagementInput(request);
    if (Object.keys(input).length !== 1 || typeof input.endpointId !== "string") {
      throw new ManagementError("Selecione apenas o destino salvo que deseja testar.");
    }
    return testForwardingEndpoint(principal, input.endpointId);
  });
}
