import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 3_000;

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  if (request.nextUrl.searchParams.get("db") !== "1") {
    return NextResponse.json({ status: "ok" }, { headers });
  }
  try {
    const { getMongoClient } = await import("@/lib/mongodb");
    const client = await withTimeout(getMongoClient(), DB_TIMEOUT_MS);
    await withTimeout(client.db("admin").command({ ping: 1 }), DB_TIMEOUT_MS);
    return NextResponse.json({ status: "ok", database: "ok" }, { headers });
  } catch (error) {
    console.error("Health check: database unavailable.", { errorType: error instanceof Error ? error.name : "Unknown" });
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503, headers });
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Health check timed out.")), milliseconds)),
  ]);
}
