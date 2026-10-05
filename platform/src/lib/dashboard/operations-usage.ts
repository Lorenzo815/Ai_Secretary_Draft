import { normalizeModelUsage, type NormalizedModelUsage } from "../ai/model-usage";

export function collectAudioTranscriptionModelIds(calls: Array<{
  model: string;
  usage?: unknown;
  normalizedUsage?: NormalizedModelUsage | null;
}>) {
  return new Set(calls.flatMap((call) => {
    const usage = call.normalizedUsage ?? normalizeModelUsage(call.usage);
    return usage?.audioDurationSeconds === undefined ? [] : [call.model.toLowerCase()];
  }));
}
