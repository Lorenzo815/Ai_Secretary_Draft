"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

type SectionId = "operation" | "performance" | "automation" | "customers";

const sections: Array<{ id: SectionId; label: string }> = [
  { id: "operation", label: "Operação" },
  { id: "performance", label: "Desempenho" },
  { id: "automation", label: "Automação" },
  { id: "customers", label: "Clientes" },
];

export default function DashboardSections(props: Record<SectionId, ReactNode>) {
  const [activeSection, setActiveSection] = useState<SectionId>("operation");
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % sections.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + sections.length) % sections.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = sections.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    setActiveSection(sections[nextIndex].id);
    tabButtons.current[nextIndex]?.focus();
  }

  return (
    <div>
      <div className="border-b border-mist">
        <div role="tablist" aria-label="Seções da visão geral" className="grid grid-cols-4 sm:flex sm:gap-7">
          {sections.map((section, index) => (
            <button
              key={section.id}
              ref={(element) => { tabButtons.current[index] = element; }}
              id={`dashboard-tab-${section.id}`}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              aria-controls={`dashboard-panel-${section.id}`}
              tabIndex={activeSection === section.id ? 0 : -1}
              onClick={() => setActiveSection(section.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`min-w-0 border-b-2 px-1 pb-3 text-xs font-semibold transition-colors sm:text-sm ${
                activeSection === section.id
                  ? "border-deep-teal text-deep-teal"
                  : "border-transparent text-stone hover:text-slate-ink"
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div
        id={`dashboard-panel-${activeSection}`}
        role="tabpanel"
        aria-labelledby={`dashboard-tab-${activeSection}`}
        className="pt-7"
      >
        {props[activeSection]}
      </div>
    </div>
  );
}