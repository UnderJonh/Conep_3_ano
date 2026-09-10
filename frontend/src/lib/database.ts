export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type PlayerInfo = { tensao?: number; pontos?: number; atualizado_em?: string; [key: string]: Json | undefined };
export type Teste = {
  id: string; nome: string; owner_id: string; rodada_atual: number;
  infos_player_1: PlayerInfo; infos_player_2: PlayerInfo;
  status: 'aguardando' | 'rodando' | 'pausado'; revisao: number;
  created_at: string; updated_at: string;
};
export type Rodada = {
  id: string; teste_id: string; numero: number;
  infos_player_1: PlayerInfo; infos_player_2: PlayerInfo;
  resultado: Json; created_at: string;
};
export type Database = {
  public: {
    Tables: {
      testes: { Row: Teste; Insert: { nome: string }; Update: never; Relationships: [] };
      rodadas: { Row: Rodada; Insert: never; Update: never; Relationships: [] };
      teste_participantes: { Row: { teste_id: string; user_id: string }; Insert: never; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      configurar_dispositivo: { Args: { p_teste_id: string; p_player: number; p_token_hash: string }; Returns: undefined };
      alterar_status: { Args: { p_teste_id: string; p_status: string }; Returns: Teste };
      finalizar_rodada: { Args: { p_teste_id: string; p_rodada_esperada: number }; Returns: Teste };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
