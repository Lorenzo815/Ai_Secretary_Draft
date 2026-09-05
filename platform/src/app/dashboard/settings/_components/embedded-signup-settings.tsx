"use client";

import Script from "next/script";
import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle } from "lucide-react";

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

type OAuthStatus = "idle" | "waiting" | "received" | "not-received";

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

export default function EmbeddedSignupSettings({
  initialConfiguration,
}: {
  initialConfiguration: { appId: string; configurationId: string; graphVersion: string };
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
  const [sessionEvent, setSessionEvent] = useState<EmbeddedSignupEvent | null>(null);
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
      } catch {
        return;
      }
    }

    window.addEventListener("message", captureSessionEvent);
    return () => window.removeEventListener("message", captureSessionEvent);
  }, []);

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
    setSessionEvent(null);
    setMessage(null);
    window.FB.login((response) => {
      setLaunching(false);
      if (response.authResponse?.code) {
        setOAuthStatus("received");
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
    <section aria-labelledby="embedded-signup-title" className="border-y border-mist py-5" data-auto-refresh-dirty={dirty || saving || launching ? "true" : undefined}>
      {configured && (
        <Script
          id="facebook-jssdk"
          src="https://connect.facebook.net/pt_BR/sdk.js"
          strategy="afterInteractive"
          onLoad={() => window.fbAsyncInit?.()}
          onError={() => setMessage("Não foi possível carregar o SDK da Meta.")}
        />
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="embedded-signup-title" className="font-heading text-sm font-semibold text-slate-ink">Cadastro Incorporado da Meta</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-stone">Configure o Facebook Login for Business v4 e teste o fluxo de coexistência sem substituir a conexão atual do WhatsApp.</p>
        </div>
        <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-2 self-start text-sm font-semibold text-deep-teal hover:text-forest-teal">Abrir painel da Meta<ExternalLink className="h-4 w-4" /></a>
      </div>

      <form onSubmit={saveConfiguration} className="mt-4 grid gap-3 md:grid-cols-2 md:items-end">
        <label className="text-xs font-semibold text-slate-ink">App ID
          <input value={appId} onChange={(event) => setAppId(event.target.value.replace(/\D/g, ""))} required inputMode="numeric" autoComplete="off" placeholder="ID numérico do aplicativo" className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
        </label>
        <label className="text-xs font-semibold text-slate-ink">Configuration ID
          <input value={configurationId} onChange={(event) => setConfigurationId(event.target.value.replace(/\D/g, ""))} required inputMode="numeric" autoComplete="off" placeholder="ID da configuração Embedded Signup v4" className="mt-1.5 min-h-10 w-full rounded-md border border-mist bg-white px-3 text-sm font-normal outline-none focus:border-deep-teal" />
        </label>
        <button type="submit" disabled={saving || !dirty} className="min-h-10 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-50 md:col-start-2">{saving ? "Salvando..." : "Salvar configuração"}</button>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-mist pt-4">
        <button type="button" onClick={launchSignup} disabled={!configured || !sdkReady || !pageUsesHttps || launching || dirty} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-deep-teal bg-white px-4 text-sm font-semibold text-deep-teal hover:bg-deep-teal/5 disabled:cursor-not-allowed disabled:opacity-45">
          {launching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {launching ? "Aguardando Meta..." : "Verificar telas da Meta"}
        </button>
        <span className="text-xs text-stone">SDK {sdkReady ? "carregado" : configured ? "carregando" : "aguardando configuração"} · {pageUsesHttps ? "HTTPS ativo" : "HTTPS obrigatório"} · Graph API {savedConfiguration.graphVersion}</span>
      </div>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-stone">Nesta fase, confirme que a Meta oferece a opção de conectar a conta existente e feche a janela antes da confirmação final. A conclusão real será liberada quando a troca segura do código temporário estiver implementada no servidor.</p>

      {oauthStatus !== "idle" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className={`border-l-2 pl-3 ${oauthStatus === "received" ? "border-deep-teal" : "border-mist"}`}>
            <p className="text-xs font-semibold text-stone">Login Meta</p>
            <p className="mt-1 text-sm font-semibold text-slate-ink">{oauthStatus === "received" ? "Código recebido e descartado" : oauthStatus === "waiting" ? "Aguardando código" : "Código não retornado"}</p>
          </div>
          <div className={`border-l-2 pl-3 ${sessionEvent ? "border-deep-teal" : "border-mist"}`}>
            <p className="text-xs font-semibold text-stone">Session logging</p>
            <p className="mt-1 text-sm font-semibold text-slate-ink">{sessionEvent ? `Evento recebido: ${sessionEvent.event ?? "desconhecido"}` : "Aguardando evento"}</p>
          </div>
          <div className={`border-l-2 pl-3 ${coexistenceConfirmed ? "border-deep-teal" : sessionEvent ? "border-burnt-coral" : "border-mist"}`}>
            <p className="text-xs font-semibold text-stone">Coexistência</p>
            <p className="mt-1 text-sm font-semibold text-slate-ink">{coexistenceConfirmed ? "Confirmada pela Meta" : sessionEvent?.event === "FINISH" ? "Não: fluxo Cloud API comum" : sessionEvent?.event === "CANCEL" ? "Não concluída" : "Aguardando confirmação"}</p>
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
      {message && <p role="status" className="mt-3 text-sm font-medium text-deep-teal">{message}</p>}
    </section>
  );
}