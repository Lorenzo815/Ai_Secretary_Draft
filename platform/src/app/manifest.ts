import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Oria — Operação conversacional com IA",
    short_name: "Oria",
    description: "Atendimento no WhatsApp que entende pedidos, organiza clientes e realiza próximos passos.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#FCFAF6",
    theme_color: "#0F766E",
    orientation: "any",
    lang: "pt-BR",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/pwa-192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
