export const voltage = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--';
export const time = (value?: string, date = false) => {
  if (!value || Number.isNaN(Date.parse(value))) return '--';
  return new Date(value).toLocaleString('pt-BR', date
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
export const statusLabel = { aguardando: 'Aguardando', rodando: 'Rodando', pausado: 'Pausado' };
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
