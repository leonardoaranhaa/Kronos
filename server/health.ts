export type HealthFeedMode = 'binance' | 'replay';

export interface HealthSnapshot {
  status: 'ok' | 'degraded';
  ready: boolean;
  components: {
    feed: { status: string; healthy: boolean };
    model: { status: string; healthy: boolean };
  };
}

/** Readiness requires a functioning feed and a ready official model worker. */
export function getHealthSnapshot(
  feedMode: HealthFeedMode,
  feedStatus: string,
  modelStatus: string
): HealthSnapshot {
  const feedHealthy = feedMode === 'replay'
    ? feedStatus === 'replay' || feedStatus === 'replay-complete'
    : feedStatus === 'connected';
  const modelHealthy = modelStatus === 'ready';
  const ready = feedHealthy && modelHealthy;

  return {
    status: ready ? 'ok' : 'degraded',
    ready,
    components: {
      feed: { status: feedStatus, healthy: feedHealthy },
      model: { status: modelStatus, healthy: modelHealthy }
    }
  };
}
