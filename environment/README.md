# Environment

Point queue models and all repository tests use the Python standard library only (tested with Python 3.13; CI uses 3.12).

SUMO work needs the pinned packages in `requirements.txt`:

```
python -m venv .venv
source .venv/bin/activate        # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r environment/requirements.txt
```

`sumo` and `netconvert` are provided by the `eclipse-sumo` package and must be on PATH (they are inside an activated environment). `libsumo` is not used; the scripts use `traci`.
