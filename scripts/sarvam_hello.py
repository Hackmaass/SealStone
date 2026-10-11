"""One Sarvam chat completion. Reads SARVAM_API_KEY from the environment (or from .env); never prints it."""
import os
import sys
from pathlib import Path

from sarvamai import SarvamAI


def load_dotenv_key() -> None:
    # Tiny .env reader so no extra dependency is needed. A real environment variable wins.
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if "SARVAM_API_KEY" in os.environ or not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        name, _, value = line.partition("=")
        if name.strip() == "SARVAM_API_KEY" and value.strip():
            os.environ["SARVAM_API_KEY"] = value.strip().strip('"').strip("'")


load_dotenv_key()
api_key = os.environ.get("SARVAM_API_KEY", "").strip()
if not api_key:
    sys.exit("SARVAM_API_KEY is not set. Paste your key into .env after SARVAM_API_KEY=")

client = SarvamAI(api_subscription_key=api_key)
response = client.chat.completions(
    model="sarvam-105b-conversations",
    messages=[{"role": "user", "content": "In one sentence, what is an escrow?"}],
)
print(response.choices[0].message.content)
