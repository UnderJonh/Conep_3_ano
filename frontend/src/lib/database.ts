export type RankingEntry = { id: string; nome: string; pontos: number; created_at: string };
export type CameraSettingsRow = {
  profile: 'desktop' | 'mobile';
  horizontal: number;
  vertical: number;
  zoom: number;
  updated_at: string;
};
export type Database = {
  public: {
    Tables: {
      crossy_ranking: { Row: RankingEntry & { owner_id: string }; Insert: never; Update: never; Relationships: [] };
      crossy_camera_settings: {
        Row: CameraSettingsRow;
        Insert: never;
        Update: Partial<Omit<CameraSettingsRow, 'profile'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      registrar_recorde_crossy: { Args: { p_id: string; p_nome: string; p_pontos: number }; Returns: RankingEntry };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
