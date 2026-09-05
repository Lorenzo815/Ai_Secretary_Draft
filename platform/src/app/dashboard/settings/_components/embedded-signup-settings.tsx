"use client";

import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, LockKeyhole, Radio } from "lucide-react";

interface FacebookLoginResponse {
  authResponse?: { code?: string };
  status?: string;
}

interface FacebookSdk {
  init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
  login(
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: {
        setup: Record<string, never>;
        featureType: "whatsapp_business_app_onboarding";
        sessionInfoVersion: "3";
      };
    },
  ): void;
}

interface EmbeddedSignupEvent {
  type?: string;
  event?: string;
  data?: {
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
    current_step?: string;
    error_code?: string;
  };
}

type OAuthStatus = "idle" | "waiting" | "exchanging" | "exchanged" | "not-received" | "error";
type CompletionStatus = "idle" | "awaiting-session" | "finalizing" | "connected" | "activating" | "operational" | "error";
interface ConnectionSummary {
  connectionId: string;
  status: "connected" | "operational";
  wabaId: string;
  phoneNumberId: string;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

export default function EmbeddedSignupSettings({
  initialConfiguration,
  initialConnection,
}: {
  initialConfiguration: { appId: string; configurationId: string; graphVersion: string };
  initialConnection: ConnectionSummary | null;
}) {
  const [appId, setAppId] = useState(initialConfiguration.appId);
  const [configurationId, setConfigurationId] = useState(initialConfiguration.configurationId);
  const [savedConfiguration, setSavedConfiguration] = useState(initialConfiguration);
  const [saving, setSaving] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [pageUsesHttps, setPageUsesHttps] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>("idle");
  const [completionStatus, setCompletionStatus] = useState<CompletionStatus>(initialConnection?.status ?? "idle");
  const [connection, setConnection] = useState<ConnectionSummary | null>(initialConnection);
  const [sessionEvent, setSessionEvent] = useState<EmbeddedSignupEvent | null>(null);
  const connectionIdRef = useRef<string | null>(initialConnection?.connectionId ?? null);
  const sessionEventRef = useRef<EmbeddedSignupEvent | null>(null);
  const finalizingRef = useRef(false);
  const configured = Boolean(savedConfiguration.appId && savedConfiguration.configurationId);
  const dirty = appId !== savedConfiguration.appId || configurationId !== savedConfiguration.configurationId;
  const coexistenceConfirmed = sessionEvent?.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";

  useEffect(() => {
    setPageUsesHttps(window.location.protocol === "https:");
  }, []);

  useEffect(() => {
    function initializeSdk() {
      if (!window.FB || !savedConfiguration.appId) return;
      window.FB.init({
        appId: savedConfiguration.appId,
        cookie: true,
        xfbml: false,
        version: savedConfiguration.graphVersion,
      });
      setSdkReady(true);
    }

    window.fbAsyncInit = initializeSdk;
    initializeSdk();
    return () => {
      if (window.fbAsyncInit === initializeSdk) delete window.fbAsyncInit;
    };
  }, [savedConfiguration.appId, savedConfiguration.graphVersion]);

  useEffect(() => {
    function captureSessionEvent(event: MessageEvent) {
      let hostname: string;
      try {
        hostname = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (hostname !== "facebook.com" && !hostname.endsWith(".facebook.com")) return;

      try {
        const data = typeof event.data === "string"
          ? JSON.parse(event.data) as EmbeddedSignupEvent
          : event.data as EmbeddedSignupEvent;
        if (data.type !== "WA_EMBEDDED_SIGNUP") return;
        setSessionEvent(data);
        sessionEventRef.current = data;
        void finalizeIfReady(connectionIdRef.current, data);
      } catch {
        return;
      }
    }

    window.addEventListener("message", captureSessionEvent);
    return () => window.removeEventListener("message", captureSessionEvent);
  }, []);

  async function finalizeIfReady(connectionId: string | null, event: EmbeddedSignupEvent | null) {
    if (
      !connectionId
      || event?.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      || finalizingRef.current
    ) return;
    if (!event.data?.waba_id) {
      setCompletionStatus("error");
      setMessage("A Meta confirmou a coexistência, mas não retornou o WABA ID.");
      return;
    }

    finalizingRef.current = true;
    setCompletionStatus("finalizing");
    try {
      const response = await fetch("/api/whatsapp/embedded-signup/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          wabaId: event.data.waba_id,
          phoneNumberId: event.data.phone_number_id,
        }),
      });
      const result = await response.json() as {
        success?: boolean;
        connectionId?: string;
        wabaId?: string;
        phoneNumberId?: string;
        error?: string;
      };
      if (!response.ok || !result.success || !result.connectionId || !result.wabaId || !result.phoneNumberId) {
        throw new Error(result.error ?? "Não foi possível finalizar a conexão.");
      }
      setConnection({
        connectionId: result.connectionId,
        status: "connected",
        wabaId: result.wabaId,
        phoneNumberId: result.phoneNumberId,
      });
      setCompletionStatus("connected");
      setMessage("Coexistência conectada e webhooks assinados. Ative-a separadamente quando quiser migrar mensagens novas.");
    } catch (error) {
      setCompletionStatus("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível finalizar a conexão.");
    } finally {
      finalizingRef.current = false;
    }
  }

  async function activateConnection() {
    if (!connection || connection.status === "operational") return;
    setCompletionStatus("activating");
    setMessage(null);
    try {
      const response = await fetch("/api/whatsapp/embedded-signup/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: connection.connectionId }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "Não foi possível ativar a conexão.");
      }
      setConnection({ ...connection, status: "operational" });
      setCompletionStatus("operational");
      setMessage("Esta conexão agora recebe e envia as novas mensagens. Histórico e contatos antigos não serão importados.");
    } catch (error) {
      setCompletionStatus("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível ativar a conexão.");
    }
  }

  async function exchangeCode(code: string) {
    setOAuthStatus("exchanging");
    try {
      const response = await fetch("/api/whatsapp/embedded-signup/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await response.json() as { connectionId?: string; error?: string };
      if (!response.ok || !result.connectionId) {
        throw new Error(result.error ?? "Não foi possível trocar o código temporário.");
      }
      connectionIdRef.current = result.connectionId;
      setOAuthStatus("exchanged");
      setCompletionStatus("awaiting-session");
      await finalizeIfReady(result.connectionId, sessionEventRef.current);
    } catch (error) {
      setOAuthStatus("error");
      setCompletionStatus("error");
      setMessage(error instanceof Error ? error.message : "Não foi possível trocar o código temporário.");
    }
  }

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/whatsapp/embedded-signup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId, configurationId }),
      });
      const result = await response.json() as {
        appId?: string;
        configurationId?: string;
        graphVersion?: string;
        error?: string;
      };
      if (!response.ok || !result.appId || !result.configurationId || !result.graphVersion) {
        throw new Error(result.error ?? "Não foi possível salvar a configuração.");
      }
      setAppId(result.appId);
      setConfigurationId(result.configurationId);
      setSavedConfiguration({
        appId: result.appId,
        configurationId: result.configurationId,
        graphVersion: result.graphVersion,
      });
      setMessage("Configuração pública da Meta salva. As credenciais atuais do WhatsApp não foram alteradas.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar a configuração.");
    } finally {
      setSaving(false);
    }
  }

  function launchSignup() {
    if (window.location.protocol !== "https:") {
      setMessage("O Login da Meta exige HTTPS. Abra esta página no ambiente publicado para executar o teste.");
      return;
    }
    if (!window.FB || !sdkReady || !configured) {
      setMessage("O SDK da Meta ainda não está pronto.");
      return;
    }
    setLaunching(true);
    setOAuthStatus("waiting");
    setCompletionStatus("idle");
    setSessionEvent(null);
    connectionIdRef.current = null;
    sessionEventRef.current = null;
    finalizingRef.current = false;
    setMessage(null);
    window.FB.login((response) => {
      setLaunching(false);
      if (response.authResponse?.code) {
        void exchangeCode(response.authResponse.code);
      } else {
        setOAuthStatus("not-received");
      }
    }, {
      config_id: savedConfiguration.configurationId,
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    });
  }

  return (
    <section aria-labelledby="embedded-signup-title" data-auto-refresh-dirty={dirty || saving || launching || oauthStatus !== "idle" || completionStatus === "activating" ? "true" : undefined}>
      {configured && (
        <Script
          id="facebook-jssdk"
          src="https://connect.facebook.net/pt_BR/sdk.js"
          strategy="afterInteractive"
          onLoad={() => window.fbAsyncInit?.()}
          onError={() => setMessage("Não foi possível carregar o SDK da Meta.")}
        />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-deep-teal/10 text-deep-teal"><Radio className="h-5 w-5" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 id="embedded-signup-title" className="font-heading text-base font-semibold text-slate-ink">WhatsApp Business</h3><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${connection?.status === "operational" ? "bg-emerald-50 text-emerald-700" : connection ? "bg-amber-50 text-amber-700" : "bg-warm-sand text-stone"}`}>{connection?.status === "operational" ? "Operacional" : connection ? "Conectado" : "Não conectado"}</span></div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-stone">Conecte a conta existente pela Meta e escolha quando ela começa a receber e enviar novas mensagens.</p>
          </div>
        </div>
        <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 self-start text-xs font-semibold text-deep-teal hover:text-forest-teal">Painel da Meta<ExternalLink className="h-3.5 w-3.5" /></a>
      </div>

      <form onSubmit={saveConfiguration} className="mt-5 grid gap-3 rounded-md bg-soft-ivory p-4 ring-1 ring-mist md:grid-cols-2 md:items-end">
        <div className="flex items-center gap-2 md:col-span-2"><LockKeyhole className="h-4 w-4 text-deep-teal" /><p className="text-xs font-bold text-slate-ink">Configuração pública da Meta</p><span className="text-xs text-stone">Nenhum segredo é exibido aqui.</span></div>
        <label className="text-xs font-semibold text-slate-ink">App ID
          <input value={appId} onChange={(event) => setAppId(event.target.value.replace(/\D/g, ""))} required inputMode="numeric" autoComplete="off" placeholder="ID numérico do aplicativo" className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
        </label>
        <label className="text-xs font-semibold text-slate-ink">Configuration ID
          <input value={configurationId} onChange={(event) => setConfigurationId(event.target.value.replace(/\D/g, ""))} required inputMode="numeric" autoComplete="off" placeholder="ID da configuração Embedded Signup v4" className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
        </label>
        <button type="submit" disabled={saving || !dirty} className="min-h-10 rounded-md border border-deep-teal bg-white px-4 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5 disabled:border-mist disabled:text-stone md:col-start-2">{saving ? "Salvando..." : dirty ? "Salvar configuração" : "Configuração salva"}</button>
      </form>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-mist pt-5">
        <button type="button" onClick={launchSignup} disabled={!configured || !sdkReady || !pageUsesHttps || launching || dirty} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-deep-teal bg-white px-4 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5 disabled:cursor-not-allowed disabled:opacity-45">
          {launching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {launching ? "Aguardando Meta..." : "Conectar com a Meta"}
        </button>
        <span className="text-xs text-stone">SDK {sdkReady ? "carregado" : configured ? "carregando" : "aguardando configuração"} · {pageUsesHttps ? "HTTPS ativo" : "HTTPS obrigatório"} · Graph API {savedConfiguration.graphVersion}</span>
      </div>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-stone">A credencial é trocada no servidor e armazenada criptografada. Histórico e contatos antigos não são importados.</p>

      {oauthStatus !== "idle" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className={`border-l-2 pl-3 ${oauthStatus === "exchanged" ? "border-deep-teal" : oauthStatus === "error" ? "border-burnt-coral" : "border-mist"}`}>
            <p className="text-xs font-semibold text-stone">Login Meta</p>
            <p className="mt-1 text-sm font-semibold text-slate-ink">{oauthStatus === "exchanged" ? "Token trocado e criptografado" : oauthStatus === "exchanging" ? "Protegendo credencial" : oauthStatus === "waiting" ? "Aguardando código" : oauthStatus === "error" ? "Falha na troca" : "Código não retornado"}</p>
          </div>
          <div className={`border-l-2 pl-3 ${sessionEvent ? "border-deep-teal" : "border-mist"}`}>
            <p className="text-xs font-semibold text-stone">Session logging</p>
            <p className="mt-1 text-sm font-semibold text-slate-ink">{sessionEvent ? `Evento recebido: ${sessionEvent.event ?? "desconhecido"}` : "Aguardando evento"}</p>
          </div>
          <div className={`border-l-2 pl-3 ${coexistenceConfirmed ? "border-deep-teal" : sessionEvent ? "border-burnt-coral" : "border-mist"}`}>
            <p className="text-xs font-semibold text-stone">Coexistência</p>
            <p className="mt-1 text-sm font-semibold text-slate-ink">{completionStatus === "operational" ? "Operacional" : completionStatus === "connected" ? "Conectada, aguardando ativação" : completionStatus === "activating" ? "Ativando" : completionStatus === "finalizing" ? "Assinando webhooks" : coexistenceConfirmed ? "Confirmada pela Meta" : sessionEvent?.event === "FINISH" ? "Não: fluxo Cloud API comum" : sessionEvent?.event === "CANCEL" ? "Não concluída" : "Aguardando confirmação"}</p>
          </div>
        </div>
      )}
      {sessionEvent?.event === "CANCEL" && (
        <p role="status" className="mt-3 text-sm font-medium text-burnt-coral">{sessionEvent.data?.error_code ? `A Meta informou o erro ${sessionEvent.data.error_code}.` : `Fluxo fechado na etapa ${sessionEvent.data?.current_step ?? "não informada"}.`}</p>
      )}
      {sessionEvent?.data && (sessionEvent.data.waba_id || sessionEvent.data.phone_number_id) && (
        <dl className="mt-4 grid gap-3 border-l-2 border-deep-teal pl-4 text-xs sm:grid-cols-2">
          <div><dt className="font-semibold text-stone">WABA ID recebido</dt><dd className="mt-1 font-mono text-slate-ink">{sessionEvent.data.waba_id ?? "Não informado"}</dd></div>
          <div><dt className="font-semibold text-stone">Phone Number ID recebido</dt><dd className="mt-1 font-mono text-slate-ink">{sessionEvent.data.phone_number_id ?? "Não informado"}</dd></div>
        </dl>
      )}
      {connection && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-4">
          <div className="text-xs text-stone">
            <p><span className="font-semibold text-slate-ink">Phone Number ID:</span> <span className="font-mono">{connection.phoneNumberId}</span></p>
            <p className="mt-1">{connection.status === "operational" ? "Mensagens novas estão habilitadas nesta conexão." : "Sem impacto no fluxo atual até a ativação."}</p>
          </div>
          {connection.status === "connected" && (
            <button type="button" onClick={activateConnection} disabled={completionStatus === "activating"} className="min-h-10 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-50">
              {completionStatus === "activating" ? "Ativando..." : "Ativar como operacional"}
            </button>
          )}
        </div>
      )}
      {message && <p role="status" className="mt-3 text-sm font-medium text-deep-teal">{message}</p>}
    </section>
  );
}