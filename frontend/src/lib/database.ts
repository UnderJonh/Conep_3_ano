export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type PlayerInfo = {
  tensao?: number; pontos?: number; atualizado_em?: string; distancia?: number; distancia_cm?: number;
  pisadas?: number; ritmo?: number; multiplicador?: number; pico_tensao?: number; ultima_pisada_em?: string;
  [key: string]: Json | undefined;
};
export type Teste = {
  id: string; nome: string; owner_id: string; rodada_atual: number;
  infos_player_1: PlayerInfo; infos_player_2: PlayerInfo;
  status: 'aguardando' | 'rodando' | 'pausado' | 'finalizado'; revisao: number;
  modo: 'oficial' | 'treino'; corrida_inicio: string | null; corrida_fim: string | null; ultima_rodada_id: string | null;
  duracao_segundos: number; created_at: string; updated_at: string;
};
export type Resultado = {
  vencedor?: 1 | 2 | null; motivo?: 'tempo' | 'interrompida'; modo?: 'oficial' | 'treino';
  elegivel_ranking?: boolean; elegivel_arena?: boolean; regras_versao?: string; duracao_segundos?: number;
};
export type Rodada = {
  id: string; teste_id: string; numero: number;
  infos_player_1: PlayerInfo; infos_player_2: PlayerInfo;
  resultado: Resultado; created_at: string;
};
export type Ranking = { id: string; rodada_id: string; nome: string; player: number; pontos: number; distancia: number; pisadas: number; regras_versao: string; created_at: string };
export type ArenaRanking = Omit<Ranking, 'regras_versao'> & { teste_id: string; modo: 'oficial' | 'treino'; duracao_segundos: number };
export type Database = {
  public: {
    Tables: {
      testes: { Row: Teste; Insert: { nome: string }; Update: never; Relationships: [] };
      rodadas: { Row: Rodada; Insert: never; Update: never; Relationships: [] };
      ranking_mundial: { Row: Ranking; Insert: never; Update: never; Relationships: [] };
      ranking_arena: { Row: ArenaRanking; Insert: never; Update: never; Relationships: [] };
      teste_participantes: { Row: { teste_id: string; user_id: string }; Insert: never; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      configurar_dispositivo: { Args: { p_teste_id: string; p_player: number; p_token_hash: string }; Returns: undefined };
      alterar_status: { Args: { p_teste_id: string; p_status: string }; Returns: Teste };
      finalizar_rodada: { Args: { p_teste_id: string; p_rodada_esperada: number }; Returns: Teste };
      iniciar_corrida: { Args: { p_teste_id: string; p_modo: string; p_rodada_esperada: number; p_duracao_segundos?: number }; Returns: Teste };
      dispositivos_configurados: { Args: { p_teste_id: string }; Returns: number[] };
      registrar_vencedor_arena: { Args: { p_rodada_id: string; p_nome: string; p_publicar_mundial: boolean }; Returns: ArenaRanking };
      concluir_corrida: { Args: { p_teste_id: string }; Returns: Teste };
      pisada_treino: { Args: { p_teste_id: string; p_player: number; p_forca: number }; Returns: Json };
      registrar_vencedor: { Args: { p_rodada_id: string; p_nome: string }; Returns: Ranking };
      hora_servidor: { Args: Record<string, never>; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
