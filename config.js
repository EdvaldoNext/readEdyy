// Supabase: projeto ligado a este repositório (ver SUPABASE_INDEPENDENCIA.md → ReadEra).
// A chave anon é pública no browser por design; nunca coloque service_role aqui.
window.READERA_SUPABASE = window.READERA_SUPABASE || {
  url: 'https://ezcmdbcxgqvonqewgvrm.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6Y21kYmN4Z3F2b25xZXdndnJtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMzEwMTksImV4cCI6MjA5MjcwNzAxOX0.nhIG0xqRAkSIZB4P7BzsUItcXg2N4ctbGdtfGa-NnOM'
};

// TTS backend opcional. Quando esta Edge Function estiver publicada e com OPENAI_API_KEY,
// a voz deixa de depender de speechSynthesis; o navegador fica apenas como fallback.
window.READERA_TTS = window.READERA_TTS || {
  mode: 'auto',
  endpoint: 'https://ezcmdbcxgqvonqewgvrm.supabase.co/functions/v1/readera-tts',
  voice: 'alloy',
  format: 'mp3',
  maxChars: 3800
};
