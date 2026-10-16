"""Create local secrets once; never overwrite an existing environment file."""

import os
import secrets
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    target = root / ".env"
    content = (root / ".env.example").read_text()
    for key in ("DJANGO_SECRET_KEY", "PANDA_DEMO_PASSWORD", "POSTGRES_PASSWORD"):
        content = content.replace(f"{key}=\n", f"{key}={secrets.token_urlsafe(48)}\n")
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        print("Existing .env preserved. No credentials changed.")
        return
    with os.fdopen(descriptor, "w") as file:
        file.write(content)
    print("Created .env with random secrets. Open the app to set up your organization and account.")


if __name__ == "__main__":
    main()
