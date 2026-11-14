import { loadEnvFile } from '../load-env';
import { importFuturesVision } from './import-vision';
import { futuresRoot } from './paths';
import { FUTURES_PROTOCOL } from './protocol';
import { runFuturesValidation } from './validate';

loadEnvFile();

async function main(): Promise<void> {
  const command = process.argv[2] || 'validate';
  if (command === 'import') {
    const manifests = await importFuturesVision({
      root: futuresRoot(),
      onProgress: message => console.log(`[futuros] ${message}`)
    });
    for (const manifest of manifests) {
      console.log(`${manifest.symbol}: ${manifest.klines} candles, ${manifest.firstOpenTime} → ${manifest.lastOpenTime}`);
    }
    return;
  }
  if (command === 'validate') {
    const report = runFuturesValidation();
    const rows = report.strategies.filter(strategy => strategy.family.startsWith('futuros-'));
    console.log(rows.map(strategy => `${strategy.name}: ${strategy.verdict}`).join('\n'));
    return;
  }
  throw new Error(`Comando desconhecido: ${command}. Use import ou validate.`);
}

main().catch(error => {
  console.error('[futuros]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
