export const hero = {
  title: "AI Secretary Platform for WhatsApp-First Businesses",
  subtitle:
    "A low-code assistant platform with multi-LLM routing, transparent usage pricing, and LATAM-ready messaging automation.",
  ctaPrimary: "Start MVP",
  ctaSecondary: "View Pricing"
};

export const highlights = [
  {
    title: "Transparent Cost Tracking",
    text: "Track token and channel costs in real time with clear monthly projections."
  },
  {
    title: "Dynamic Multi-LLM Routing",
    text: "Route each conversation to the best model for speed, quality, and budget."
  },
  {
    title: "WhatsApp First",
    text: "Native support for WhatsApp Cloud API and BSP-ready scaling path."
  },
  {
    title: "Low-Code + Pro-Code",
    text: "Visual flow builder for operators and extensible APIs for developers."
  }
];

export const pricingTiers = [
  {
    name: "Starter",
    price: "R$149/mo",
    audience: "Micro business",
    features: ["10k tokens", "500 WhatsApp messages", "1 channel"]
  },
  {
    name: "Growth",
    price: "R$499/mo",
    audience: "SMB and startups",
    features: ["50k tokens", "2.5k WhatsApp messages", "3 channels"]
  },
  {
    name: "Pro",
    price: "R$1499/mo",
    audience: "Mid-market and agencies",
    features: ["200k tokens", "10k WhatsApp messages", "API + white-label"]
  }
];

export const roadmap = [
  { quarter: "Q1", focus: "MVP", items: ["Flow builder basics", "Claude Haiku", "WhatsApp Cloud API"] },
  { quarter: "Q2", focus: "Launch", items: ["Multi-LLM support", "Onboarding wizard", "Analytics v1"] },
  { quarter: "Q3", focus: "Growth", items: ["Instagram/Messenger", "A/B tests", "Partner program"] },
  { quarter: "Q4", focus: "Enterprise", items: ["SSO", "RBAC", "Template marketplace beta"] }
];

export const kpis = [
  { label: "Market growth", value: "~26% YoY" },
  { label: "Break-even target", value: "Month 8-9" },
  { label: "Contribution margin", value: "70-75%" },
  { label: "ARR at month 18", value: "R$6.84M" }
];

export const part3 = {
  vision:
    "Become the reference AI virtual secretary platform in Latin America, helping companies automate support and sales with full cost visibility.",
  mission:
    "Democratize conversational AI with an intuitive, flexible, and transparent platform that scales without lock-in.",
  valuePillars: [
    {
      segment: "SMBs",
      promise: "AI secretary 24/7, multi-channel support, lower than one monthly salary cost."
    },
    {
      segment: "Agencies and developers",
      promise: "Build, customize, and scale client assistants with API and white-label support."
    },
    {
      segment: "Enterprise",
      promise: "Compliance, SLA, and legacy integrations with governance controls."
    }
  ],
  differentiators: [
    {
      title: "Dynamic Multi-LLM",
      detail: "Route each conversation to GPT, Claude, or Gemini based on quality, speed, and cost profile."
    },
    {
      title: "Total Cost Transparency",
      detail: "Show token, conversation, and channel costs in real time with monthly projections."
    },
    {
      title: "WhatsApp-First",
      detail: "Native LATAM strategy with Cloud API and BSP path for scale."
    },
    {
      title: "Low-Code + Pro-Code",
      detail: "Visual builder for operators and API extensibility for technical teams."
    },
    {
      title: "Setup Under 10 Minutes",
      detail: "Templates and guided wizard reduce time-to-value for first deployment."
    },
    {
      title: "LGPD/GDPR Native",
      detail: "Compliance-first architecture lowers legal and procurement friction."
    }
  ],
  resources: [
    {
      name: "Flow Builder",
      points: [
        "Trigger-action-condition blocks",
        "Human handoff with conversation context",
        "Webhook and CRM actions"
      ]
    },
    {
      name: "Multi-LLM Router",
      points: [
        "Default economical model",
        "Rule-based upgrades for complex cases",
        "Provider independence"
      ]
    },
    {
      name: "WhatsApp Integration",
      points: [
        "Template and session messages",
        "Interactive buttons and lists",
        "Cloud API and BSP strategy"
      ]
    },
    {
      name: "Analytics",
      points: [
        "Conversation KPIs",
        "AI quality and handoff rates",
        "Cost and conversion dashboards"
      ]
    }
  ],
  architectureLayers: [
    {
      layer: "Frontend",
      stack: "Next.js 14, React, TypeScript",
      notes: "Flow builder UI, dashboard views, responsive client experience"
    },
    {
      layer: "API Layer",
      stack: "Next.js API routes or tRPC",
      notes: "Auth, validation, and rate limiting"
    },
    {
      layer: "Orchestration",
      stack: "Flow engine, LLM router, queue workers",
      notes: "Conversation execution, retries, webhook dispatch"
    },
    {
      layer: "Data",
      stack: "MongoDB, Redis, object storage, analytics DB",
      notes: "State, sessions, files, and reporting data"
    }
  ]
};
