# Full Application Audit

**Date:** 2026-09-19  
**Scope:** Functionality, data consistency, UI/UX, accessibility, responsive behavior, PWA behavior, and major application workflows.

## Executive summary

The application is generally coherent and builds successfully. The largest risks are consistency failures during partial errors and concurrent operations rather than basic UI breakage.

Highest priorities:

1. Make payment completion recoverable and idempotent.
2. Make outbound WhatsApp delivery idempotent.
3. Prevent concurrent overlapping calendar bookings.
4. Correct dashboard delivery metrics.
5. Guarantee loading-state cleanup after network failures.

## Confirmed findings

### 1. High — Payment completion can become permanently partial

**Files:**

- [`src/app/api/customers/[id]/payment/route.ts`](../../src/app/api/customers/%5Bid%5D/payment/route.ts)
- [`src/lib/payments/mercado-pago-webhook.ts`](../../src/lib/payments/mercado-pago-webhook.ts)
- [`src/lib/payments/completion.ts`](../../src/lib/payments/completion.ts)

A payment can be persisted as paid or rejected before customer state, automation events, and confirmation messages finish. If MongoDB, queueing, or messaging fails after the terminal payment status is saved, retries may see that the payment is no longer pending and skip the remaining work.

**Recommended fix:** Persist an idempotent payment-completion outbox job atomically with the payment transition and retry each side effect until complete.

### 2. High — Outbound WhatsApp delivery is not idempotent

**Files:**

- [`src/lib/assistant/agent/orchestrator.ts`](../../src/lib/assistant/agent/orchestrator.ts)
- [`src/lib/whatsapp/manual-messages.ts`](../../src/lib/whatsapp/manual-messages.ts)

External WhatsApp delivery, local message persistence, job completion, and CRM state changes are not atomic. WhatsApp may accept a message before local persistence fails, causing duplicate delivery on retry. Conversely, customer or job state may change even though an outbound message was not delivered.

**Recommended fix:** Introduce a durable outbound-message outbox with idempotency keys and explicit `queued`, `sending`, `sent`, `failed`, and `reconciled` states.

### 3. High — Concurrent calendar requests can create overlapping appointments

**File:** [`src/lib/calendar/calendar.ts`](../../src/lib/calendar/calendar.ts)

Permissions and blockers are correctly revalidated, but two simultaneous requests can both observe the same availability and then insert overlapping appointments. The current unique index protects identical `providerId + startAt` combinations, but not overlapping intervals with different start times or durations.

Example:

- Request A books `09:00–10:30`.
- Request B concurrently books `09:30–10:00`.
- Both availability checks can complete before either insertion becomes visible.

**Recommended fix:** Serialize bookings by professional and time range using transactional occupancy slots, a distributed resource lock, or another atomic reservation mechanism.

### 4. Medium — Appointment may be created while the API reports failure

**File:** [`src/lib/calendar/calendar.ts`](../../src/lib/calendar/calendar.ts)

The appointment is inserted before qualification scheduling is awaited. If qualification scheduling fails, the appointment remains in the calendar while the API reports a failed booking, encouraging a retry.

**Recommended fix:** Save an outbox event with the appointment transaction, or treat qualification scheduling as asynchronous without turning an already-created appointment into a failed booking response.

### 5. Medium — Dashboard WhatsApp delivery metrics query impossible statuses

**File:** [`src/lib/dashboard/overview.ts`](../../src/lib/dashboard/overview.ts)

The WhatsApp message collection is filtered using payment-related statuses such as `awaiting_human_confirmation`. Metrics such as “Entregues ou lidas” and “Falhas” can therefore display zero despite real message delivery records.

**Recommended fix:** Query actual WhatsApp statuses such as `sent`, `delivered`, `read`, and `failed`, and consistently apply the intended 24-hour period.

### 6. Medium — Closing a conversation can immediately produce a false alert

**Files:**

- [`src/lib/crm/customers.ts`](../../src/lib/crm/customers.ts)
- [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)

The “message received after closure” logic checks whether the conversation is closed and the latest message is inbound. It does not determine whether the message was actually received after closure.

**Recommended fix:** Persist `closedAt` or `serviceStatusChangedAt` and require the inbound message timestamp to be newer.

### 7. Medium — Calendar and payment controls can remain disabled after an error

**Files:**

- [`src/app/dashboard/calendario/page.tsx`](../../src/app/dashboard/calendario/page.tsx)
- [`src/app/dashboard/clientes/[id]/_components/payment-review-panel.tsx`](../../src/app/dashboard/clientes/%5Bid%5D/_components/payment-review-panel.tsx)

Some mutation handlers do not consistently use `try/catch/finally`. A timeout, rejected fetch, or non-JSON response can leave `busy` or `saving` enabled until the page is reloaded.

**Recommended fix:** Standardize mutation handling, explicitly handle non-JSON responses, and guarantee state cleanup in `finally`.

### 8. Medium — Agent Studio automation saves are not atomic

**Files:**

- [`src/lib/automation/repository.ts`](../../src/lib/automation/repository.ts)
- [`src/app/api/assistant/studio/route.ts`](../../src/app/api/assistant/studio/route.ts)

Rules are replaced individually before obsolete rules are deleted. A failure may create a partial configuration, and concurrent browser sessions can silently overwrite each other.

**Recommended fix:** Use a MongoDB transaction and expected configuration revision.

### 9. Medium — Concurrent Meta activation can leave multiple active connections

**File:** [`src/lib/whatsapp/embedded-signup.ts`](../../src/lib/whatsapp/embedded-signup.ts)

Demoting existing connections and activating the selected connection are separate operations. Concurrent activation requests can leave an ambiguous active WhatsApp configuration.

**Recommended fix:** Use a transaction plus a singleton active-connection record or enforceable unique active-state constraint.

### 10. Medium — Text and error colors fail accessibility contrast requirements

**File:** [`src/app/globals.css`](../../src/app/globals.css)

Measured examples:

- `text-stone` on white: approximately `2.52:1`.
- `text-stone` on ivory: approximately `2.42:1`.
- `text-stone` on sand: approximately `2.21:1`.
- Coral on white: approximately `3.09:1`.

Normal text generally requires at least `4.5:1`. This affects help text, timestamps, labels, validation messages, and destructive-operation feedback throughout the application.

**Recommended fix:** Darken semantic secondary-text and error tokens globally rather than fixing individual components.

### 11. Medium — Mobile drawer and dialogs have incomplete keyboard behavior

**Files:**

- [`src/app/dashboard/_components/sidebar.tsx`](../../src/app/dashboard/_components/sidebar.tsx)
- [`src/app/dashboard/calendario/page.tsx`](../../src/app/dashboard/calendario/page.tsx)
- [`src/app/dashboard/whatsapp/_components/templates-manager.tsx`](../../src/app/dashboard/whatsapp/_components/templates-manager.tsx)

Browser testing confirmed:

- The closed mobile drawer remains keyboard-focusable.
- Calendar dialogs open without moving focus into the dialog.
- Dialogs do not consistently trap focus or restore it to their trigger.

**Recommended fix:** Implement a reusable accessible dialog/drawer primitive with `inert`, `aria-hidden`, initial focus placement, focus trapping, Escape handling, and trigger focus restoration.

### 12. Low — Calendar permission form can default to the wrong date

**File:** [`src/app/dashboard/calendario/page.tsx`](../../src/app/dashboard/calendario/page.tsx)

The default date uses `new Date().toISOString()`, which is UTC. Near midnight, the date can differ from the configured clinic timezone.

**Recommended fix:** Generate the default date using `settings.timezone`.

### 13. Low — Mobile login has no accessible page heading

**File:** [`src/app/login/login-form.tsx`](../../src/app/login/login-form.tsx)

At the mobile breakpoint, the page’s main heading disappears from the accessibility tree.

**Recommended fix:** Retain an `h1` on mobile even if its visual presentation differs from desktop.

### 14. Low — First-install offline page may not render completely

**File:** [`public/sw.js`](../../public/sw.js)

Only `/offline` and `/icon.svg` are precached. Hashed JavaScript and CSS assets are cached only after normal controlled requests. On a newly installed PWA, the offline fallback may therefore load without all required styling or behavior.

**Recommended fix:** Generate a build-time precache manifest or make the offline fallback fully self-contained.

### 15. Low — CPF encryption depends on the authentication secret

**File:** [`src/lib/crm/customers.ts`](../../src/lib/crm/customers.ts)

When a dedicated encryption key is absent, CPF encryption depends on `NEXTAUTH_SECRET`. Rotating the authentication secret can make stored CPF values undecryptable.

**Recommended fix:** Require a dedicated, versioned `PII_ENCRYPTION_KEY` and define a key-rotation migration process.

### 16. Low — Internal calendar resource IDs can appear in customer UI

**File:** [`src/app/dashboard/clientes/[id]/page.tsx`](../../src/app/dashboard/clientes/%5Bid%5D/page.tsx)

Only one provider ID is translated into a friendly name. Other resources can appear as internal identifiers such as `technician`.

**Recommended fix:** Resolve every `providerId` through the configured calendar resources.

## Browser and responsive results

Authenticated pages inspected at a 390-pixel mobile viewport:

- Dashboard.
- Customer list and customer detail tabs.
- Calendar.
- Agent Studio.
- Operations.
- WhatsApp templates.
- System settings.
- Login and offline pages.

Positive findings:

- All major routes returned HTTP 200.
- No document-level horizontal overflow was found.
- Calendar permission and blocker controls remained usable at mobile width.
- The offline page has clear primary messaging and a recovery action.

External Meta authentication, live WhatsApp sending, AI-provider calls, and Mercado Pago transactions were intentionally not executed.

## Broader product improvements

1. Add route-level error boundaries with retry actions.
2. Allow individual dashboard sections to fail without taking down the entire page.
3. Replace native browser confirmations with consistent, accessible confirmation dialogs.
4. Add role-based permissions for payment review, data deletion, Agent Studio, and system settings.
5. Add richer audit history for configuration changes and destructive actions.
6. Add visible retry and reconciliation controls for failed jobs, messages, and payment transitions.
7. Add PWA install/update prompts and a persistent stale/offline-data indicator.
8. Centralize mutation feedback instead of mixing inline messages, alerts, and silent failures.

## Validation

- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Unit tests: 158 of 159 passed.
- The full suite repeatedly timed out at [`src/lib/qualification/customer-lead.test.ts`](../../src/lib/qualification/customer-lead.test.ts), although that test file passed when run independently.

## Recommended implementation order

1. Payment completion outbox.
2. WhatsApp outbound idempotency.
3. Atomic calendar occupancy.
4. Dashboard metric correction.
5. Mutation loading and error recovery.
6. False closed-conversation alerts.
7. Accessible dialog and navigation primitives.
8. Remaining lower-severity UX improvements.
