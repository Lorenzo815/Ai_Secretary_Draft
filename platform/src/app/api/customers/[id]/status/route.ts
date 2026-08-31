import { getServerSession } from "next-auth";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { CustomerServiceStatus, updateCustomerServiceStatus } from "@/lib/crm";
import { listWhatsAppMessagesForAssistant } from "@/lib/whatsapp";
import { scheduleAssistantResponse } from "@/lib/assistant/queue";

const validStatuses = new Set<CustomerServiceStatus>([
  "ai_active",
  "waiting_human",
  "human_active",
  "closed",
]);

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getServerSession(authOptions))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { id } = await params;
  const input = (await request.json()) as { status?: CustomerServiceStatus };
  if (!ObjectId.isValid(id) || !input.status || !validStatuses.has(input.status)) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }
  const customer = await updateCustomerServiceStatus(new ObjectId(id), input.status);
  if (input.status === "ai_active") {
    const recent = await listWhatsAppMessagesForAssistant(customer._id, undefined, 1);
    const latest = recent[0];
    if (latest?.direction === "inbound") {
      await scheduleAssistantResponse({
        customerId: customer._id,
        latestInboundAt: latest.timestamp,
      });
    }
  }
  return NextResponse.json({ status: customer.serviceStatus });
}