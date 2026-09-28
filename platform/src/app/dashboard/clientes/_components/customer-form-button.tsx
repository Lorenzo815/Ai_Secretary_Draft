"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X } from "lucide-react";

interface EditableCustomer {
  id: string;
  name: string;
  whatsapp: string;
  relationshipStatus?: "new" | "returning" | "unknown";
  birthDate?: string;
  maskedCpf?: string;
  profession?: string;
  secondaryPhones?: string[];
  address?: {
    postalCode: string;
    street: string;
    neighborhood: string;
    city: string;
    state: string;
    number?: string;
    complement?: string;
  };
}

export default function CustomerFormButton({
  customer,
  onCreated,
  compact = false,
}: {
  customer?: EditableCustomer;
  onCreated?: (customer: { id: string; name: string; phone: string }) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(customer?.name ?? "");
  const [whatsapp, setWhatsapp] = useState(customer?.whatsapp ?? "");
  const [relationshipStatus, setRelationshipStatus] = useState(customer?.relationshipStatus ?? "unknown");
  const [birthDate, setBirthDate] = useState(customer?.birthDate ?? "");
  const [cpf, setCpf] = useState("");
  const [profession, setProfession] = useState(customer?.profession ?? "");
  const [secondaryPhones, setSecondaryPhones] = useState(customer?.secondaryPhones?.join(", ") ?? "");
  const [postalCode, setPostalCode] = useState(customer?.address?.postalCode ?? "");
  const [street, setStreet] = useState(customer?.address?.street ?? "");
  const [neighborhood, setNeighborhood] = useState(customer?.address?.neighborhood ?? "");
  const [city, setCity] = useState(customer?.address?.city ?? "");
  const [state, setState] = useState(customer?.address?.state ?? "");
  const [addressNumber, setAddressNumber] = useState(customer?.address?.number ?? "");
  const [addressComplement, setAddressComplement] = useState(customer?.address?.complement ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function changePostalCode(value: string) {
    setPostalCode(value);
    const initialPostalCode = customer?.address?.postalCode.replace(/\D/g, "") ?? "";
    if (value.replace(/\D/g, "") !== initialPostalCode) {
      setStreet("");
      setNeighborhood("");
      setCity("");
      setState("");
      setAddressNumber("");
      setAddressComplement("");
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(customer ? `/api/customers/${customer.id}` : "/api/customers", {
        method: customer ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          whatsapp,
          ...(customer ? {
            relationshipStatus,
            birthDate,
            cpf,
            profession,
            secondaryPhones: secondaryPhones.split(/[,;\n]/).map((phone) => phone.trim()).filter(Boolean),
            postalCode,
            street,
            neighborhood,
            city,
            state,
            addressNumber,
            addressComplement,
          } : {}),
        }),
      });
      const data = await response.json() as { customer?: { id: string; name?: string; phone?: string }; error?: string };
      if (!response.ok || !data.customer) throw new Error(data.error ?? "Não foi possível salvar o cliente.");
      setOpen(false);
      const created = { id: data.customer.id, name: data.customer.name ?? name.trim(), phone: data.customer.phone ?? whatsapp.replace(/\D/g, "") };
      onCreated?.(created);
      router.refresh();
      if (!customer && !onCreated) router.push(`/dashboard/clientes/${data.customer.id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o cliente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={customer
          ? "inline-flex min-h-10 items-center gap-2 rounded-md border border-mist bg-white px-3 text-sm font-semibold text-slate-ink hover:border-deep-teal/40"
          : compact
            ? "inline-flex min-h-10 items-center gap-2 rounded-md border border-deep-teal/30 px-3 text-xs font-semibold text-deep-teal hover:bg-deep-teal/5"
            : "inline-flex min-h-10 items-center gap-2 rounded-md bg-deep-teal px-4 text-sm font-semibold text-white hover:bg-forest-teal"}
      >
        {customer ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {customer ? "Editar cadastro" : compact ? "Criar cliente" : "Novo cliente"}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-ink/45 p-4 py-8" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="customer-form-title" className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="customer-form-title" className="font-heading text-lg font-semibold text-slate-ink">{customer ? "Editar cadastro completo" : "Cadastrar cliente"}</h2>
                <p className="mt-1 text-xs leading-5 text-stone">O WhatsApp é obrigatório e único. Mensagens futuras deste número serão atribuídas a este cadastro.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-stone hover:bg-soft-ivory" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Nome"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className={inputClass} /></Field>
              <Field label="WhatsApp"><input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} inputMode="tel" placeholder="5511999999999" className={inputClass} /></Field>
              {customer && (
                <>
                  <Field label="Tipo de paciente">
                    <select value={relationshipStatus} onChange={(event) => setRelationshipStatus(event.target.value as typeof relationshipStatus)} className={inputClass}>
                      <option value="unknown">Não classificado</option>
                      <option value="new">Paciente novo</option>
                      <option value="returning">Paciente de retorno</option>
                    </select>
                  </Field>
                  <Field label="Data de nascimento"><input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} className={inputClass} /></Field>
                  <Field label={`CPF${customer.maskedCpf ? ` atual ${customer.maskedCpf}` : ""}`}>
                    <input value={cpf} onChange={(event) => setCpf(event.target.value)} inputMode="numeric" placeholder={customer.maskedCpf ? "Deixe vazio para manter" : "000.000.000-00"} className={inputClass} />
                  </Field>
                  <Field label="Profissão"><input value={profession} onChange={(event) => setProfession(event.target.value)} maxLength={120} className={inputClass} /></Field>
                  <Field label="Telefones secundários" wide><textarea value={secondaryPhones} onChange={(event) => setSecondaryPhones(event.target.value)} rows={2} placeholder="Separe por vírgula" className={inputClass} /></Field>
                  <div className="sm:col-span-2 mt-2 border-t border-mist pt-4">
                    <p className="text-xs font-semibold uppercase text-deep-teal">Endereço</p>
                  </div>
                  <Field label="CEP"><input value={postalCode} onChange={(event) => changePostalCode(event.target.value)} inputMode="numeric" className={inputClass} /></Field>
                  <Field label="Número"><input value={addressNumber} onChange={(event) => setAddressNumber(event.target.value)} className={inputClass} /></Field>
                  <Field label="Logradouro"><input value={street} onChange={(event) => setStreet(event.target.value)} className={inputClass} /></Field>
                  <Field label="Bairro"><input value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)} className={inputClass} /></Field>
                  <Field label="Cidade"><input value={city} onChange={(event) => setCity(event.target.value)} className={inputClass} /></Field>
                  <Field label="Estado"><input value={state} onChange={(event) => setState(event.target.value)} maxLength={2} className={inputClass} /></Field>
                  <Field label="Complemento" wide><input value={addressComplement} onChange={(event) => setAddressComplement(event.target.value)} className={inputClass} /></Field>
                </>
              )}
            </div>
            {error && <p role="alert" className="mt-4 rounded-md bg-burnt-coral/5 px-3 py-2 text-sm text-burnt-coral">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-mist px-4 py-2.5 text-sm font-semibold text-slate-ink">Cancelar</button>
              <button type="button" onClick={() => void save()} disabled={busy || !name.trim() || !whatsapp.trim()} className="rounded-md bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Salvando..." : "Salvar cliente"}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

const inputClass = "mt-1.5 w-full rounded-lg border border-mist px-3 py-2.5 text-sm font-normal outline-none focus:border-deep-teal";

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block text-xs font-semibold text-slate-ink ${wide ? "sm:col-span-2" : ""}`}>{label}{children}</label>;
}
