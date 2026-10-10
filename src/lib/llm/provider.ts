import { getEnv } from "../env";

export async function chat(messages: { role: string; content: string }[], model?: string): Promise<string> {
  const env = getEnv();
  
  if (env.LLM_PROVIDER === "mock") {
    return `{"hazard_category":"unknown","severity_level":5,"raw_location":""}`;
  }

  const payload = {
    model: model || env.LLM_MODEL_EXTRACT,
    messages,
    temperature: 0
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  let res: Response;

  const url = `${env.LLM_BASE_URL}/chat/completions`;

  try {
    const fetchChat = () => fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.LLM_API_KEY}`,
        "HTTP-Referer": "https://safai-kavach.vercel.app",
        "X-Title": "SafaiKavach"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    res = await fetchChat();
    
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 500));
      res = await fetchChat();
    }
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    throw new Error(`LLM Network Error: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`LLM returned ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty content from LLM");
  }

  return content;
}
