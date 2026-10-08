# TR-04 backend

This FastAPI service accepts source-attributed road observations, stores them in
SQLite, calculates an explainable baseline risk score, and exposes a risk map
and recurring time/location patterns.

## Run

From the `backend` directory, install `requirements.txt`, then run:

```text
uvicorn main:app --reload
```

The interactive API reference is available at `/docs`. SQLite is created at
`backend/data/risk_observations.sqlite3` on first use. Set
`RISK_DATABASE_PATH` to use a different database file.

On Vercel, SQLite uses `/tmp` so observation writes do not target the read-only
deployment bundle. That storage is temporary and isolated to a function
instance; observations and patterns are not durable across restarts or instances.
Use a managed database before relying on stored observations in production.

Install `requirements-dev.txt` to run the backend verification suite with
`python -m pytest`.

## Risk endpoints

- `POST /api/risk/observations` stores one measured observation.
- `POST /api/risk/observations/batch` stores up to 1,000 measured observations
  in one transaction.
- `GET /api/risk/observations` lists stored observations (`limit` and `offset`
  supported).
- `GET /api/risk/map` groups observations by `location_id` and reports their
  mean scored risk, sample count, high-risk count, source count, and time range.
- `GET /api/risk/patterns` reports repeated high-risk observations grouped by
  location, weekday, and hour in `Asia/Kolkata`. The default is at least two
  distinct local dates with scores of 60 or higher. Weekday numbers use
  Monday=0 through Sunday=6.

Each submitted observation must include a stable location ID, name, coordinates,
timezone-aware observation time, source label, and at least one measured risk
factor. Accident counts require their period in days. Traffic volume is in
vehicles per hour. Weather, road, and time factors are normalized source scores
from 0 (lower risk) to 100 (higher risk). Omit a factor when it was not measured;
do not submit zero to mean missing.

## Baseline scoring

The current `transparent-baseline-v1` model normalizes measured values, then
averages only the available factor scores:

- Accident history: accidents per 30 days × 5, capped at 100.
- Traffic volume: vehicles per hour ÷ 10, capped at 100.
- Traffic delay: seconds ÷ 3, capped at 100.
- Weather, road, and time factors: supplied normalized scores from 0 to 100.

Risk levels are low (below 30), moderate (30–59.99), high (60–79.99), and
critical (80 or higher). Responses include the raw factors and each normalized
contribution so a score can be reviewed. This is an initial transparent scoring
baseline; it has not been trained or calibrated against Manipur accident
records. The service does not invent observations or infer missing factors.

## Traffic provider

TomTom is the default live traffic provider. Copy `.env.example` to `.env` and
set `TOMTOM_API_KEY`; set `TRAFFIC_PROVIDER=mappls` to select the existing Mappls
adapter instead. Credentials remain server-side and are sent in request headers
or the provider-documented query parameter. Traffic responses derive route-average
speed and measured delay from the provider response; traffic classification and
risk score remain unknown unless supported by measured data. Provider errors are
sanitized and never include credentials.

- `GET /api/traffic/roads` requests live-traffic routes for the configured road
  segments.
- `POST /api/traffic/route` accepts origin and destination coordinates, then
  returns TomTom's live-traffic route geometry, travel time, and delay. The
  directions panel falls back to an OSRM estimate when the live route provider
  is unavailable and labels that estimate as not traffic-adjusted.
- `GET /api/traffic/location?latitude=24.817&longitude=93.9368` returns live
  speed, free-flow speed, delay, confidence, and geometry for the nearest road
  segment. It also returns a `risk_assessment` calculated from that live flow
  reading and current Open-Meteo weather for the selected coordinates. The
  TomTom key must also have Traffic Flow Segment Data access.
- `POST /api/traffic/route` includes a route risk assessment when TomTom returns
  a current-versus-free-flow travel-time comparison. OSRM fallback routes do not
  receive a live risk score.
- `GET /api/traffic/incidents` accepts a map viewport as
  `min_longitude`, `min_latitude`, `max_longitude`, and `max_latitude`, then returns
  current TomTom incident geometry and event details. TomTom limits incident
  bounding boxes to 10,000 km².
- The current TomTom free plan lists 20,000 monthly Routing API requests and
  2,500 monthly Traffic Incidents API requests. Actual Manipur road-level coverage
  still needs to be confirmed with the project's key and viewport.

## Live traffic risk index

`live-traffic-risk-v1` uses live TomTom traffic flow or route travel-time
comparisons, plus current Open-Meteo weather when available. It calculates
traffic pressure from speed reduction (70%) and relative extra travel time
(30%), then adds a weather-code severity adjustment of up to 35 points. A
TomTom road-closure report sets the location score to critical. Risk bands are
low (<30), moderate (30–59), high (60–79), and critical (80+). The response
includes each measured factor and its source. If weather is unavailable, the
traffic-only score is returned as partial; unavailable traffic data never gets
replaced with a sample value.

This is a live operational index, not a trained machine-learning model or an
accident probability. The scoring bands and weather adjustment have not been
calibrated against Manipur crash outcomes or traffic exposure. The separate
public-incident panel is the small report-based demo and is not used to score
live traffic.

Accident history remains a separate data layer. The MoRTH report contains a
small 2016–2018 table of Manipur NH 102 high-accident locations, but it does not
provide coordinates for those rows. The backend preserves their reported
chainage and counts without inventing map points. See the published history
section below for the imported rows and their limits.

## Current weather feed

- `GET /api/weather/current?latitude=24.817&longitude=93.9368` retrieves current
  temperature, humidity, precipitation, weather code, and wind conditions from
  Open-Meteo for the requested coordinates. Coordinates default to the Imphal
  monitoring area.
- Responses include the provider's model-valid time, fetch time, timezone, units,
  and `data_basis: weather_model_estimate`. These are weather-model conditions,
  not roadside-station observations, and are not automatically converted into a
  TR-04 risk score.
- The map refreshes this feed every 15 minutes and shows Open-Meteo attribution.
  Review the provider's [terms](https://open-meteo.com/en/terms) and data
  attribution requirements before deployment; its free API is limited to
  non-commercial use.

## Public demo incident examples

GET /api/accidents/demo returns two anonymized incident examples summarized from
public Manipur Police FIR copies, plus a transparent keyword-based pattern scan
for two-wheeler involvement, turning/crossing conflicts, and serious injuries.
This is a rule-based demonstration, not a trained model or calibrated risk
prediction; it reports matching counts only within this tiny sample and returns
training_ready: false. Two crash reports without comparison periods or
historical conditions cannot train a reliable model. The endpoint omits direct
source links because the public FIR copies contain personal details; source URLs
remain in the local historical CSV for maintainers.

## Synthetic model demonstration

The dashboard keeps its recorded risk observations and sourced public-report
sample separate from a generated machine-learning demonstration. The
reproducible dataset covers eight approximate Imphal place anchors and 2,688
scenarios. Its features include generated historical-accident counts, traffic
volume and speed, road type and surface, width, curve and lighting, local time,
rainfall, visibility, and coordinates. Generated labels follow an illustrative
hand-authored rule with a small amount of label noise; they are not measured
crash outcomes.

To regenerate the CSV and train the Random Forest model from the `backend`
directory:

```text
python train_demo_model.py --generate-data
```

The generated CSV and model/map/pattern/observation artifacts are kept in the
repository for reproducibility. The separate `/api/demo/*` endpoints serve
these artifacts; `/api/demo/risk-prediction` accepts all model features and
returns the model's synthetic high-risk probability. The existing dashboard
automatically scores a selected map place against the nearest demo anchor, or
an operator can choose one of the eight named anchors. Scenario conditions
come from generated defaults, not live traffic or weather.

`/api/demo/risk-map`, `/api/demo/risk-patterns`, and `/api/demo/observations`
are explicitly synthetic layers. The map pins are approximate reference
locations, not accident locations. Pattern rates and observations are generated
labels/examples, not crash counts or real incident records. Model evaluation
metrics measure agreement with generated labels only, not real-world
prediction quality. The two public incident reports and the un-geocoded
MoRTH annual/blackspot tables are not used for model training; their available
data cannot support a location-and-conditions training set.

## Published Manipur accident history

- `GET /api/accidents/history` returns two source-attributed MoRTH datasets:
  Manipur annual accident/fatality totals for 2019–2023 and five NH 102
  high-accident-location rows reported for 2016–2018.
- Annual totals are state-wide. The NH rows preserve the report's chainage text;
  the report does not provide verified coordinates. One source row's reported
  accident total does not equal its three yearly values, and the endpoint marks
  that mismatch instead of silently correcting it.
- This is an initial public-data import, not an event-level accident register or
  an ML training set. It has no incident timestamps, verified location
  coordinates, historical traffic exposure, matched no-accident periods, or
  joined weather observations. Do not use it to claim a calibrated accident
  probability. See `backend/data/historical/README.md` for provenance and the
  data limitations.
