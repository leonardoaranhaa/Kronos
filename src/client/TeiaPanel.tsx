import {
  TEIA_DISCLAIMER,
  TEIA_KIND_COLOR,
  TEIA_KIND_LABEL,
  TEIA_WINDOWS,
  formatTeiaClock,
  formatTeiaUsd,
  layoutTeia,
  type TeiaView,
  type TeiaWindowId
} from '../../shared/teia';

const WINDOW_LABEL: Record<TeiaWindowId, string> = {
  '15m': '15 min',
  '30m': '30 min',
  '1h': '1 h',
  '4h': '4 h'
};

export function TeiaPanel({
  view,
  windowId,
  pinned,
  loading,
  error,
  onWindow,
  onClose
}: {
  view: TeiaView | null;
  windowId: TeiaWindowId;
  pinned: boolean;
  loading: boolean;
  error: string;
  onWindow: (windowId: TeiaWindowId) => void;
  onClose: () => void;
}) {
  const events = view?.events ?? [];
  const layout = layoutTeia(events, 300, 200);
  const when = view ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(view.time) : '';

  return (
    <aside className="teia-panel" data-teia-panel="true" aria-label="Teia da vela">
      <div className="teia-head">
        <strong>Teia</strong>
        <span className="muted">{pinned ? 'fixada' : 'clique na vela para fixar'}</span>
        <button type="button" className="tool" onClick={onClose}>Fechar</button>
      </div>
      <p className="teia-honest">{TEIA_DISCLAIMER}</p>
      <div className="teia-windows" role="group" aria-label="Janela anterior à vela">
        {(Object.keys(TEIA_WINDOWS) as TeiaWindowId[]).map(id => (
          <button
            key={id}
            type="button"
            className={id === windowId ? 'tool on' : 'tool'}
            aria-pressed={id === windowId}
            onClick={() => onWindow(id)}
          >
            {WINDOW_LABEL[id]}
          </button>
        ))}
      </div>
      {when && <p className="muted">Vela das {when}. A janela é o período anterior a essa abertura.</p>}
      <svg className="teia-web" viewBox="0 0 300 200" role="img" aria-label="Vela no centro e eventos gravados antes dela">
        {layout.nodes.map(node => (
          <line key={`linha-${node.id}`} x1={layout.cx} y1={layout.cy} x2={node.x} y2={node.y} stroke="#64748b" strokeWidth="1" />
        ))}
        <circle cx={layout.cx} cy={layout.cy} r="18" fill="#e2e8f0" />
        <text x={layout.cx} y={layout.cy + 4} textAnchor="middle" fontSize="11" fill="#0f172a">Vela</text>
        {layout.nodes.map((node, index) => {
          const event = events[index];
          return (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r={node.r} fill={TEIA_KIND_COLOR[event.kind]} />
              <title>{`${TEIA_KIND_LABEL[event.kind]} ${event.title}`}</title>
            </g>
          );
        })}
      </svg>
      <p className="muted">O centro é a vela. O tamanho do ponto segue o dólar gravado, quando existe.</p>
      {loading && !view && <p>Lendo eventos gravados…</p>}
      {error && <p>{error}</p>}
      {view?.empty && <p className="teia-empty">{view.emptyMessage}</p>}
      {view?.recordingNote && !(view.emptyMessage && view.emptyMessage.includes(view.recordingNote)) && (
        <p className="muted">{view.recordingNote}</p>
      )}
      {view && view.truncated && (
        <p className="muted">Mostrando {view.events.length} de {view.total}. Entram os maiores valores em dólar e ao menos um de cada tipo gravado.</p>
      )}
      {events.length > 0 && (
        <ul className="teia-list">
          {events.map(event => (
            <li key={event.id}>
              <span className="muted">{formatTeiaClock(event.time)} </span>
              <strong>{TEIA_KIND_LABEL[event.kind]}</strong>
              {' '}{event.title}
              {event.usd !== null && event.kind !== 'baleia' && event.kind !== 'parede' ? ` · ${formatTeiaUsd(event.usd)}` : ''}
              <div className="muted">{event.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
