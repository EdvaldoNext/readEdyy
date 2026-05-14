window.READERA_SUPABASE = {
  url: 'https://ezcmdbcxgqvonqewgvrm.supabase.co',
  anonKey: 'COPIE_A_CHAVE_ANON_EM_SETTINGS_API'
};

// Opcional: endpoint backend para gerar voz sem depender de speechSynthesis do navegador.
// Deploy sugerido: Supabase Edge Function `readera-tts`.
window.READERA_TTS = {
  mode: 'auto', // auto = usa backend se endpoint existir; navegador vira fallback.
  endpoint: 'https://ezcmdbcxgqvonqewgvrm.supabase.co/functions/v1/readera-tts',
  voice: 'alloy',
  format: 'mp3',
  maxChars: 3800
};
