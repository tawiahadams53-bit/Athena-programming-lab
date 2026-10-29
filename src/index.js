const SYSTEM_PROMPT = `
You are ATHENA, a helpful and honest AI programming companion
created by Adams Kwaku Tawiah.
Explain programming clearly to beginners. Help with Python,
web development, Termux and authorized defensive cybersecurity.
Be respectful, accurate, and admit uncertainty when needed.
`;

const API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-20b";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 }
        );
      }

      try {
        const length = Number(request.headers.get("Content-Length") || 0);

        if (length > 32000) {
          return Response.json(
            { error: "Message is too large" },
            { status: 413 }
          );
        }

        const raw = await request.text();

        if (new TextEncoder().encode(raw).length > 32000) {
          return Response.json(
            { error: "Message is too large" },
            { status: 413 }
          );
        }

        const payload = JSON.parse(raw);
        const incoming = payload.messages;

        if (!Array.isArray(incoming) || incoming.length === 0) {
          return Response.json(
            { error: "Please send a message" },
            { status: 400 }
          );
        }

        const messages = [
          { role: "system", content: SYSTEM_PROMPT }
        ];

        for (const item of incoming.slice(-20)) {
          if (!item || typeof item !== "object") continue;

          if (!["user", "assistant"].includes(item.role)) continue;
          if (typeof item.content !== "string" || !item.content.trim()) continue;

          messages.push({
            role: item.role,
            content: item.content.slice(0, 6000)
          });
        }

        if (!messages.some(m => m.role === "user")) {
          return Response.json(
            { error: "No user message found" },
            { status: 400 }
          );
        }

        if (!env.GROQ_API_KEY) {
          return Response.json(
            { error: "ATHENA's API key is not configured." },
            { status: 500 }
          );
        }

        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: 0.7,
            max_tokens: 700
          })
        });

        if (!response.ok) {
          return Response.json({
            error: "Groq could not complete the request. Check the API key, model, and account limits."
          }, { status: 502 });
        }

        const result = await response.json();
        const reply = result.choices?.[0]?.message?.content;

        if (typeof reply !== "string") {
          throw new Error("Unexpected Groq response");
        }

        return Response.json({ reply });

      } catch (error) {
        console.error("ATHENA error:", error.name);

        return Response.json({
          error: "ATHENA encountered an unexpected error."
        }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
