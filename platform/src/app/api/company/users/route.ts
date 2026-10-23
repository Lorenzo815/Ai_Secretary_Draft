import { createManagedUser, deleteManagedUser, getCompanySettings, updateManagedUser } from "@/lib/access/management";
import { managementResponse, readManagementInput, requirePrincipal } from "@/lib/access/server";

export async function GET() {
  return managementResponse(async () => getCompanySettings(await requirePrincipal(true)));
}

export async function POST(request: Request) {
  return managementResponse(async () => {
    const principal = await requirePrincipal(true);
    await createManagedUser(principal, await readManagementInput(request));
    return getCompanySettings(principal);
  });
}

export async function PATCH(request: Request) {
  return managementResponse(async () => {
    const principal = await requirePrincipal(true);
    const input = await readManagementInput(request);
    await updateManagedUser(principal, input);
    return input.id === principal.id ? { signInRequired: true } : getCompanySettings(principal);
  });
}

export async function DELETE(request: Request) {
  return managementResponse(async () => {
    const principal = await requirePrincipal(true);
    await deleteManagedUser(principal, await readManagementInput(request));
    return getCompanySettings(principal);
  });
}
