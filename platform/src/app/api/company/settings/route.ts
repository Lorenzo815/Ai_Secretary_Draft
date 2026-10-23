import { getCompanySettings, updateCompanyProfile } from "@/lib/access/management";
import { managementResponse, readManagementInput, requirePrincipal } from "@/lib/access/server";

export async function GET() {
  return managementResponse(async () => getCompanySettings(await requirePrincipal()));
}

export async function PATCH(request: Request) {
  return managementResponse(async () => {
    const principal = await requirePrincipal(true);
    await updateCompanyProfile(principal, await readManagementInput(request));
    return getCompanySettings(principal);
  });
}
