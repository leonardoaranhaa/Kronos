import express, { type Request, type Response } from 'express';
import { parseTeiaQuery } from '../../shared/teia';
import { buildTeiaMarkers, buildTeiaView, type TeiaPaths } from './read';

export async function sendTeia(req: Request, res: Response, paths: TeiaPaths): Promise<void> {
  const parsed = parseTeiaQuery(req.query as { [key: string]: unknown });
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const body = parsed.query.kind === 'vela'
      ? await buildTeiaView(paths, parsed.query)
      : await buildTeiaMarkers(paths, parsed.query);
    res.json(body);
  } catch {
    res.status(500).json({ error: 'Não foi possível ler a teia.' });
  }
}

/** GET /api/teia only. Used by the server and by the offline tests. */
export function createTeiaApp(paths: TeiaPaths) {
  const app = express();
  app.get('/api/teia', (req, res) => {
    void sendTeia(req, res, paths);
  });
  return app;
}
