import json
import pathlib
import sys

PATH = pathlib.Path(__file__).resolve().parent / "local.json"


def value(key):
    try:
        return json.loads(PATH.read_text())[key]
    except (OSError, ValueError, KeyError):
        print(f"{PATH.name}: no value for {key}, see local.example.json", file=sys.stderr)
        return f"missing-{key}"
