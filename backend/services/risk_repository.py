from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Iterable

from models.risk import RiskPoint


class RiskRepository:
    """Small SQLite repository for submitted, source-attributed observations."""

    def __init__(self, database_path: str | Path | None = None):
        configured_path = database_path or os.getenv("RISK_DATABASE_PATH")
        if configured_path:
            self.database_path = Path(configured_path)
        elif os.getenv("VERCEL") == "1":
            self.database_path = Path("/tmp/manipurtraffic-risk-observations.sqlite3")
        else:
            self.database_path = (
                Path(__file__).resolve().parents[1]
                / "data"
                / "risk_observations.sqlite3"
            )

    def _connect(self) -> sqlite3.Connection:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS risk_observations (
                observation_id TEXT PRIMARY KEY,
                location_id TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                risk_score REAL,
                payload TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_risk_location_time "
            "ON risk_observations (location_id, observed_at)"
        )
        connection.commit()
        return connection

    def add_many(self, observations: Iterable[RiskPoint]) -> None:
        rows = [
            (
                observation.observation_id,
                observation.location_id,
                observation.timestamp,
                observation.risk_score,
                observation.model_dump_json(),
            )
            for observation in observations
        ]
        if not rows:
            return

        with closing(self._connect()) as connection:
            with connection:
                connection.executemany(
                    """
                    INSERT INTO risk_observations (
                        observation_id, location_id, observed_at, risk_score, payload
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    rows,
                )

    def list(self, limit: int = 500, offset: int = 0) -> list[RiskPoint]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT payload
                FROM risk_observations
                ORDER BY observed_at DESC, observation_id ASC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            ).fetchall()
        return [RiskPoint.model_validate_json(row["payload"]) for row in rows]

    def list_all(self) -> list[RiskPoint]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT payload
                FROM risk_observations
                ORDER BY observed_at ASC, observation_id ASC
                """
            ).fetchall()
        return [RiskPoint.model_validate_json(row["payload"]) for row in rows]

    def count(self) -> int:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS total FROM risk_observations"
            ).fetchone()
        return int(row["total"])
