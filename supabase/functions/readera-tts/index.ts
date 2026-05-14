const DEFAULT_ALLOWED_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
]);

const DEFAULT_ALLOWED_FORMATS = new Set(["mp3", "opus", "aac", "flac", "wav", "pcm"]);

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") || "*";
  const allowOrigin = Deno.env.get("READERA_TTS_ALLOW_ORIGIN") || origin;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Use POST." }, { status: 405, headers: cors });
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY não configurada na Edge Function." },
      { status: 501, headers: cors },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400, headers: cors });
  }

  const text = asString(body.text).trim();
  const maxChars = clamp(Number(Deno.env.get("READERA_TTS_MAX_CHARS") || 4096), 200, 4096);
  if (!text) {
    return Response.json({ error: "Campo text é obrigatório." }, { status: 400, headers: cors });
  }
  if (text.length > maxChars) {
    return Response.json(
      { error: `Texto acima do limite (${maxChars} caracteres).` },
      { status: 413, headers: cors },
    );
  }

  const fallbackVoice = Deno.env.get("READERA_TTS_VOICE") || "alloy";
  const requestedVoice = asString(body.voice) || fallbackVoice;
  const voice = DEFAULT_ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : fallbackVoice;
  const requestedFormat = asString(body.format) || "mp3";
  const responseFormat = DEFAULT_ALLOWED_FORMATS.has(requestedFormat) ? requestedFormat : "mp3";
  const speed = clamp(Number(body.rate || 1), 0.25, 4);

  const payload: Record<string, unknown> = {
    model: Deno.env.get("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts",
    input: text,
    voice,
    response_format: responseFormat,
    speed,
  };

  const instructions = Deno.env.get("READERA_TTS_INSTRUCTIONS");
  if (instructions) payload.instructions = instructions;

  const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: "Falha no provedor TTS.", detail: detail.slice(0, 500) },
      { status: upstream.status, headers: cors },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": upstream.headers.get("content-type") || "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
});
