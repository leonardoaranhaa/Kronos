/** Local Vite talks to the API on port 3000. A deployed page uses the same host and /ws. */
export function researchSocketUrl(locationLike: { protocol: string; hostname: string; port: string }): string {
  const wsProtocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
  if (locationLike.port === '5173') return `${wsProtocol}//${locationLike.hostname}:3000/ws`;
  const port = locationLike.port ? `:${locationLike.port}` : '';
  return `${wsProtocol}//${locationLike.hostname}${port}/ws`;
}
