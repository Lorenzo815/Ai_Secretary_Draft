"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

type TabId = "summary" | "commercial" | "automation" | "conversation";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "summary", label: "Resumo" },
  { id: "commercial", label: "Comercial" },
  { id: "automation", label: "Automação" },
  { id: "conversation", label: "Conversa" },
];

export default function CustomerDetailTabs({
  summary,
  commercial,
  automation,
  conversation,
}: Record<TabId, ReactNode>) {
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const panels: Record<TabId, ReactNode> = { summary, commercial, automation, conversation };

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    setActiveTab(tabs[nextIndex].id);
    tabButtons.current[nextIndex]?.focus();
  }

  return (
    <div>
      <div className="border-b border-mist">
        <div role="tablist" aria-label="Informações do cliente" className="grid grid-cols-4 sm:flex sm:gap-6">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(element) => { tabButtons.current[index] = element; }}
              id={`customer-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`customer-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`min-w-0 border-b-2 px-1 pb-3 text-xs font-semibold transition-colors sm:text-sm ${
                activeTab === tab.id
                  ? "border-deep-teal text-deep-teal"
                  : "border-transparent text-stone hover:text-slate-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`customer-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`customer-tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          className="pt-6"
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}