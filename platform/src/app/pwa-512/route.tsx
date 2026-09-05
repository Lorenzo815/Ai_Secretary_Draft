import { createOriaIcon } from "@/lib/pwa-icon";

export const dynamic = "force-static";

export function GET() {
  return createOriaIcon(512);
}
