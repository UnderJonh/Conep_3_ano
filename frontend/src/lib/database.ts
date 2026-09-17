export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type PlayerInfo = {
  tensao?: number; atualizado_em?: string; comandos?: number; comando_em?: string; pico_tensao?: number;
  [key: string]: Json | undefined;
};
export type Teste = {
  id: string; nome: string; owner_id: string; infos_player_1: PlayerInfo;
  revisao: number; limiar_forte: number; created_at: string; updated_at: string;
};
export type RankingEntry = { id: string; nome: string; pontos: number; created_at: string };
export type Database = {
  public: {
    Tables: {
      testes: { Row: Teste; Insert: { nome: string }; Update: never; Relationships: [] };
      crossy_ranking: { Row: RankingEntry & { owner_id: string }; Insert: never; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      configurar_crossy: { Args: { p_teste_id: string; p_limiar: number }; Returns: Teste };
      configurar_dispositivo: { Args: { p_teste_id: string; p_player: number; p_token_hash: string }; Returns: undefined };
      dispositivos_configurados: { Args: { p_teste_id: string }; Returns: number[] };
      registrar_recorde_crossy: { Args: { p_id: string; p_nome: string; p_pontos: number }; Returns: RankingEntry };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
