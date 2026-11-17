export interface TraceStage {
  stage: string;
  ms: number;
  ok: boolean;
  detail?: string;
}

export interface PipelineTrace {
  stages: TraceStage[];
  totalMs: number;
  coordinateSource: "gps" | "gazetteer" | "unresolved";
}

export async function timeStage<T>(
  stages: TraceStage[],
  name: string,
  fn: () => Promise<T> | T,
  detailFn?: (result: T) => string | undefined
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round((performance.now() - start) * 10) / 10;
    const detail = detailFn ? detailFn(result) : undefined;
    stages.push({
      stage: name,
      ms: duration,
      ok: true,
      ...(detail !== undefined ? { detail } : {}),
    });
    return result;
  } catch (error: unknown) {
    const duration = Math.round((performance.now() - start) * 10) / 10;
    stages.push({
      stage: name,
      ms: duration,
      ok: false,
    });
    throw error;
  }
}
