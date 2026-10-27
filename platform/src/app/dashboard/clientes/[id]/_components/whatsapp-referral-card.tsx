import { ExternalLink, Megaphone } from "lucide-react";
import type { WhatsAppReferral } from "@/lib/whatsapp/message-payload";

export default function WhatsAppReferralCard({ referral }: { referral: WhatsAppReferral }) {
  const label = referral.sourceType === "ad" ? "Anúncio de origem"
    : referral.sourceType === "post" ? "Publicação de origem" : "Referência de origem";
  const hasDetails = referral.sourceId || referral.sourceUrl || referral.imageUrl
    || referral.videoUrl || referral.thumbnailUrl;
  return (
    <aside aria-label={label} className="rounded-md border border-current/15 bg-black/5 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-semibold"><Megaphone aria-hidden="true" className="size-3.5" />{label}</p>
      {referral.headline && <p className="mt-2 whitespace-pre-wrap break-words font-semibold">{referral.headline}</p>}
      {referral.body && <p className="mt-1 whitespace-pre-wrap break-words leading-5">{referral.body}</p>}
      {referral.welcomeMessage && (
        <div className="mt-2 border-l-2 border-current/25 pl-2">
          <p className="font-semibold opacity-70">Saudação do anúncio</p>
          <p className="mt-1 whitespace-pre-wrap break-words leading-5">{referral.welcomeMessage}</p>
        </div>
      )}
      {!referral.headline && !referral.body && !referral.welcomeMessage && (
        <p className="mt-2 opacity-70">Texto não fornecido pela Meta.</p>
      )}
      {hasDetails && (
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold">Ver detalhes da origem</summary>
          <div className="mt-2 space-y-2 break-words">
            {referral.sourceId && <p>ID: {referral.sourceId}</p>}
            {referral.sourceUrl && <ReferralLink url={referral.sourceUrl} label="Abrir anúncio/publicação" />}
            {referral.imageUrl && <ReferralLink url={referral.imageUrl} label="Abrir imagem do anúncio" />}
            {referral.videoUrl && <ReferralLink url={referral.videoUrl} label="Abrir vídeo do anúncio" />}
            {referral.thumbnailUrl && <ReferralLink url={referral.thumbnailUrl} label="Abrir miniatura do anúncio" />}
          </div>
        </details>
      )}
    </aside>
  );
}

function ReferralLink({ url, label }: { url: string; label: string }) {
  let valid = false;
  try {
    const parsed = new URL(url);
    valid = (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  return valid ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
      {label}<ExternalLink aria-hidden="true" className="size-3" />
    </a>
  ) : <p>{label}: link indisponível.</p>;
}
