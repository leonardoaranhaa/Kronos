export interface RecordedDataset {
  symbol: string;
  interval: string;
  normalizedPath: string;
  normalizedSha256: string;
}

/**
 * The M3 before/after comparison has to reuse the snapshot named in the M2
 * report. A newer BTCUSDT 1h file in the same folder is a different experiment.
 */
export function recordedM2Dataset(
  report: { datasets?: readonly RecordedDataset[] },
  symbol: string,
  interval: string
): RecordedDataset {
  const dataset = report.datasets?.find(row => row.symbol === symbol && row.interval === interval);
  if (!dataset?.normalizedPath || !dataset.normalizedSha256) {
    throw new Error(
      `O relatório M2 não registra o snapshot ${symbol} ${interval}. A comparação não escolhe outro arquivo.`
    );
  }
  return dataset;
}
