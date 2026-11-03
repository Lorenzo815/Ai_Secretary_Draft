import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  CONFIRMATION_BUTTONS, CONFIRMATION_TEMPLATE_HELP, DEFAULT_CONFIRMATION_TEMPLATE, countUnconfirmedUpcoming,
  getAppointmentConfirmationConfiguration, getConfirmationTemplateStatus, submitConfirmationTemplate,
  updateAppointmentConfirmationConfiguration, type ConfirmationSettingsInput,
} from "@/lib/confirmations";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const [configuration, template, unconfirmedUpcoming] = await Promise.all([
    getAppointmentConfirmationConfiguration(),
    getConfirmationTemplateStatus({ fresh: true }),
    countUnconfirmedUpcoming(),
  ]);
  return NextResponse.json({
    configuration,
    template,
    templateInfo: {
      name: DEFAULT_CONFIRMATION_TEMPLATE.name,
      language: DEFAULT_CONFIRMATION_TEMPLATE.language,
      defaultBody: DEFAULT_CONFIRMATION_TEMPLATE.body,
      buttons: CONFIRMATION_BUTTONS.map((button) => button.text),
      help: CONFIRMATION_TEMPLATE_HELP,
    },
    unconfirmedUpcoming,
  }, { headers: NO_STORE });
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const input = await request.json().catch(() => null) as { expectedRevision?: unknown; configuration?: ConfirmationSettingsInput } | null;
  if (!input?.configuration || typeof input.configuration !== "object") {
    return NextResponse.json({ error: "Configuração inválida." }, { status: 400 });
  }
  try {
    const template = input.configuration.enabled ? await getConfirmationTemplateStatus({ fresh: true }) : null;
    const configuration = await updateAppointmentConfirmationConfiguration({
      expectedRevision: Number(input.expectedRevision),
      settings: input.configuration,
      updatedBy: session.user?.email ?? "dashboard",
      templateApproved: template?.state === "approved",
    });
    return NextResponse.json({ configuration }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível salvar.";
    return NextResponse.json({ error: message }, { status: message.includes("foi alterada") ? 409 : 400 });
  }
}

/** Submits the confirmation template to Meta with the clinic's text. */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const input = await request.json().catch(() => null) as { body?: unknown } | null;
  if (typeof input?.body !== "string") return NextResponse.json({ error: "Informe o texto do modelo." }, { status: 400 });
  try {
    await submitConfirmationTemplate(input.body);
    return NextResponse.json({ template: await getConfirmationTemplateStatus({ fresh: true }) }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "A Meta não aceitou o modelo." }, { status: 400 });
  }
}
