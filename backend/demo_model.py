import json
from pathlib import Path

import joblib


BACKEND_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = BACKEND_DIR / "artifacts"
MODEL_PATH = ARTIFACT_DIR / "synthetic_risk_model.joblib"
METADATA_PATH = ARTIFACT_DIR / "synthetic_risk_model.json"
RISK_MAP_PATH = ARTIFACT_DIR / "synthetic_risk_map.geojson"
PATTERNS_PATH = ARTIFACT_DIR / "synthetic_risk_patterns.json"
OBSERVATIONS_PATH = ARTIFACT_DIR / "synthetic_risk_observations.json"
DEMO_CLASSIFICATION_THRESHOLD = 0.35


def read_demo_metadata():
    if not METADATA_PATH.is_file():
        return None
    with METADATA_PATH.open(encoding="utf-8") as metadata_file:
        return json.load(metadata_file)


def read_demo_artifact(path):
    if not path.is_file():
        raise FileNotFoundError(f"Trained demo artifact not found: {path}")
    with path.open(encoding="utf-8") as artifact_file:
        return json.load(artifact_file)


def load_demo_model():
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(f"Trained demo model not found: {MODEL_PATH}")
    return joblib.load(MODEL_PATH)
