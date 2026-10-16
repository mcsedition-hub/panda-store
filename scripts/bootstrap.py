"""Create local secrets once; never overwrite an existing environment file."""

import argparse
import base64
import os
import re
import secrets
from pathlib import Path


def main(root=None, *, add_credential_key=False):
    root = root or Path(__file__).resolve().parent.parent
    target = root / ".env"
    content = (root / ".env.example").read_text()
    for key in ("DJANGO_SECRET_KEY", "PANDA_DEMO_PASSWORD", "POSTGRES_PASSWORD"):
        content = content.replace(f"{key}=\n", f"{key}={secrets.token_urlsafe(48)}\n")
    content = content.replace(
        "PANDA_CREDENTIAL_KEYS=\n",
        f"PANDA_CREDENTIAL_KEYS={base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()}\n",
    )
    try:
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if add_credential_key:
            with target.open("r+") as file:
                existing = file.read()
                if not re.search(r"^\s*(?:export\s+)?PANDA_CREDENTIAL_KEYS\s*=", existing, re.M):
                    key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
                    file.write(f"\nPANDA_CREDENTIAL_KEYS={key}\n")
                    print(
                        "Added credential encryption key. Restart the backend. "
                        "Other values are unchanged."
                    )
                    return
        print("Existing .env preserved. No credentials changed.")
        return
    with os.fdopen(descriptor, "w") as file:
        file.write(content)
    print("Created .env with random secrets. Open the app to set up your organization and account.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--add-credential-key",
        action="store_true",
        help="Add only a missing credential key to an existing installation.",
    )
    main(add_credential_key=parser.parse_args().add_credential_key)
