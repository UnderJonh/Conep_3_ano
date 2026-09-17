import type { RankingEntry } from '../lib/database';

export function PlayerRanking({ entries, loading, error, shared, storageAvailable, onRetry }: {
  entries: RankingEntry[]; loading: boolean; error: string; shared: boolean; storageAvailable: boolean; onRetry(): void;
}) {
  return <div className="player-ranking">
    <p className="small">{shared ? 'Os 20 melhores recordes de todos os jogadores.' : storageAvailable ? 'Recordes salvos neste navegador.' : 'Armazenamento indisponível. Os recordes ficam salvos somente até fechar esta página.'}</p>
    {loading ? <p role="status">Carregando ranking…</p> : null}
    {error ? <div role="alert" className="setup-error">{error}<button className="secondary-button" onClick={onRetry}>Tentar novamente</button></div> : null}
    {entries.length ? <table className="ranking-table"><caption className="visually-hidden">Ranking de jogadores por pontuação</caption><thead><tr><th scope="col">Posição</th><th scope="col">Jogador</th><th scope="col">Passos</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={entry.id}><td>{index + 1}</td><th scope="row">{entry.nome}</th><td>{entry.pontos}</td></tr>)}</tbody></table> : !loading && !error ? <p className="ranking-empty">Ainda não há recordes. Jogue e marque o primeiro!</p> : null}
  </div>;
}
