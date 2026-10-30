const SYSTEM_PROMPT = `
You are ATHENA, a helpful and honest AI programming companion
created by Adams Kwaku Tawiah.
Explain programming clearly to beginners. Help with Python,
web development, Termux and authorized defensive cybersecurity.
Be respectful, accurate, and admit uncertainty when needed.
`;

const API_URL = "https://api.groq.com/openai/v1/chat/completions";

const MODEL = "openai/gpt-oss-20b";
const VISION_MODEL = "qwen/qwen3.8-27b";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/chat") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
    }

    try {
      const raw = await request.text();

      if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES) {
        return Response.json(
          { error: "Request is too large" },
          { status: 413 }
        );
      }

      const payload = JSON.parse(raw);
      const incoming = payload.messages;
      const image = payload.image;

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

        if (
          typeof item.content !== "string" ||
          !item.content.trim()
        ) continue;

        messages.push({
          role: item.role,
          content: item.content.slice(0, 6000)
        });
      }

      const lastUser = messages.findLastIndex(
        message => message.role === "user"
      );

      if (lastUser === -1) {
        return Response.json(
          { error: "No user message found" },
          { status: 400 }
        );
      }

      let model = MODEL;

      if (image !== undefined && image !== null) {
        const prefix = "data:image/jpeg;base64,";

        if (
          typeof image !== "string" ||
          !image.startsWith(prefix)
        ) {
          return Response.json(
            { error: "Please upload a valid JPEG image." },
            { status: 400 }
          );
        }

        const encoded = image.slice(prefix.length);

        if (
          !encoded ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
          encoded.length % 4 !== 0
        ) {
          return Response.json(
            { error: "Invalid image data" },
            { status: 400 }
          );
        }

        let decoded;

        try {
          decoded = atob(encoded);
        } catch {
          return Response.json(
            { error: "Invalid image data" },
            { status: 400 }
          );
        }

        if (decoded.length > MAX_IMAGE_BYTES) {
          return Response.json(
            { error: "Image is too large." },
            { status: 413 }
          );
        }

        messages[lastUser].content = [
          {
            type: "text",
            text: messages[lastUser].content
          },
          {
            type: "image_url",
            image_url: { url: image }
          }
        ];

        model = VISION_MODEL;
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
          model,
          messages,
          temperature: 0.7,
          max_tokens: 700
        })
      });

      if (!response.ok) {
        console.error("Groq status:", response.status);

        return Response.json(
          {
            error: "Groq could not complete the request. Check the API key, model, and account limits."
          },
          { status: 502 }
        );
      }

      const result = await response.json();
      const reply = result.choices?.[0]?.message?.content;

      if (typeof reply !== "string" || !reply.trim()) {
        throw new Error("Unexpected Groq response");
      }

      return Response.json({ reply });

    } catch (error) {
      console.error("ATHENA error:", error.name);

      return Response.json(
        { error: "ATHENA encountered an unexpected error." },
        { status: 500 }
      );
    }
  }
};
