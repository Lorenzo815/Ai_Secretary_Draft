import { ImageResponse } from "next/og";

export function createOriaIcon(size: number) {
  const glyphSize = Math.round(size * 0.58);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0F766E",
        }}
      >
        <svg width={glyphSize} height={glyphSize} viewBox="0 0 40 40" fill="none">
          <path
            d="M20 4C11.163 4 4 11.163 4 20s7.163 16 16 16c6.627 0 12.283-4.03 14.708-9.77"
            stroke="#FCFAF6"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="20" cy="20" r="3" fill="#FCFAF6" />
          <path
            d="M34.708 10.23C32.283 4.49 26.627 4 20 4"
            stroke="#FCFAF6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="2 4"
          />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
