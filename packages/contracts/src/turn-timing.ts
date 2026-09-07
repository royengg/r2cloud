export function turnTiming(turnId: string, warm: boolean) {
  const started = performance.now();
  let previous = started;
  return (stage: string, measurements: Record<string, number> = {}) => {
    if (process.env.R2_TRACE_TURNS !== '1') return;
    const now = performance.now();
    console.log(
      JSON.stringify({
        event: 'turn_timing',
        turnId,
        warm,
        stage,
        elapsedMs: Math.round(now - started),
        stageMs: Math.round(now - previous),
        ...measurements,
      }),
    );
    previous = now;
  };
}
