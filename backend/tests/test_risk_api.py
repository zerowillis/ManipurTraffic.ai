from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import main
from services.risk_engine import RiskEngine, RiskFactors
from services.risk_repository import RiskRepository


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(
        main,
        "risk_repository",
        RiskRepository(tmp_path / "test-risk.sqlite3"),
    )

    def unavailable_traffic():
        raise RuntimeError("Live traffic data unavailable in this test.")

    monkeypatch.setattr(main.traffic_provider, "get_traffic", unavailable_traffic)
    return TestClient(main.app)


def observation(observed_at: str) -> dict:
    return {
        "location_id": "test-segment",
        "name": "Test segment",
        "latitude": 24.817,
        "longitude": 93.9368,
        "observed_at": observed_at,
        "source": "automated test fixture",
        "factors": {"traffic_volume": 1000},
    }


def test_engine_ignores_missing_factors_and_returns_unknown_when_empty():
    engine = RiskEngine()

    assert engine.calculate_score(
        RiskFactors(traffic_volume=500)
    ) == 50
    assert engine.calculate_score(RiskFactors()) is None
    assert engine.get_risk_level(None) == "unknown"


def test_engine_scores_each_supplied_risk_dimension():
    engine = RiskEngine()
    factors = RiskFactors(
        accident_count=2,
        accident_window_days=30,
        traffic_volume=500,
        traffic_delay_seconds=150,
        weather_factor=40,
        road_factor=20,
        time_factor=10,
    )

    assert engine.calculate_factor_scores(factors) == {
        "accident_history": 10,
        "traffic_volume": 50,
        "traffic_delay": 50,
        "weather": 40,
        "road_characteristics": 20,
        "time_conditions": 10,
    }
    assert engine.calculate_score(factors) == 30
    assert engine.get_risk_level(30) == "moderate"


def test_map_starts_empty_and_provider_does_not_claim_live_access(client):
    risk_map = client.get("/api/risk/map")
    provider = client.get("/api/traffic/provider")
    traffic = client.get("/api/traffic/roads")

    assert risk_map.status_code == 200
    assert risk_map.json()["status"] == "empty"
    assert risk_map.json()["locations"] == []
    assert provider.json()["status"] in {
        "not_configured",
        "authorization_pending",
    }
    assert "access_token" not in provider.text
    assert traffic.json()["status"] == "unavailable"
    assert traffic.json()["roads"] == []


def test_synthetic_demo_api_serves_generated_data_separately_from_records(client):
    model = client.get("/api/demo/model").json()
    locations = client.get("/api/demo/locations").json()
    risk_map = client.get("/api/demo/risk-map").json()
    patterns = client.get("/api/demo/risk-patterns").json()
    observations = client.get("/api/demo/observations").json()

    assert model["available"] is True
    assert model["data_source"] == "synthetic_demo"
    assert model["is_real_world_model"] is False
    assert model["dataset_rows"] == 2688
    assert {
        "historical_accidents_12mo",
        "traffic_volume_vehicles_per_hour",
        "road_width_m",
        "hour_of_day",
        "rainfall_mm",
        "latitude",
        "longitude",
    }.issubset(model["features"])
    assert locations["is_real_world_data"] is False
    assert len(locations["locations"]) == 8
    assert risk_map["is_real_world_prediction"] is False
    assert len(risk_map["features"]) == 8
    assert patterns["is_real_world_data"] is False
    assert len(patterns["patterns"]) == 96
    assert observations["is_real_world_data"] is False
    assert observations["returned"] == 50
    assert client.get("/api/risk/observations").json()["total_count"] == 0


def test_synthetic_model_predicts_for_selected_demo_location_without_seeding_records(client):
    location = client.get("/api/demo/locations").json()["locations"][0]
    payload = {
        **location["scenario_defaults"],
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "poor_lighting": bool(location["scenario_defaults"]["poor_lighting"]),
    }

    response = client.post("/api/demo/risk-prediction", json=payload)
    prediction = response.json()

    assert response.status_code == 200
    assert prediction["data_source"] == "synthetic_demo_model"
    assert prediction["is_real_world_prediction"] is False
    assert 0 <= prediction["synthetic_high_risk_probability"] <= 1
    assert prediction["synthetic_high_risk_label"] in (0, 1)
    assert "not a real-world" in prediction["warning"]
    assert client.get("/api/risk/observations").json()["total_count"] == 0


def test_synthetic_model_prediction_rejects_coordinates_outside_manipur(client):
    location = client.get("/api/demo/locations").json()["locations"][0]
    payload = {
        **location["scenario_defaults"],
        "latitude": 0,
        "longitude": location["longitude"],
        "poor_lighting": bool(location["scenario_defaults"]["poor_lighting"]),
    }

    assert client.post("/api/demo/risk-prediction", json=payload).status_code == 422


def test_live_route_endpoint_returns_route_geometry_and_source(client, monkeypatch):
    monkeypatch.setattr(
        main.traffic_provider,
        "get_live_route",
        lambda start, end: {
            "distance_meters": 1200,
            "travel_duration_seconds": 180,
            "traffic_delay_seconds": 25,
            "geometry": {
                "type": "LineString",
                "coordinates": [[93.9368, 24.817], [93.9362, 24.8177]],
            },
        },
    )
    response = client.post(
        "/api/traffic/route",
        json={
            "origin_latitude": 24.817,
            "origin_longitude": 93.9368,
            "destination_latitude": 24.8177,
            "destination_longitude": 93.9362,
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "available"
    assert response.json()["data_source"] == "TomTom"
    assert response.json()["distance_meters"] == 1200
    assert response.json()["traffic_delay_seconds"] == 25
    assert response.json()["geometry"]["type"] == "LineString"


def test_live_route_endpoint_returns_unavailable_when_provider_cannot_route(client, monkeypatch):
    def unavailable_route(start, end):
        raise RuntimeError("TOMTOM_API_KEY is not configured.")

    monkeypatch.setattr(main.traffic_provider, "get_live_route", unavailable_route)
    response = client.post(
        "/api/traffic/route",
        json={
            "origin_latitude": 24.817,
            "origin_longitude": 93.9368,
            "destination_latitude": 24.8177,
            "destination_longitude": 93.9362,
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "TOMTOM_API_KEY is not configured."


def test_observation_is_persisted_and_returned_with_explanation(client):
    response = client.post(
        "/api/risk/observations",
        json=observation("2026-10-05T08:15:00+05:30"),
    )

    assert response.status_code == 201
    point = response.json()
    assert point["risk_score"] == 100
    assert point["risk_level"] == "critical"
    assert point["factor_scores"] == {"traffic_volume": 100}
    assert point["factors_used"] == ["traffic_volume"]
    assert point["traffic_volume"] == 1000
    assert point["timestamp"] == "2026-10-05T02:45:00+00:00"

    listed = client.get("/api/risk/observations")
    assert listed.json()["total_count"] == 1
    assert listed.json()["observations"][0]["observation_id"] == point["observation_id"]


def test_map_and_patterns_aggregate_only_repeated_recorded_observations(client):
    response = client.post(
        "/api/risk/observations/batch",
        json={
            "observations": [
                observation("2026-09-28T08:15:00+05:30"),
                observation("2026-10-05T08:15:00+05:30"),
            ]
        },
    )
    risk_map = client.get("/api/risk/map").json()
    patterns = client.get("/api/risk/patterns").json()

    assert response.status_code == 201
    assert response.json()["created_count"] == 2
    assert risk_map["observation_count"] == 2
    assert risk_map["locations"][0]["risk_score"] == 100
    assert risk_map["locations"][0]["observation_count"] == 2
    assert patterns["timezone"] == "Asia/Kolkata"
    assert patterns["patterns"] == [
        {
            "location_id": "test-segment",
            "name": "Test segment",
            "hour_of_day": 8,
            "day_of_week": 0,
            "observation_count": 2,
            "high_risk_observation_count": 2,
            "high_risk_days": 2,
            "average_risk_score": 100,
            "risk_level": "critical",
        }
    ]


def test_same_day_records_do_not_count_as_a_recurring_pattern(client):
    client.post(
        "/api/risk/observations/batch",
        json={
            "observations": [
                observation("2026-10-05T08:15:00+05:30"),
                observation("2026-10-05T08:45:00+05:30"),
            ]
        },
    )

    assert client.get("/api/risk/patterns").json()["patterns"] == []


@pytest.mark.parametrize(
    "payload",
    [
        observation("2026-10-05T08:15:00+05:30")
        | {"factors": {"traffic_volume": -1}},
        observation("2026-10-05T08:15:00+05:30")
        | {"factors": {"accident_count": 1}},
        observation("2026-10-05T08:15:00")
        | {"factors": {"weather_factor": 50}},
        observation("2026-10-05T08:15:00+05:30")
        | {"factors": {}},
    ],
)
def test_invalid_or_missing_measurements_are_rejected(client, payload):
    response = client.post("/api/risk/observations", json=payload)

    assert response.status_code == 422
    assert client.get("/api/risk/observations").json()["total_count"] == 0


def test_repository_orders_and_paginates(tmp_path):
    repository = RiskRepository(tmp_path / "pagination.sqlite3")
    engine = RiskEngine()
    for day in (1, 2, 3):
        repository.add_many(
            [
                engine.create_risk_point(
                    name="Test location",
                    latitude=24.817,
                    longitude=93.9368,
                    factors=RiskFactors(weather_factor=day * 10),
                    data_source="automated test fixture",
                    timestamp=datetime(2026, 10, day, tzinfo=timezone.utc),
                    location_id="test-location",
                )
            ]
        )

    page = repository.list(limit=2, offset=0)
    assert repository.count() == 3
    assert [datetime.fromisoformat(point.timestamp).day for point in page] == [3, 2]
