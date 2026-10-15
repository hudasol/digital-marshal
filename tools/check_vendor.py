"""Check the vendored third party files against web/vendor/CHECKSUMS.txt. Standard library only."""
import base64
import hashlib
import sys
from pathlib import Path

VENDOR = Path(__file__).resolve().parent.parent / "web" / "vendor"


def main():
    ok = True
    for line in (VENDOR / "CHECKSUMS.txt").read_text().splitlines():
        parts = line.split()
        if not parts or parts[0].startswith("#"):
            continue
        kind, digest, name = parts[0], parts[1], parts[2]
        data = (VENDOR / name).read_bytes()
        if kind == "sha256":
            got = hashlib.sha256(data).hexdigest()
        elif kind == "sha384-base64":
            got = base64.b64encode(hashlib.sha384(data).digest()).decode()
        else:
            continue
        status = "OK" if got == digest else "MISMATCH"
        ok = ok and got == digest
        print("%s %s %s" % (kind, name, status))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
