from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os
import base64

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))

API_URL = "https://api.groq.com/openai/v1/chat/completions"

MODEL = "openai/gpt-oss-20b"
VISION_MODEL = "qwen/qwen3.8-27b"

KEY_FILE = Path.home() / ".athena_key"
MAX_REQUEST_BYTES = 4 * 1024 * 1024
MAX_IMAGE_BYTES = 2 * 1024 * 1024

SYSTEM_PROMPT = """
You are ATHENA, a helpful, intelligent, general-purpose AI assistant
inspired by ChatGPT.

You were created by Adams Kwaku Tawiah, an independent developer
who is learning, growing and developing his skills.

Your mission is to help people with general conversations,
questions, explanations, ideas, reasoning and everyday tasks.

You specialise in programming, software development, computer
science and ethical cybersecurity.

You are powered by Groq. You are inspired by ChatGPT, but ATHENA
is its own independent project.

Be conversational, respectful, accurate and honest.
Explain difficult concepts clearly and adapt to the user's level.
Admit uncertainty instead of inventing information.
Support authorised and defensive cybersecurity learning only.
"""

class AthenaHandler(SimpleHTTPRequestHandler):
    def send_json(self, status, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/chat":
            self.send_json(404, {"error": "Endpoint not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))

            if length < 1 or length > MAX_REQUEST_BYTES:
                self.send_json(413, {"error": "Request is too large"})
                return

            payload = json.loads(self.rfile.read(length))
            incoming = payload.get("messages", [])
            image = payload.get("image")

            if not isinstance(incoming, list) or not incoming:
                self.send_json(400, {"error": "Please send a message"})
                return

            messages = [{"role": "system", "content": SYSTEM_PROMPT}]

            for item in incoming[-20:]:
                if not isinstance(item, dict):
                    continue

                role = item.get("role")
                content = item.get("content")

                if role not in ("user", "assistant"):
                    continue

                if not isinstance(content, str) or not content.strip():
                    continue

                messages.append({
                    "role": role,
                    "content": content[:6000]
                })

            if not any(m["role"] == "user" for m in messages):
                self.send_json(400, {"error": "No user message found"})
                return

            model = MODEL

            if image is not None:
                if not isinstance(image, str):
                    self.send_json(400, {"error": "Invalid image"})
                    return

                prefix = "data:image/jpeg;base64,"

                if not image.startswith(prefix):
                    self.send_json(400, {
                        "error": "Please upload a JPEG image."
                    })
                    return

                encoded = image[len(prefix):]

                try:
                    decoded = base64.b64decode(encoded, validate=True)
                except Exception:
                    self.send_json(400, {"error": "Invalid image data"})
                    return

                if len(decoded) > MAX_IMAGE_BYTES:
                    self.send_json(413, {
                        "error": "Image is too large. Please choose a smaller image."
                    })
                    return

                last_user = next(
                    (i for i in range(len(messages) - 1, 0, -1)
                     if messages[i]["role"] == "user"),
                    None
                )

                if last_user is None:
                    self.send_json(400, {"error": "No user message found"})
                    return

                messages[last_user]["content"] = [
                    {
                        "type": "text",
                        "text": messages[last_user]["content"]
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": image}
                    }
                ]

                model = VISION_MODEL

            key = os.environ.get("GROQ_API_KEY", "").strip()

            if not key and KEY_FILE.is_file():
                key = KEY_FILE.read_text(encoding="utf-8").strip()

            if not key:
                self.send_json(500, {
                    "error": "ATHENA's API key is not configured."
                })
                return

            request_data = json.dumps({
                "model": model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 700
            }).encode("utf-8")

            request = Request(
                API_URL,
                data=request_data,
                headers={
                    "Authorization": "Bearer " + key,
                    "Content-Type": "application/json",
                    "User-Agent": "ATHENA/1.0 (Python; Android)",
                    "Accept": "application/json"
                },
                method="POST"
            )

            with urlopen(request, timeout=90) as response:
                result = json.loads(response.read().decode("utf-8"))

            reply = result["choices"][0]["message"]["content"]

            self.send_json(200, {"reply": reply})

        except HTTPError as error:
            print("Groq returned HTTP status:", error.code)
            self.send_json(502, {
                "error": "Groq could not complete the request. Check the model, API key, and account limits."
            })

        except (URLError, TimeoutError):
            self.send_json(502, {
                "error": "Could not reach Groq. Check your internet connection."
            })

        except (ValueError, KeyError, IndexError, TypeError):
            self.send_json(500, {
                "error": "ATHENA received an unexpected response."
            })

        except Exception as error:
            print("Server error:", type(error).__name__)
            self.send_json(500, {"error": "Something went wrong in ATHENA."})

    def log_message(self, format, *args):
        print("%s - %s" % (self.log_date_time_string(), format % args))


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent)
    print(f"ATHENA server listening on port {PORT}")
    HTTPServer((HOST, PORT), AthenaHandler).serve_forever()
