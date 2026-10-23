import { transferAdmin } from "@/lib/access/management";
import { managementResponse, readManagementInput, requirePrincipal } from "@/lib/access/server";

export async function POST(request: Request) {
  return managementResponse(async () => {
    await transferAdmin(await requirePrincipal(true), await readManagementInput(request));
    return { signInRequired: true };
  });
}
