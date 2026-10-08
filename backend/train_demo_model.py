import argparse
import csv
import json
import random
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from demo_model import (
    ARTIFACT_DIR,
    BACKEND_DIR,
    DEMO_CLASSIFICATION_THRESHOLD,
    METADATA_PATH,
    MODEL_PATH,
    OBSERVATIONS_PATH,
    PATTERNS_PATH,
    RISK_MAP_PATH,
)


DATASET_PATH = BACKEND_DIR / "data" / "synthetic_risk_training.csv"
FEATURE_NAMES = [
    "latitude",
    "longitude",
    "traffic_volume_vehicles_per_hour",
    "average_speed_kmh",
    "historical_accidents_12mo",
    "hour_of_day",
    "day_of_week",
    "rainfall_mm",
    "visibility_m",
    "road_width_m",
    "curve_severity",
    "poor_lighting",
    "road_surface_code",
    "road_type_code",
]
DESCRIPTIVE_COLUMNS = [
    "observed_at",
    "location_name",
    "day_period",
    "weather_condition",
    "road_surface",
    "road_type",
]
TARGET_NAME = "synthetic_future_accident_observed"
CSV_COLUMNS = FEATURE_NAMES + DESCRIPTIVE_COLUMNS + [TARGET_NAME]
SEED = 2026
REPETITIONS_PER_SCENARIO = 4
SYNTHETIC_OUTCOME_THRESHOLD = 0.30
SYNTHETIC_LABEL_NOISE = 0.03
DAY_PERIODS = {
    "early_morning": (5, 0.45),
    "daytime": (12, 0.9),
    "evening_peak": (18, 1.25),
    "night": (23, 0.35),
}
WEATHER_CONDITIONS = ("clear", "rain", "fog")
ROAD_SURFACES = ("paved", "gravel", "unsealed")
ROAD_TYPES = ("arterial", "collector", "local")
SECTORS = [
    {"id": 1, "place_name": "Kangla Fort", "latitude": 24.8070, "longitude": 93.9368, "traffic": 760, "history": 11, "curve": 1, "width": 8.0, "surface": 0, "type": 0, "lighting": 0.7},
    {"id": 2, "place_name": "Ima Keithel", "latitude": 24.8110, "longitude": 93.9390, "traffic": 520, "history": 7, "curve": 2, "width": 6.5, "surface": 1, "type": 1, "lighting": 0.5},
    {"id": 3, "place_name": "Thangal Bazar", "latitude": 24.8177, "longitude": 93.9362, "traffic": 1120, "history": 16, "curve": 0, "width": 10.0, "surface": 0, "type": 0, "lighting": 0.8},
    {"id": 4, "place_name": "Paona Bazar", "latitude": 24.8157, "longitude": 93.9475, "traffic": 430, "history": 5, "curve": 3, "width": 5.5, "surface": 2, "type": 2, "lighting": 0.35},
    {"id": 5, "place_name": "Keishampat Junction", "latitude": 24.7996733, "longitude": 93.9350847, "traffic": 640, "history": 9, "curve": 1, "width": 7.0, "surface": 1, "type": 1, "lighting": 0.6},
    {"id": 6, "place_name": "Nagamapal", "latitude": 24.8215, "longitude": 93.9450, "traffic": 360, "history": 4, "curve": 2, "width": 6.0, "surface": 2, "type": 2, "lighting": 0.3},
    {"id": 7, "place_name": "Singjamei", "latitude": 24.7890, "longitude": 93.9390, "traffic": 890, "history": 13, "curve": 1, "width": 8.5, "surface": 0, "type": 1, "lighting": 0.65},
    {"id": 8, "place_name": "Khoyathong", "latitude": 24.8300, "longitude": 93.9320, "traffic": 300, "history": 3, "curve": 0, "width": 7.5, "surface": 0, "type": 2, "lighting": 0.75},
]


def synthetic_area_name(place_name):
    return f"{place_name} area (synthetic demo)"


def synthetic_incident_probability(row):
    night = row["day_period"] == "night"
    poor_visibility = max(0.0, (3500 - row["visibility_m"]) / 3500)
    traffic_pressure = min(row["traffic_volume_vehicles_per_hour"] / 2000, 1)
    history_signal = min(row["historical_accidents_12mo"] / 25, 1)

    probability = (
        0.015
        + traffic_pressure * 0.18
        + history_signal * 0.10
        + min(abs(row["average_speed_kmh"] - 35) / 50, 1) * 0.07
        + min(row["rainfall_mm"] / 40, 1) * 0.10
        + poor_visibility * 0.12
        + int(night) * 0.09
        + row["curve_severity"] / 3 * 0.10
        + row["poor_lighting"] * 0.07
        + row["road_surface_code"] / 2 * 0.035
        + row["road_type_code"] / 2 * 0.025
        + max(0.0, (8 - row["road_width_m"]) / 8) * 0.04
    )
    return min(max(probability, 0.02), 0.80)


def generate_dataset(path=DATASET_PATH):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)

    with path.open("w", newline="", encoding="utf-8") as dataset_file:
        writer = csv.DictWriter(dataset_file, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for sector in SECTORS:
            for day_of_week in range(7):
                for day_period, (base_hour, traffic_multiplier) in DAY_PERIODS.items():
                    for weather in WEATHER_CONDITIONS:
                        for _ in range(REPETITIONS_PER_SCENARIO):
                            if weather == "clear":
                                rainfall = round(rng.uniform(0, 0.5), 1)
                                visibility = rng.randint(4000, 10000)
                            elif weather == "rain":
                                rainfall = round(rng.uniform(3, 35), 1)
                                visibility = rng.randint(500, 6000)
                            else:
                                rainfall = round(rng.uniform(0, 1.5), 1)
                                visibility = rng.randint(100, 1800)

                            poor_lighting = int(
                                day_period == "night"
                                and rng.random() > sector["lighting"]
                            )
                            scenario_date = rng.choice([
                                date(2025, 1, 1) + timedelta(days=offset)
                                for offset in range(365)
                                if (date(2025, 1, 1) + timedelta(days=offset)).weekday()
                                == day_of_week
                            ])
                            scenario_hour = (base_hour + rng.randint(-1, 1)) % 24
                            observed_at = datetime.combine(
                                scenario_date,
                                time(scenario_hour, rng.randrange(60)),
                                tzinfo=timezone(timedelta(hours=5, minutes=30)),
                            )
                            row = {
                                "latitude": sector["latitude"],
                                "longitude": sector["longitude"],
                                "traffic_volume_vehicles_per_hour": max(
                                    20,
                                    round(sector["traffic"] * traffic_multiplier * rng.uniform(0.8, 1.2)),
                                ),
                                "average_speed_kmh": round(rng.uniform(12, 65), 1),
                                "historical_accidents_12mo": sector["history"],
                                "hour_of_day": (base_hour + rng.randint(-1, 1)) % 24,
                                "day_of_week": day_of_week,
                                "rainfall_mm": rainfall,
                                "visibility_m": visibility,
                                "road_width_m": sector["width"],
                                "curve_severity": sector["curve"],
                                "poor_lighting": poor_lighting,
                                "road_surface_code": sector["surface"],
                                "road_type_code": sector["type"],
                                "observed_at": observed_at.isoformat(),
                                "location_name": synthetic_area_name(sector["place_name"]),
                                "day_period": day_period,
                                "weather_condition": weather,
                                "road_surface": ROAD_SURFACES[sector["surface"]],
                                "road_type": ROAD_TYPES[sector["type"]],
                            }
                            row[TARGET_NAME] = int(
                                synthetic_incident_probability(row)
                                + rng.uniform(-SYNTHETIC_LABEL_NOISE, SYNTHETIC_LABEL_NOISE)
                                >= SYNTHETIC_OUTCOME_THRESHOLD
                            )
                            writer.writerow(row)

    return path


def load_rows(path):
    with Path(path).open(newline="", encoding="utf-8") as dataset_file:
        reader = csv.DictReader(dataset_file)
        if reader.fieldnames != CSV_COLUMNS:
            raise ValueError(f"Dataset columns must be exactly: {', '.join(CSV_COLUMNS)}")
        raw_rows = list(reader)

    if len(raw_rows) < 100:
        raise ValueError("Dataset must contain at least 100 rows.")

    rows = []
    try:
        for raw_row in raw_rows:
            row = {
                name: float(raw_row[name])
                for name in FEATURE_NAMES
            }
            row.update({name: raw_row[name] for name in DESCRIPTIVE_COLUMNS})
            row[TARGET_NAME] = int(raw_row[TARGET_NAME])
            if row[TARGET_NAME] not in (0, 1):
                raise ValueError(f"{TARGET_NAME} must contain only 0 or 1.")
            rows.append(row)
    except (TypeError, ValueError) as error:
        raise ValueError("Dataset contains invalid feature or target values.") from error

    if {row[TARGET_NAME] for row in rows} != {0, 1}:
        raise ValueError("Dataset must contain examples for both synthetic outcome classes.")
    return rows


def load_dataset(path):
    rows = load_rows(path)
    features = [[row[name] for name in FEATURE_NAMES] for row in rows]
    labels = [row[TARGET_NAME] for row in rows]
    return features, labels


def build_risk_map(model, rows):
    sector_rows = defaultdict(list)
    for row in rows:
        sector_rows[row["location_name"]].append(row)

    features_by_sector = {}
    for sector in SECTORS:
        name = synthetic_area_name(sector["place_name"])
        scenario_rows = sector_rows[name]
        feature_values = [[row[feature] for feature in FEATURE_NAMES] for row in scenario_rows]
        probabilities = model.predict_proba(feature_values)[:, 1]
        average_probability = float(probabilities.mean())
        representative_scenario = next(
            row for row in scenario_rows
            if row["day_period"] == "daytime" and row["weather_condition"] == "clear"
        )
        if average_probability >= 0.30:
            severity = "high"
        elif average_probability >= 0.18:
            severity = "moderate"
        else:
            severity = "low"

        features_by_sector[name] = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [sector["longitude"], sector["latitude"]],
            },
            "properties": {
                "name": name,
                "place_name": sector["place_name"],
                "location_name": name,
                "severity": severity,
                "risk_score": round(average_probability * 100),
                "synthetic_high_risk_probability": round(average_probability, 4),
                "historical_accidents_12mo": sector["history"],
                "scenario_count": len(scenario_rows),
                "road_type": ROAD_TYPES[sector["type"]],
                "road_surface": ROAD_SURFACES[sector["surface"]],
                "scenario_defaults": {
                    feature: representative_scenario[feature]
                    for feature in FEATURE_NAMES
                },
                "data_source": "synthetic_demo_model",
            },
        }

    return {
        "type": "FeatureCollection",
        "data_source": "synthetic_demo_model",
        "is_real_world_prediction": False,
        "warning": (
            "Illustrative synthetic sectors and model output; not actual crash records "
            "or real-world risk predictions."
        ),
        "features": list(features_by_sector.values()),
    }


def build_patterns(rows):
    groups = defaultdict(list)
    for row in rows:
        key = (
            row["location_name"],
            row["day_period"],
            row["weather_condition"],
            row["road_surface"],
        )
        groups[key].append(row[TARGET_NAME])

    patterns = []
    sector_coordinates = {
        synthetic_area_name(sector["place_name"]): sector
        for sector in SECTORS
    }
    for (location_name, day_period, weather, surface), outcomes in groups.items():
        incident_count = sum(outcomes)
        sector = sector_coordinates[location_name]
        patterns.append({
            "location_name": location_name,
            "latitude": sector["latitude"],
            "longitude": sector["longitude"],
            "day_period": day_period,
            "weather_condition": weather,
            "road_surface": surface,
            "scenario_count": len(outcomes),
            "synthetic_accident_observations": incident_count,
            "synthetic_incident_rate_percent": round(
                incident_count / len(outcomes) * 100, 1
            ),
            "data_source": "synthetic_demo_dataset",
        })

    patterns.sort(
        key=lambda pattern: (
            -pattern["synthetic_incident_rate_percent"],
            -pattern["scenario_count"],
            pattern["location_name"],
            pattern["day_period"],
            pattern["weather_condition"],
            pattern["road_surface"],
        )
    )
    return patterns


def build_observations(rows, limit=50):
    incidents = [
        row for row in rows
        if row[TARGET_NAME] == 1
    ]
    incidents.sort(key=lambda row: row["observed_at"], reverse=True)
    observations = [
        {
            "observation_id": f"synthetic-{index + 1:05d}",
            "observed_at": row["observed_at"],
            "location_name": row["location_name"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "synthetic_event": "Synthetic incident example",
            "day_period": row["day_period"],
            "weather_condition": row["weather_condition"],
            "rainfall_mm": row["rainfall_mm"],
            "visibility_m": row["visibility_m"],
            "traffic_volume_vehicles_per_hour": row[
                "traffic_volume_vehicles_per_hour"
            ],
            "average_speed_kmh": row["average_speed_kmh"],
            "road_type": row["road_type"],
            "road_surface": row["road_surface"],
            "historical_accidents_12mo": row["historical_accidents_12mo"],
            "data_source": "synthetic_demo_dataset",
        }
        for index, row in enumerate(incidents[:limit])
    ]
    return {
        "data_source": "synthetic_demo_dataset",
        "is_real_world_data": False,
        "total_synthetic_incident_examples": len(incidents),
        "returned": len(observations),
        "observations": observations,
        "warning": (
            "These are generated examples with illustrative timestamps and locations, "
            "not real accident records."
        ),
    }


def train_model(dataset_path=DATASET_PATH, artifact_dir=ARTIFACT_DIR):
    dataset_path = Path(dataset_path)
    artifact_dir = Path(artifact_dir)
    if not dataset_path.is_file():
        raise FileNotFoundError(
            f"Training dataset not found at {dataset_path}. "
            "Generate it with --generate-data."
        )

    rows = load_rows(dataset_path)
    features = [[row[name] for name in FEATURE_NAMES] for row in rows]
    labels = [row[TARGET_NAME] for row in rows]
    ordered_dates = sorted({row["observed_at"][:10] for row in rows})
    split_date_index = max(1, min(len(ordered_dates) - 1, int(len(ordered_dates) * 0.75)))
    test_start_date = ordered_dates[split_date_index]
    train_indexes = [
        index for index, row in enumerate(rows)
        if row["observed_at"][:10] < test_start_date
    ]
    test_indexes = [
        index for index, row in enumerate(rows)
        if row["observed_at"][:10] >= test_start_date
    ]
    x_train = [features[index] for index in train_indexes]
    y_train = [labels[index] for index in train_indexes]
    x_test = [features[index] for index in test_indexes]
    y_test = [labels[index] for index in test_indexes]
    if set(y_train) != {0, 1} or set(y_test) != {0, 1}:
        raise ValueError("Chronological train and test periods must each contain both outcome classes.")
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_leaf=4,
        random_state=SEED,
        n_jobs=1,
    )
    model.fit(x_train, y_train)
    probabilities = model.predict_proba(x_test)[:, 1]
    predictions = (probabilities >= DEMO_CLASSIFICATION_THRESHOLD).astype(int)

    risk_map = build_risk_map(model, rows)
    patterns = build_patterns(rows)
    observations = build_observations(rows)
    metrics = {
        "accuracy": round(accuracy_score(y_test, predictions), 4),
        "precision": round(precision_score(y_test, predictions, zero_division=0), 4),
        "recall": round(recall_score(y_test, predictions, zero_division=0), 4),
        "f1": round(f1_score(y_test, predictions, zero_division=0), 4),
    }
    metadata = {
        "data_source": "synthetic_demo",
        "is_real_world_model": False,
        "dataset_rows": len(rows),
        "test_rows": len(y_test),
        "train_period_end": ordered_dates[split_date_index - 1],
        "test_period_start": test_start_date,
        "features": FEATURE_NAMES,
        "target": TARGET_NAME,
        "synthetic_outcome_threshold": SYNTHETIC_OUTCOME_THRESHOLD,
        "synthetic_label_noise": SYNTHETIC_LABEL_NOISE,
        "metrics": metrics,
        "classification_threshold": DEMO_CLASSIFICATION_THRESHOLD,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "warning": (
            "The model and recurring patterns learn a hand-authored synthetic process. "
            "Test metrics measure imitation of synthetic labels, not crash-prediction "
            "performance. Map locations are illustrative."
        ),
        "risk_map_locations": len(risk_map["features"]),
        "pattern_groups": len(patterns),
        "total_synthetic_incident_examples": observations[
            "total_synthetic_incident_examples"
        ],
        "returned_observations": observations["returned"],
    }

    artifact_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, artifact_dir / MODEL_PATH.name)
    with (artifact_dir / METADATA_PATH.name).open("w", encoding="utf-8") as metadata_file:
        json.dump(metadata, metadata_file, indent=2)
        metadata_file.write("\n")
    for artifact_path, artifact in (
        (artifact_dir / RISK_MAP_PATH.name, risk_map),
        (artifact_dir / PATTERNS_PATH.name, {
            "data_source": "synthetic_demo_dataset",
            "is_real_world_data": False,
            "warning": metadata["warning"],
            "trained_at": metadata["trained_at"],
            "patterns": patterns,
        }),
        (artifact_dir / OBSERVATIONS_PATH.name, observations),
    ):
        with artifact_path.open("w", encoding="utf-8") as artifact_file:
            json.dump(artifact, artifact_file, indent=2)
            artifact_file.write("\n")
    return metadata


def main():
    parser = argparse.ArgumentParser(
        description="Train a model and risk-pattern demo from synthetic examples."
    )
    parser.add_argument(
        "--generate-data",
        action="store_true",
        help="Generate the reproducible synthetic training CSV before training.",
    )
    args = parser.parse_args()

    if args.generate_data or not DATASET_PATH.is_file():
        print(f"Generating synthetic demo dataset: {generate_dataset()}")
    metadata = train_model()
    print(json.dumps({
        "data_source": metadata["data_source"],
        "dataset_rows": metadata["dataset_rows"],
        "total_synthetic_incident_examples": metadata[
            "total_synthetic_incident_examples"
        ],
        "metrics": metadata["metrics"],
        "pattern_groups": metadata["pattern_groups"],
        "risk_map_locations": metadata["risk_map_locations"],
        "train_period_end": metadata["train_period_end"],
        "test_period_start": metadata["test_period_start"],
        "warning": metadata["warning"],
    }, indent=2))
    print(f"Model artifact saved to: {MODEL_PATH}")
    print(f"Dataset saved to: {DATASET_PATH}")


if __name__ == "__main__":
    main()
