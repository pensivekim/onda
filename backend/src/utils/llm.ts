// LLM utility (same pattern as hi.genomic.cc)
// Gemini 2.5 Flash Lite primary, GPT-4.1-mini fallback via Cloudflare AI Gateway

const GATEWAY_BASE = "https://gateway.ai.cloudflare.com/v1/f6c784dae2ac774f3f877b4ba39a88d6/carebot";

interface LLMMessage { role: "system" | "user" | "assistant"; content: string; }

async function callGemini(apiKey: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
  const url = `${GATEWAY_BASE}/google-ai-studio/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const systemMsg = messages.find(m => m.role === "system");
  const userMsgs = messages.filter(m => m.role !== "system");
  const contents = userMsgs.map((msg, idx) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: idx === 0 && systemMsg ? `[Instructions]\n${systemMsg.content}\n\n[User]\n${msg.content}` : msg.content }],
  }));
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const json = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
  return json.candidates[0].content.parts[0].text;
}

async function callOpenAI(apiKey: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
  const url = `${GATEWAY_BASE}/openai/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4.1-mini", messages, temperature: 0.3, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json() as { choices: { message: { content: string } }[] };
  return json.choices[0].message.content;
}

export async function callLLM(
  env: { GEMINI_API_KEY?: string; OPENAI_API_KEY?: string },
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 256
): Promise<string> {
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  // Try Gemini first, fallback to OpenAI
  if (env.GEMINI_API_KEY) {
    try { return await callGemini(env.GEMINI_API_KEY, messages, maxTokens); } catch (e) {
      console.error("[LLM] Gemini failed:", (e as Error).message);
    }
  }
  if (env.OPENAI_API_KEY) {
    try { return await callOpenAI(env.OPENAI_API_KEY, messages, maxTokens); } catch (e) {
      console.error("[LLM] OpenAI failed:", (e as Error).message);
    }
  }
  throw new Error("All LLM providers failed");
}
