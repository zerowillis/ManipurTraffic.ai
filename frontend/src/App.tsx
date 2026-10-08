import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'
import MapView from './MapView'
import { apiGet, apiPost, ApiError } from './api'
import {
  ensureDeviceLocationPermission,
  getCurrentDeviceLocation,
  getDrivingRoute,
  getLiveTrafficAtLocation,
  searchPlaces,
  suggestPlaces,
  type LocationTraffic,
  type MapPlace,
  type RoutePreview,
} from './mapServices'

type RemoteData<T> = {
  status: 'loading' | 'available' | 'empty' | 'unavailable' | 'error'
  data?: T
  message?: string
}

type TrafficRoads = {
  city?: string
  data_source?: string
  status?: string
  timestamp?: string
  roads?: TrafficRoad[]
  message?: string
}

type TrafficRoad = {
  name?: string
  average_speed_kmh?: number | null
  traffic_delay_seconds?: number | null
  status?: string
}

type TrafficProvider = {
  provider?: string
  status?: string
}

type CurrentWeather = {
  status?: string
  provider?: string
  data_basis?: string
  valid_at?: string | null
  fetched_at?: string | null
  timezone?: string | null
  temperature_c?: number | null
  relative_humidity_pct?: number | null
  precipitation_mm?: number | null
  wind_speed_kmh?: number | null
  message?: string | null
}

type PublicDemoIncident = {
  demo_id: string
  occurred_at_local: string
  district: string
  location_description: string
  road_reference: string | null
  event_type_reported: string
  vehicles_reported: string[]
  injury_outcome_reported: string
  fatality_outcome_reported: string
  source_reference: string
}

type PublicDemoPattern = {
  name: string
  matched_reports: number
  sample_size: number
  evidence_rule: string
}

type PublicDemoResponse = {
  status: 'demo_only'
  state: 'Manipur'
  incidents: PublicDemoIncident[]
  analysis: {
    model_name: string
    method: 'rule_based_pattern_scan'
    sample_size: number
    patterns: PublicDemoPattern[]
    risk_score_available: false
    note: string
  }
  training_ready: false
  note: string
}

type DemoModelStatus = {
  available: boolean
  data_source?: string
  is_real_world_model?: boolean
  dataset_rows?: number
  test_rows?: number
  features?: string[]
  metrics?: {
    accuracy: number
    precision: number
    recall: number
    f1: number
  }
  classification_threshold?: number
  train_period_end?: string
  test_period_start?: string
  trained_at?: string
  warning?: string
  risk_map_locations?: number
  pattern_groups?: number
  total_synthetic_incident_examples?: number
  returned_observations?: number
  message?: string
}

type DemoLocation = {
  place_name: string
  location_name: string
  latitude: number
  longitude: number
  scenario_defaults: Omit<DemoRiskPredictionInput, 'latitude' | 'longitude'>
}

type DemoLocationsResponse = {
  data_source: string
  is_real_world_data: false
  warning: string
  locations: DemoLocation[]
}

type DemoRiskPredictionInput = {
  latitude: number
  longitude: number
  traffic_volume_vehicles_per_hour: number
  average_speed_kmh: number
  historical_accidents_12mo: number
  hour_of_day: number
  day_of_week: number
  rainfall_mm: number
  visibility_m: number
  road_width_m: number
  curve_severity: number
  poor_lighting: boolean | number
  road_surface_code: number
  road_type_code: number
}

type DemoPrediction = {
  data_source: string
  is_real_world_prediction: false
  synthetic_high_risk_probability: number
  synthetic_high_risk_label: number
  warning: string
}

type DemoSelection = {
  location: DemoLocation
  latitude: number
  longitude: number
  label: string
}

type DashboardData = {
  health: RemoteData<unknown>
  provider: RemoteData<TrafficProvider>
  roads: RemoteData<TrafficRoads>
  weather: RemoteData<CurrentWeather>
  riskMap: RemoteData<unknown>
  observations: RemoteData<unknown>
  patterns: RemoteData<unknown>
  demo: RemoteData<PublicDemoResponse>
  demoModel: RemoteData<DemoModelStatus>
  demoLocations: RemoteData<DemoLocationsResponse>
  demoRiskMap: RemoteData<unknown>
  demoPatterns: RemoteData<unknown>
  demoObservations: RemoteData<unknown>
}

type ToolMode = 'search' | 'directions'
type PlaceSearchState = 'idle' | 'loading' | 'results' | 'empty' | 'error'
type SuggestionState = 'idle' | 'loading' | 'results' | 'empty' | 'error'
type RouteField = 'start' | 'end'

function PlaceSuggestions({
  id,
  places,
  state,
  errorMessage,
  onSelect,
}: {
  id: string
  places: MapPlace[]
  state: SuggestionState
  errorMessage: string
  onSelect: (place: MapPlace) => void
}) {
  if (state === 'idle') return null

  return (
    <div className="suggestion-popover" id={id}>
      {state === 'loading' ? (
        <p className="suggestion-status" role="status">Looking for places…</p>
      ) : null}
      {state === 'empty' ? (
        <p className="suggestion-status">No nearby matches. Keep typing or use Search.</p>
      ) : null}
      {state === 'error' ? (
        <p className="suggestion-status suggestion-error" role="status">
          Suggestions unavailable. Use Search to try again.
          {errorMessage ? ` ${errorMessage}` : ''}
        </p>
      ) : null}
      {state === 'results' ? (
        <div className="suggestion-list" role="listbox" aria-label="Place suggestions">
          {places.map((place, index) => (
            <button
              className="suggestion-option"
              id={`${id}-option-${index}`}
              key={`${place.latitude}-${place.longitude}-${index}`}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(place)}
            >
              <span className="suggestion-pin" aria-hidden="true">⌖</span>
              <span className="suggestion-copy">
                <strong>{place.name}</strong>
                <small>{place.displayName}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const emptyDashboard: DashboardData = {
  health: { status: 'loading' },
  provider: { status: 'loading' },
  roads: { status: 'loading' },
  weather: { status: 'loading' },
  riskMap: { status: 'loading' },
  observations: { status: 'loading' },
  patterns: { status: 'loading' },
  demo: { status: 'loading' },
  demoModel: { status: 'loading' },
  demoLocations: { status: 'loading' },
  demoRiskMap: { status: 'loading' },
  demoPatterns: { status: 'loading' },
  demoObservations: { status: 'loading' },
}

async function readEndpoint<T>(path: string): Promise<RemoteData<T>> {
  try {
    const data = await apiGet<T>(path)
    if (
      data &&
      typeof data === 'object' &&
      'status' in data &&
      data.status === 'unavailable'
    ) {
      const payload = data as T & { message?: string }
      return {
        status: 'unavailable',
        data,
        message: payload.message ?? 'The backend reports this data source as unavailable.',
      }
    }
    if (isEmptyPayload(data)) return { status: 'empty', data }
    return { status: 'available', data }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected API response.'
    return {
      status: error instanceof ApiError && error.status === 404 ? 'unavailable' : 'error',
      message,
    }
  }
}

function isEmptyPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (!value || typeof value !== 'object') return false

  const record = value as Record<string, unknown>
  const collectionKeys = [
    'roads',
    'observations',
    'patterns',
    'incidents',
    'risk_map',
    'risk_points',
    'points',
    'locations',
    'risk_areas',
    'features',
  ]
  return collectionKeys.some((key) => {
    const collection = record[key]
    return Array.isArray(collection) && collection.length === 0
  }) ||
    (record.data !== value && isEmptyPayload(record.data))
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return '—'
  return JSON.stringify(value)
}

function humanize(key: string): string {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function distanceInKilometres(
  first: Pick<MapPlace, 'latitude' | 'longitude'>,
  second: Pick<DemoLocation, 'latitude' | 'longitude'>,
): number {
  const radians = Math.PI / 180
  const latitudeDifference = (second.latitude - first.latitude) * radians
  const longitudeDifference = (second.longitude - first.longitude) * radians
  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(first.latitude * radians) *
      Math.cos(second.latitude * radians) *
      Math.sin(longitudeDifference / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function formatWeatherTime(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  })
}

function LoadingIndicator({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="loading-indicator" role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  )
}

function DataState({ state }: { state: RemoteData<unknown> }) {
  if (state.status === 'loading') {
    return (
      <div className="state-message state-loading">
        <LoadingIndicator label="Loading data" />
      </div>
    )
  }
  if (state.status === 'empty') {
    return <p className="state-message">The backend returned an empty response.</p>
  }
  if (state.status === 'unavailable') {
    return <p className="state-message">Endpoint unavailable: {state.message}</p>
  }
  if (state.status === 'error') {
    return <p className="state-message state-error">Unable to load: {state.message}</p>
  }
  return null
}

function getRecords(value: unknown, keys: string[]): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === 'object' && !Array.isArray(row),
    )
  }
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return (record[key] as unknown[]).filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object' && !Array.isArray(row),
      )
    }
  }

  const nested = record.data
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return getRecords(nested, keys)
  }
  return [record]
}

function DemoIncidentAnalysis({
  state,
}: {
  state: RemoteData<PublicDemoResponse>
}) {
  if (state.status !== 'available' || !state.data) {
    if (state.status === 'empty') {
      return <p className="state-message">No public demo reports are available.</p>
    }
    return <DataState state={state} />
  }

  const { incidents, analysis } = state.data

  return (
    <div className="demo-analysis">
      <div className="demo-analysis-heading">
        <div>
          <span className="demo-status">DEMO · RULE-BASED</span>
          <h4>{analysis.model_name.replace(/^TR-04\s*/i, '')}</h4>
          <p>{analysis.note}</p>
        </div>
        <div className="demo-sample-count">
          <strong>{analysis.sample_size}</strong>
          <span>source reports</span>
        </div>
      </div>

      <div className="demo-patterns">
        {analysis.patterns.map((pattern) => (
          <article className="demo-pattern" key={pattern.name}>
            <span>{pattern.matched_reports} of {pattern.sample_size} reports</span>
            <strong>{pattern.name}</strong>
            <small>{pattern.evidence_rule}</small>
          </article>
        ))}
      </div>

      <div className="demo-incidents">
        {incidents.map((incident) => (
          <article className="demo-incident" key={incident.demo_id}>
            <div className="demo-incident-topline">
              <strong>{incident.location_description}</strong>
              <time dateTime={incident.occurred_at_local}>
                {formatWeatherTime(incident.occurred_at_local)}
              </time>
            </div>
            <p>{incident.district}{incident.road_reference ? ' · ' + incident.road_reference : ''}</p>
            <p>{incident.event_type_reported}</p>
            <dl>
              <div><dt>Vehicles</dt><dd>{incident.vehicles_reported.join(', ')}</dd></div>
              <div><dt>Reported outcome</dt><dd>{incident.injury_outcome_reported}</dd></div>
              <div><dt>Fatalities</dt><dd>{incident.fatality_outcome_reported}</dd></div>
            </dl>
            <small className="demo-source">{incident.source_reference}</small>
          </article>
        ))}
      </div>

      <p className="demo-caveat">
        The reports do not include verified crash coordinates, historical traffic or weather,
        or non-crash comparison records. Sample patterns are not Manipur-wide rates or risk
        predictions, and these examples are not shown as exact map pins.
      </p>
    </div>
  )
}

function SyntheticAIAnalysis({
  model,
  locations,
  riskMap,
  patterns,
  observations,
  selection,
  prediction,
  onSelectLocation,
}: {
  model: RemoteData<DemoModelStatus>
  locations: RemoteData<DemoLocationsResponse>
  riskMap: RemoteData<unknown>
  patterns: RemoteData<unknown>
  observations: RemoteData<unknown>
  selection: DemoSelection | null
  prediction: RemoteData<DemoPrediction>
  onSelectLocation: (location: DemoLocation) => void
}) {
  const availableLocations = locations.data?.locations ?? []
  const modelStatus = model.data
  const classificationThreshold = modelStatus?.classification_threshold
  const patternRows = patterns.status === 'available'
    ? (getRecords(patterns.data, ['patterns']) ?? []).slice(0, 6)
    : []
  const observationRows = observations.status === 'available'
    ? (getRecords(observations.data, ['observations']) ?? []).slice(0, 6)
    : []

  return (
    <div className="synthetic-ai-analysis">
      <div className="synthetic-ai-summary">
        <div className="synthetic-ai-copy">
          <span className="demo-status">SYNTHETIC · RANDOM FOREST</span>
          <p>
            Select an Imphal reference location or search for a nearby place.
            The model scores generated traffic, road, time, weather, and
            accident-history inputs for that location.
          </p>
          <label className="demo-location-select" htmlFor="demo-ai-location">
            <span>Run the model for a demo location</span>
            <select
              id="demo-ai-location"
              value={selection?.location.place_name ?? ''}
              disabled={locations.status !== 'available'}
              onChange={(event) => {
                const location = availableLocations.find(
                  (candidate) => candidate.place_name === event.target.value,
                )
                if (location) onSelectLocation(location)
              }}
            >
              <option value="">Choose an Imphal reference location</option>
              {availableLocations.map((location) => (
                <option key={location.place_name} value={location.place_name}>
                  {location.place_name}
                </option>
              ))}
            </select>
          </label>
          {locations.status !== 'available' ? <DataState state={locations} /> : null}
          {selection ? (
            <p className="demo-selection-note">
              Selected: <strong>{selection.label}</strong> · synthetic reference:
              {' '}{selection.location.place_name}
            </p>
          ) : null}
        </div>

        <div className="synthetic-ai-result" aria-live="polite">
          {model.status !== 'available' ? <DataState state={model} /> : null}
          {model.status === 'available' && !modelStatus?.available ? (
            <p className="state-message">
              {modelStatus?.message ?? 'Synthetic model artifacts are unavailable.'}
            </p>
          ) : null}
          {model.status === 'available' && modelStatus?.available ? (
            <>
              <span className="synthetic-result-label">Selected scenario output</span>
              {prediction.status === 'loading' ? (
                <p className="state-message state-loading">
                  <LoadingIndicator label="Scoring synthetic scenario" />
                </p>
              ) : prediction.status === 'available' && prediction.data ? (
                <>
                  <div className="synthetic-result-score">
                    <strong>
                      {(prediction.data.synthetic_high_risk_probability * 100).toFixed(1)}%
                    </strong>
                    <span>synthetic model output</span>
                  </div>
                  <p className="synthetic-result-class">
                    {prediction.data.synthetic_high_risk_label === 1
                      ? 'Above'
                      : 'Below'}{' '}
                    {classificationThreshold == null
                      ? 'the demo classification cutoff, which was not returned'
                      : `the ${(classificationThreshold * 100).toFixed(0)}% demo cutoff`}
                  </p>
                  <p className="synthetic-result-warning">{prediction.data.warning}</p>
                </>
              ) : prediction.status === 'empty' ? (
                <p className="state-message">Select a supported location to run the model.</p>
              ) : (
                <DataState state={prediction} />
              )}
            </>
          ) : null}
        </div>
      </div>

      {model.status === 'available' && modelStatus?.available ? (
        <div className="synthetic-ai-metrics" aria-label="Synthetic model metadata">
          <span><strong>{displayValue(modelStatus.dataset_rows)}</strong><small>generated scenarios</small></span>
          <span><strong>{displayValue(modelStatus.total_synthetic_incident_examples)}</strong><small>synthetic positive labels</small></span>
          <span><strong>{displayValue(modelStatus.risk_map_locations)}</strong><small>approximate map anchors</small></span>
          <span><strong>{displayValue(modelStatus.pattern_groups)}</strong><small>generated pattern groups</small></span>
        </div>
      ) : null}

      {model.status === 'available' && modelStatus?.available && modelStatus.metrics ? (
        <div className="synthetic-model-metrics">
          <strong>Chronological holdout against synthetic labels</strong>
          <div>
            {Object.entries(modelStatus.metrics).map(([name, value]) => (
              <span key={name}><small>{humanize(name)}</small><b>{(value * 100).toFixed(1)}%</b></span>
            ))}
          </div>
          <p>
            Test period {modelStatus.test_period_start ?? 'not returned'} onward.
            These metrics measure fit to the generated rule, not real crash prediction.
          </p>
        </div>
      ) : null}

      <div className="synthetic-ai-data-grid">
        <section className="synthetic-data-section" aria-labelledby="synthetic-patterns-title">
          <div className="synthetic-section-heading">
            <h4 id="synthetic-patterns-title">Generated recurring patterns</h4>
            <span>Top returned label rates</span>
          </div>
          {patterns.status !== 'available' ? <DataState state={patterns} /> : patternRows.length === 0 ? (
            <p className="state-message">No generated pattern groups were returned.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead><tr>
                  <th>Reference area</th><th>Period</th><th>Conditions</th>
                  <th>Scenarios</th><th>Positive labels</th><th>Label rate</th>
                </tr></thead>
                <tbody>
                  {patternRows.map((pattern, index) => (
                    <tr key={`${displayValue(pattern.location_name)}-${index}`}>
                      <td>{displayValue(pattern.location_name)}</td>
                      <td>{displayValue(pattern.day_period)}</td>
                      <td>{displayValue(pattern.weather_condition)} · {displayValue(pattern.road_surface)}</td>
                      <td>{displayValue(pattern.scenario_count)}</td>
                      <td>{displayValue(pattern.synthetic_accident_observations)}</td>
                      <td>
                        {pattern.synthetic_incident_rate_percent == null
                          ? '—'
                          : `${displayValue(pattern.synthetic_incident_rate_percent)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="synthetic-data-section" aria-labelledby="synthetic-observations-title">
          <div className="synthetic-section-heading">
            <h4 id="synthetic-observations-title">Generated positive examples</h4>
            <span>Not recorded accidents</span>
          </div>
          {observations.status !== 'available' ? <DataState state={observations} /> : observationRows.length === 0 ? (
            <p className="state-message">No generated examples were returned.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead><tr>
                  <th>Generated time</th><th>Reference area</th><th>Period</th>
                  <th>Weather</th><th>Road</th><th>Traffic / hour</th>
                  <th>Generated history</th>
                </tr></thead>
                <tbody>
                  {observationRows.map((observation, index) => (
                    <tr key={`${displayValue(observation.observation_id)}-${index}`}>
                      <td>{formatWeatherTime(String(observation.observed_at ?? '')) ?? '—'}</td>
                      <td>{displayValue(observation.location_name)}</td>
                      <td>{displayValue(observation.day_period)}</td>
                      <td>{displayValue(observation.weather_condition)}</td>
                      <td>{displayValue(observation.road_surface)}</td>
                      <td>{displayValue(observation.traffic_volume_vehicles_per_hour)}</td>
                      <td>{displayValue(observation.historical_accidents_12mo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <p className="synthetic-ai-caveat">
        {modelStatus?.warning ?? 'Synthetic output only; not calibrated against verified crash records.'}
        {' '}{locations.data?.warning ?? ''}
        {' '}Generated traffic, road, weather, and historical values are not live or verified.
        Turn on the separate AI demo map layer to see the returned approximate reference points.
        {riskMap.status === 'error' || riskMap.status === 'unavailable'
          ? ` Demo map layer: ${riskMap.message ?? riskMap.status}.`
          : ''}
      </p>
    </div>
  )
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard)
  const [refreshing, setRefreshing] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [toolMode, setToolMode] = useState<ToolMode>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<PlaceSearchState>('idle')
  const [searchMessage, setSearchMessage] = useState('')
  const [searchResults, setSearchResults] = useState<MapPlace[]>([])
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchSuggestions, setSearchSuggestions] = useState<MapPlace[]>([])
  const [searchSuggestionState, setSearchSuggestionState] = useState<SuggestionState>('idle')
  const [searchSuggestionMessage, setSearchSuggestionMessage] = useState('')
  const [locationTraffic, setLocationTraffic] = useState<RemoteData<LocationTraffic>>({ status: 'empty' })
  const [searchLocationLoading, setSearchLocationLoading] = useState(false)
  const [directionsLocationLoading, setDirectionsLocationLoading] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<MapPlace | null>(null)
  const [manualDemoSelection, setManualDemoSelection] = useState<DemoSelection | null>(null)
  const [demoPrediction, setDemoPrediction] = useState<{
    key: string
    state: RemoteData<DemoPrediction>
  } | null>(null)
  const [routeStart, setRouteStart] = useState<MapPlace | null>(null)
  const [routeEnd, setRouteEnd] = useState<MapPlace | null>(null)
  const [startQuery, setStartQuery] = useState('')
  const [endQuery, setEndQuery] = useState('')
  const [routeSearchField, setRouteSearchField] = useState<RouteField | null>(null)
  const [routeSearchState, setRouteSearchState] = useState<PlaceSearchState>('idle')
  const [routeCandidates, setRouteCandidates] = useState<MapPlace[]>([])
  const [focusedRouteField, setFocusedRouteField] = useState<RouteField | null>(null)
  const [routeSuggestions, setRouteSuggestions] = useState<MapPlace[]>([])
  const [routeSuggestionState, setRouteSuggestionState] = useState<SuggestionState>('idle')
  const [routeSuggestionMessage, setRouteSuggestionMessage] = useState('')
  const [routeMessage, setRouteMessage] = useState('')
  const [routePreview, setRoutePreview] = useState<RoutePreview | null>(null)
  const [routeError, setRouteError] = useState('')
  const [routeLoading, setRouteLoading] = useState(false)
  const [showRisk, setShowRisk] = useState(false)
  const [showDemoRisk, setShowDemoRisk] = useState(false)

  const nearestDemoMatch = useMemo(() => {
    if (
      !selectedPlace ||
      dashboard.demoLocations.status !== 'available' ||
      !dashboard.demoLocations.data
    ) return null

    return dashboard.demoLocations.data.locations.reduce<{
      location: DemoLocation | null
      distance: number
    }>((closest, location) => {
      const distance = distanceInKilometres(selectedPlace, location)
      return distance < closest.distance ? { location, distance } : closest
    }, { location: null, distance: Number.POSITIVE_INFINITY })
  }, [dashboard.demoLocations, selectedPlace])

  const demoSelection = useMemo(
    () => manualDemoSelection ?? (
      selectedPlace &&
      nearestDemoMatch?.location &&
      nearestDemoMatch.distance <= 5
        ? {
          location: nearestDemoMatch.location,
          latitude: selectedPlace.latitude,
          longitude: selectedPlace.longitude,
          label: selectedPlace.name,
        }
        : null
    ),
    [manualDemoSelection, nearestDemoMatch, selectedPlace],
  )
  const demoPredictionKey = demoSelection
    ? `${demoSelection.location.place_name}:${demoSelection.latitude}:${demoSelection.longitude}`
    : null
  const demoPredictionState = demoSelection && demoPredictionKey
    ? demoPrediction?.key === demoPredictionKey
      ? demoPrediction.state
      : { status: 'loading' as const }
    : selectedPlace && dashboard.demoLocations.status === 'available'
      ? {
        status: 'unavailable' as const,
        message: nearestDemoMatch?.location
          ? 'No synthetic reference location is within 5 km. Choose one of the named Imphal demo locations below.'
          : 'No synthetic reference location is available for this place.',
      }
      : selectedPlace && dashboard.demoLocations.status !== 'loading'
        ? {
          status: dashboard.demoLocations.status === 'unavailable' ? 'unavailable' as const : 'error' as const,
          message: dashboard.demoLocations.message ?? 'Synthetic demo locations could not be loaded.',
        }
        : dashboard.demoLocations.status === 'loading'
          ? { status: 'loading' as const }
          : { status: 'empty' as const }

  const fetchDashboard = useCallback(async (): Promise<DashboardData> => {
    const [
      health,
      provider,
      roads,
      weather,
      riskMap,
      observations,
      patterns,
      demo,
      demoModel,
      demoLocations,
      demoRiskMap,
      demoPatterns,
      demoObservations,
    ] = await Promise.all([
      readEndpoint<unknown>('/api/health'),
      readEndpoint<TrafficProvider>('/api/traffic/provider'),
      readEndpoint<TrafficRoads>('/api/traffic/roads'),
      readEndpoint<CurrentWeather>('/api/weather/current?latitude=24.817&longitude=93.9368'),
      readEndpoint<unknown>('/api/risk/map'),
      readEndpoint<unknown>('/api/risk/observations'),
      readEndpoint<unknown>('/api/risk/patterns'),
      readEndpoint<PublicDemoResponse>('/api/accidents/demo'),
      readEndpoint<DemoModelStatus>('/api/demo/model'),
      readEndpoint<DemoLocationsResponse>('/api/demo/locations'),
      readEndpoint<unknown>('/api/demo/risk-map'),
      readEndpoint<unknown>('/api/demo/risk-patterns'),
      readEndpoint<unknown>('/api/demo/observations'),
    ])

    // Live TomTom traffic is requested only after the browser grants location access.
    return {
      health,
      provider,
      roads,
      weather,
      riskMap,
      observations,
      patterns,
      demo,
      demoModel,
      demoLocations,
      demoRiskMap,
      demoPatterns,
      demoObservations,
    }
  }, [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setDashboard(await fetchDashboard())
      setCheckedAt(new Date().toISOString())
    } finally {
      setRefreshing(false)
    }
  }, [fetchDashboard])

  useEffect(() => {
    let cancelled = false
    void fetchDashboard().then((data) => {
      if (!cancelled) {
        setDashboard(data)
        setCheckedAt(new Date().toISOString())
      }
    })
    return () => {
      cancelled = true
    }
  }, [fetchDashboard])

  useEffect(() => {
    if (!demoSelection) return
    let cancelled = false
    const key = `${demoSelection.location.place_name}:${demoSelection.latitude}:${demoSelection.longitude}`
    const features: DemoRiskPredictionInput = {
      ...demoSelection.location.scenario_defaults,
      latitude: demoSelection.latitude,
      longitude: demoSelection.longitude,
      poor_lighting: Boolean(demoSelection.location.scenario_defaults.poor_lighting),
    }

    void apiPost<DemoPrediction>('/api/demo/risk-prediction', features)
      .then((data) => {
        if (!cancelled) {
          setDemoPrediction({ key, state: { status: 'available', data } })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDemoPrediction({
          key,
          state: {
            status: error instanceof ApiError && error.status === 404 ? 'unavailable' : 'error',
            message: error instanceof Error ? error.message : 'Synthetic demo prediction failed.',
          },
        })
      })

    return () => {
      cancelled = true
    }
  }, [demoSelection])

  useEffect(() => {
    const query = searchQuery.trim()
    if (toolMode !== 'search' || !searchFocused || query.length < 2) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void suggestPlaces(query, controller.signal)
        .then((places) => {
          if (controller.signal.aborted) return
          setSearchSuggestions(places)
          setSearchSuggestionState(places.length ? 'results' : 'empty')
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setSearchSuggestionMessage(
            error instanceof Error ? error.message : 'Place suggestions failed.',
          )
          setSearchSuggestionState('error')
        })
    }, 350)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [searchFocused, searchQuery, toolMode])

  useEffect(() => {
    const query = focusedRouteField === 'start' ? startQuery.trim() : endQuery.trim()
    if (toolMode !== 'directions' || !focusedRouteField || query.length < 2) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void suggestPlaces(query, controller.signal)
        .then((places) => {
          if (controller.signal.aborted) return
          setRouteSuggestions(places)
          setRouteSuggestionState(places.length ? 'results' : 'empty')
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setRouteSuggestionMessage(
            error instanceof Error ? error.message : 'Place suggestions failed.',
          )
          setRouteSuggestionState('error')
        })
    }, 350)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [endQuery, focusedRouteField, startQuery, toolMode])

  const runPlaceSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSearchFocused(false)
    setSearchState('loading')
    setSearchMessage('')
    setSearchResults([])
    setLocationTraffic({ status: 'empty' })
    try {
      const places = await searchPlaces(searchQuery)
      setSearchResults(places)
      setSearchState(places.length ? 'results' : 'empty')
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : 'Place search failed.')
      setSearchState('error')
    }
  }

  const selectPlace = async (place: MapPlace) => {
    setSearchFocused(false)
    setSearchSuggestions([])
    setSearchSuggestionState('idle')
    setManualDemoSelection(null)
    setSelectedPlace(place)
    setSearchQuery(place.name)
    setSearchResults([])
    setSearchState('idle')
    setLocationTraffic({ status: 'loading' })
    setRoutePreview(null)
    setShowDemoRisk(true)
    try {
      const traffic = await getLiveTrafficAtLocation(place)
      setLocationTraffic({ status: 'available', data: traffic })
    } catch (error) {
      setLocationTraffic({
        status: 'error',
        message: error instanceof Error ? error.message : 'Live traffic at this location is unavailable.',
      })
    }
  }

  const loadCurrentLocationForSearch = async () => {
    setSearchLocationLoading(true)
    setSearchState('idle')
    setSearchResults([])
    setManualDemoSelection(null)
    setSelectedPlace(null)
    setRoutePreview(null)
    setLocationTraffic({ status: 'loading' })
    try {
      const place = await getCurrentDeviceLocation()
      setSelectedPlace(place)
      setShowDemoRisk(true)
      setSearchQuery(place.name)
      setRoutePreview(null)
      try {
        const traffic = await getLiveTrafficAtLocation(place)
        setLocationTraffic({ status: 'available', data: traffic })
      } catch (error) {
        setLocationTraffic({
          status: 'error',
          message: error instanceof Error ? error.message : 'Live traffic at this location is unavailable.',
        })
      }
    } catch (error) {
      setLocationTraffic({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not find your current location.',
      })
    } finally {
      setSearchLocationLoading(false)
    }
  }

  const setRouteFieldValue = (field: RouteField, place: MapPlace) => {
    setLocationTraffic({ status: 'empty' })
    setFocusedRouteField(null)
    setRouteSuggestions([])
    setRouteSuggestionState('idle')
    if (field === 'start') {
      setRouteStart(place)
      setStartQuery(place.name)
    } else {
      setRouteEnd(place)
      setEndQuery(place.name)
    }
    setRouteCandidates([])
    setRouteSearchState('idle')
    setRouteSearchField(null)
    setRoutePreview(null)
    setRouteError('')
  }

  const findRoutePlace = async (field: RouteField) => {
    const query = field === 'start' ? startQuery : endQuery
    setRouteSearchField(field)
    setRouteSearchState('loading')
    setRouteMessage('')
    setRouteCandidates([])
    try {
      const places = await searchPlaces(query)
      setRouteCandidates(places)
      setRouteSearchState(places.length ? 'results' : 'empty')
    } catch (error) {
      setRouteMessage(error instanceof Error ? error.message : 'Place search failed.')
      setRouteSearchState('error')
    }
  }

  const previewRoute = async () => {
    if (!routeStart || !routeEnd) {
      setRouteError('Find and select both a starting point and a destination.')
      return
    }
    setRouteLoading(true)
    setRouteError('')
    setRoutePreview(null)
    try {
      // Check the browser's saved choice. The browser asks only when undecided.
      await ensureDeviceLocationPermission()
      const route = await getDrivingRoute(routeStart, routeEnd)
      setRoutePreview(route)
      setSelectedPlace(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not calculate a route.'
      setRouteError(`Allow browser location access before requesting live traffic. ${message}`)
    } finally {
      setRouteLoading(false)
    }
  }

  const clearRoute = () => {
    setRouteStart(null)
    setRouteEnd(null)
    setStartQuery('')
    setEndQuery('')
    setRouteCandidates([])
    setRouteSearchState('idle')
    setRouteSearchField(null)
    setRoutePreview(null)
    setRouteError('')
    setLocationTraffic({ status: 'empty' })
  }

  const setCurrentLocationAsStart = async () => {
    setDirectionsLocationLoading(true)
    setRouteError('')
    try {
      const place = await getCurrentDeviceLocation()
      setManualDemoSelection(null)
      setSelectedPlace(place)
      setShowDemoRisk(true)
      setRouteFieldValue('start', place)
      setToolMode('directions')
    } catch (error) {
      setRouteError(error instanceof Error ? error.message : 'Could not find your current location.')
    } finally {
      setDirectionsLocationLoading(false)
    }
  }

  const handleLocated = (place: MapPlace) => {
    setManualDemoSelection(null)
    setSelectedPlace(place)
    setShowDemoRisk(true)
    setLocationTraffic({ status: 'empty' })
    setRouteFieldValue('start', place)
    setToolMode('directions')
  }

  const selectDemoLocation = (location: DemoLocation) => {
    const place: MapPlace = {
      name: location.place_name,
      displayName: `${location.place_name}, Imphal, Manipur`,
      latitude: location.latitude,
      longitude: location.longitude,
    }
    setSelectedPlace(place)
    setSearchQuery(place.name)
    setSearchResults([])
    setSearchState('idle')
    setLocationTraffic({ status: 'empty' })
    setRoutePreview(null)
    setManualDemoSelection({
      location,
      latitude: location.latitude,
      longitude: location.longitude,
      label: location.place_name,
    })
    setShowDemoRisk(true)
  }

  const trafficSegment = locationTraffic.data?.geometry?.coordinates
    ?.map(([longitude, latitude]) => [latitude, longitude] as [number, number]) ?? null

  const pointTrafficDelay = locationTraffic.data?.traffic_delay_seconds
  const pointTrafficDelayLabel = pointTrafficDelay == null
    ? '—'
    : pointTrafficDelay > 0 && pointTrafficDelay < 60
      ? '<1 min'
      : `${Math.max(0, Math.round(pointTrafficDelay / 60))} min`
  const pointTrafficConfidence = locationTraffic.data?.confidence
  const pointTrafficFetchedAt = locationTraffic.data?.fetched_at

  const providerData = dashboard.provider.data
  const weatherData = dashboard.weather.data
  const trafficAvailable = locationTraffic.status === 'available' && Boolean(locationTraffic.data)
  const providerStatus =
    locationTraffic.status === 'available'
      ? 'available'
      : locationTraffic.status === 'error'
        ? 'unavailable'
        : dashboard.provider.status === 'available'
          ? providerData?.status ?? 'status unavailable'
          : dashboard.provider.status
  const providerLabel =
    providerStatus === 'not_configured'
      ? 'Not configured'
      : providerStatus === 'authorization_pending'
        ? 'Waiting for location permission'
        : providerStatus === 'available'
          ? 'Available'
          : providerStatus === 'loading'
            ? 'Checking'
            : 'Unavailable'
  const providerName = locationTraffic.data?.data_source ?? providerData?.provider ?? 'Traffic provider'

  const healthUnavailable =
    dashboard.health.status === 'error' || dashboard.health.status === 'unavailable'
  const healthLabel = healthUnavailable
    ? 'Service unavailable'
    : dashboard.health.status === 'available'
      ? 'Backend connected'
      : dashboard.health.status === 'loading'
        ? 'Connecting to backend'
        : 'Health service returned no status'

  const weatherMetrics: [string, number | null | undefined, string][] = [
    ['Humidity', weatherData?.relative_humidity_pct, '%'],
    ['Precipitation', weatherData?.precipitation_mm, 'mm'],
    ['Wind', weatherData?.wind_speed_kmh, 'km/h'],
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Manipur Traffic Risk home">
          <span className="brand-mark" aria-hidden="true">TR</span>
          <span className="brand-copy">
            <strong>MANIPUR TRAFFIC</strong>
            <span>ROAD RISK MONITORING</span>
          </span>
        </a>
        <div className="header-tools">
          {healthUnavailable ? (
            <div className={`header-status ${dashboard.health.status}`} aria-live="polite">
              <span>{healthLabel}</span>
            </div>
          ) : null}
          <button className="header-refresh" type="button" onClick={() => void refresh()} disabled={refreshing}>
            <span aria-hidden="true">{refreshing ? '…' : '↻'}</span>
            <span className="refresh-label">{refreshing ? 'Checking' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      <main id="main" className="map-dashboard">
        <section className="map-workspace" aria-label="Map and navigation tools">
          <aside className="map-sidebar">
            <div className="sidebar-heading">
              <div>
                <span className="eyebrow">MANIPUR</span>
                <h1>Explore the map</h1>
              </div>
              <span className="checked-time" title="Last backend check">
                {checkedAt
                  ? new Date(checkedAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Kolkata',
                  })
                  : '—'}
              </span>
            </div>

            <div className="tool-tabs" role="tablist" aria-label="Map tools">
              <button
                id="search-tab"
                className={toolMode === 'search' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={toolMode === 'search'}
                aria-controls="map-tool-panel"
                onClick={() => setToolMode('search')}
              >
                <span className="tab-icon" aria-hidden="true">⌕</span>
                Search
              </button>
              <button
                id="directions-tab"
                className={toolMode === 'directions' ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={toolMode === 'directions'}
                aria-controls="map-tool-panel"
                onClick={() => setToolMode('directions')}
              >
                <span className="tab-icon directions-icon" aria-hidden="true">↗</span>
                Directions
              </button>
            </div>

            <div className="tool-panel" id="map-tool-panel" role="tabpanel" aria-labelledby={`${toolMode}-tab`}>
              {toolMode === 'search' ? (
                <>
                  <div className="autocomplete-anchor search-autocomplete-anchor">
                    <form className="place-search-form" onSubmit={(event) => void runPlaceSearch(event)}>
                      <label className="visually-hidden" htmlFor="place-search">Search places in Manipur</label>
                      <span className="search-input-icon" aria-hidden="true">⌕</span>
                      <input
                        id="place-search"
                        type="search"
                        value={searchQuery}
                        onFocus={() => {
                          setSearchFocused(true)
                          setSearchSuggestions([])
                          setSearchSuggestionState(searchQuery.trim().length >= 2 ? 'loading' : 'idle')
                        }}
                        onBlur={() => {
                          setSearchFocused(false)
                          setSearchSuggestionState('idle')
                        }}
                        onChange={(event) => {
                          setSearchQuery(event.target.value)
                          setSearchSuggestions([])
                          setSearchSuggestionState(event.target.value.trim().length >= 2 ? 'loading' : 'idle')
                          setSearchSuggestionMessage('')
                          setSearchResults([])
                          setSearchState('idle')
                          setSearchMessage('')
                          setLocationTraffic({ status: 'empty' })
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setSearchSuggestions([])
                            setSearchSuggestionState('idle')
                          }
                          if (
                            event.key === 'Enter' &&
                            searchSuggestionState === 'results' &&
                            searchSuggestions[0]
                          ) {
                            event.preventDefault()
                            selectPlace(searchSuggestions[0])
                          }
                          if (event.key === 'ArrowDown' && searchSuggestionState === 'results') {
                            event.preventDefault()
                            document.querySelector<HTMLButtonElement>('#search-place-suggestions button')?.focus()
                          }
                        }}
                        placeholder="Search places in Manipur"
                        autoComplete="off"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={searchFocused && searchSuggestionState !== 'idle'}
                        aria-controls="search-place-suggestions"
                      />
                      <button type="submit" disabled={searchState === 'loading'} aria-label="Search places">
                        {searchState === 'loading' ? '…' : 'Search'}
                      </button>
                    </form>
                    <PlaceSuggestions
                      id="search-place-suggestions"
                      places={searchSuggestions}
                      state={searchFocused ? searchSuggestionState : 'idle'}
                      errorMessage={searchSuggestionMessage}
                      onSelect={selectPlace}
                    />
                  </div>
                  <button
                    className="current-location-button"
                    type="button"
                    onClick={() => void loadCurrentLocationForSearch()}
                    disabled={searchLocationLoading}
                  >
                    <span aria-hidden="true">◎</span>
                    {searchLocationLoading ? 'Getting location and traffic…' : 'Use current location'}
                  </button>
                  {searchState === 'loading' ? (
                    <p className="tool-message" role="status">Searching OpenStreetMap…</p>
                  ) : null}
                  {searchState === 'empty' ? (
                    <p className="tool-message">No matching place found. Try a town or landmark with “Imphal” or “Manipur,” such as “Keishampat Junction, Imphal.”</p>
                  ) : null}
                  {searchState === 'error' ? (
                    <p className="tool-message tool-error" role="alert">{searchMessage}</p>
                  ) : null}
                  {searchResults.length > 0 ? (
                    <div className="place-results" aria-label="Place search results">
                      {searchResults.map((place, index) => (
                        <article className="place-result" key={`${place.latitude}-${place.longitude}-${index}`}>
                          <button className="place-result-main" type="button" onClick={() => selectPlace(place)}>
                            <span className="place-pin" aria-hidden="true">●</span>
                            <span>
                              <strong>{place.name}</strong>
                              <small>{place.displayName}</small>
                            </span>
                          </button>
                          <div className="place-result-actions">
                            <button type="button" onClick={() => {
                              setRouteFieldValue('start', place)
                              setToolMode('directions')
                            }}>Route from</button>
                            <button type="button" onClick={() => {
                              setRouteFieldValue('end', place)
                              setToolMode('directions')
                            }}>Route to</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  {selectedPlace && searchState === 'idle' ? (
                    <div className="selected-place">
                      <span className="place-pin" aria-hidden="true">●</span>
                      <span><strong>{selectedPlace.name}</strong><small>{selectedPlace.displayName}</small></span>
                      <button type="button" onClick={() => {
                        setRouteFieldValue('end', selectedPlace)
                        setToolMode('directions')
                      }}>Directions</button>
                    </div>
                  ) : null}
                  {locationTraffic.status === 'loading' ? (
                    <p className="tool-message" role="status">Loading live traffic for the nearest road…</p>
                  ) : null}
                  {locationTraffic.status === 'error' ? (
                    <p className="tool-message tool-error" role="alert">{locationTraffic.message}</p>
                  ) : null}
                  {locationTraffic.status === 'available' && locationTraffic.data ? (
                    <section className="location-traffic-card" aria-label="Live traffic at selected location">
                      <div className="location-traffic-heading">
                        <span><strong>Live traffic at selected location</strong><small>Nearest road segment · {locationTraffic.data.data_source}</small></span>
                        <span className={`traffic-condition${locationTraffic.data.road_closure ? ' is-closed' : ''}`}>
                          {locationTraffic.data.road_closure ? 'Closed' : 'Live'}
                        </span>
                      </div>
                      <div className="location-traffic-metrics">
                        <span><small>Current speed</small><strong>{locationTraffic.data.current_speed_kmh.toFixed(0)} <em>km/h</em></strong></span>
                        <span><small>Free-flow speed</small><strong>{locationTraffic.data.free_flow_speed_kmh.toFixed(0)} <em>km/h</em></strong></span>
                        <span><small>Extra delay</small><strong>{pointTrafficDelayLabel}</strong></span>
                        <span><small>Confidence</small><strong>{pointTrafficConfidence == null ? '—' : `${Math.round(pointTrafficConfidence * 100)}%`}</strong></span>
                      </div>
                      <div className="live-risk-index" aria-label="Live traffic risk assessment">
                        <div className="live-risk-index-heading">
                          <span><strong>Live traffic risk index</strong><small>{locationTraffic.data.risk_assessment.model_name}</small></span>
                          <span className={`live-risk-level level-${locationTraffic.data.risk_assessment.risk_level}`}>
                            {locationTraffic.data.risk_assessment.risk_level}
                          </span>
                        </div>
                        <div className="live-risk-score">
                          <strong>{locationTraffic.data.risk_assessment.risk_score == null ? '—' : Math.round(locationTraffic.data.risk_assessment.risk_score)}</strong>
                          <span>/100</span>
                          {locationTraffic.data.risk_assessment.status === 'partial' ? <small>Partial inputs</small> : null}
                        </div>
                        <p className="live-risk-caption">Live conditions index, not a crash probability.</p>
                        <div className="live-risk-factors">
                          {locationTraffic.data.risk_assessment.factors.map((factor) => (
                            <div className="live-risk-factor" key={factor.name}>
                              <span><strong>{factor.name}</strong><small>{factor.observed_value} · {factor.data_source}</small></span>
                              <b>{Math.round(factor.score)}</b>
                            </div>
                          ))}
                        </div>
                        <details className="live-risk-method">
                          <summary>How this index is calculated</summary>
                          <p>{locationTraffic.data.risk_assessment.method_summary}</p>
                          <p>{locationTraffic.data.risk_assessment.limitation}</p>
                        </details>
                      </div>
                      <p className="location-traffic-updated">
                        {pointTrafficFetchedAt ? `Updated ${formatWeatherTime(pointTrafficFetchedAt)}` : 'Update time unavailable'}
                      </p>
                    </section>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="directions-fields">
                    <div className="route-waypoints" aria-hidden="true">
                      <span className="waypoint-dot start-dot" />
                      <span className="waypoint-line" />
                      <span className="waypoint-dot end-dot" />
                    </div>
                    <div className="autocomplete-anchor route-autocomplete-anchor">
                      <label className="route-field">
                        <span className="visually-hidden">Starting point</span>
                        <input
                          value={startQuery}
                          onFocus={() => {
                            setFocusedRouteField('start')
                            setRouteSuggestions([])
                            setRouteSuggestionState(startQuery.trim().length >= 2 ? 'loading' : 'idle')
                          }}
                          onBlur={() => {
                            setFocusedRouteField(null)
                            setRouteSuggestionState('idle')
                          }}
                          onChange={(event) => {
                            setStartQuery(event.target.value)
                            setRouteSuggestions([])
                            setRouteSuggestionState(event.target.value.trim().length >= 2 ? 'loading' : 'idle')
                            setRouteSuggestionMessage('')
                            setRouteStart(null)
                            setRouteCandidates([])
                            setRouteSearchState('idle')
                            setRoutePreview(null)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setRouteSuggestions([])
                              setRouteSuggestionState('idle')
                            }
                            if (
                              event.key === 'Enter' &&
                              focusedRouteField === 'start' &&
                              routeSuggestionState === 'results' &&
                              routeSuggestions[0]
                            ) {
                              event.preventDefault()
                              setRouteFieldValue('start', routeSuggestions[0])
                            }
                            if (event.key === 'ArrowDown' && routeSuggestionState === 'results') {
                              event.preventDefault()
                              document.querySelector<HTMLButtonElement>('#start-place-suggestions button')?.focus()
                            }
                          }}
                          placeholder="Choose starting point"
                          autoComplete="off"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-expanded={focusedRouteField === 'start' && routeSuggestionState !== 'idle'}
                          aria-controls="start-place-suggestions"
                        />
                        <button type="button" onClick={() => void findRoutePlace('start')} disabled={routeSearchState === 'loading'}>Find</button>
                      </label>
                      <PlaceSuggestions
                        id="start-place-suggestions"
                        places={focusedRouteField === 'start' ? routeSuggestions : []}
                        state={focusedRouteField === 'start' ? routeSuggestionState : 'idle'}
                        errorMessage={routeSuggestionMessage}
                        onSelect={(place) => setRouteFieldValue('start', place)}
                      />
                    </div>
                    <div className="autocomplete-anchor route-autocomplete-anchor">
                      <label className="route-field">
                        <span className="visually-hidden">Destination</span>
                        <input
                          value={endQuery}
                          onFocus={() => {
                            setFocusedRouteField('end')
                            setRouteSuggestions([])
                            setRouteSuggestionState(endQuery.trim().length >= 2 ? 'loading' : 'idle')
                          }}
                          onBlur={() => {
                            setFocusedRouteField(null)
                            setRouteSuggestionState('idle')
                          }}
                          onChange={(event) => {
                            setEndQuery(event.target.value)
                            setRouteSuggestions([])
                            setRouteSuggestionState(event.target.value.trim().length >= 2 ? 'loading' : 'idle')
                            setRouteSuggestionMessage('')
                            setRouteEnd(null)
                            setRouteCandidates([])
                            setRouteSearchState('idle')
                            setRoutePreview(null)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setRouteSuggestions([])
                              setRouteSuggestionState('idle')
                            }
                            if (
                              event.key === 'Enter' &&
                              focusedRouteField === 'end' &&
                              routeSuggestionState === 'results' &&
                              routeSuggestions[0]
                            ) {
                              event.preventDefault()
                              setRouteFieldValue('end', routeSuggestions[0])
                            }
                            if (event.key === 'ArrowDown' && routeSuggestionState === 'results') {
                              event.preventDefault()
                              document.querySelector<HTMLButtonElement>('#end-place-suggestions button')?.focus()
                            }
                          }}
                          placeholder="Choose destination"
                          autoComplete="off"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-expanded={focusedRouteField === 'end' && routeSuggestionState !== 'idle'}
                          aria-controls="end-place-suggestions"
                        />
                        <button type="button" onClick={() => void findRoutePlace('end')} disabled={routeSearchState === 'loading'}>Find</button>
                      </label>
                      <PlaceSuggestions
                        id="end-place-suggestions"
                        places={focusedRouteField === 'end' ? routeSuggestions : []}
                        state={focusedRouteField === 'end' ? routeSuggestionState : 'idle'}
                        errorMessage={routeSuggestionMessage}
                        onSelect={(place) => setRouteFieldValue('end', place)}
                      />
                    </div>
                  </div>
                  <button
                    className="current-location-button directions-location-button"
                    type="button"
                    onClick={() => void setCurrentLocationAsStart()}
                    disabled={directionsLocationLoading}
                  >
                    <span aria-hidden="true">◎</span>
                    {directionsLocationLoading ? 'Getting current location…' : 'Use current location as starting point'}
                  </button>
                  {routeSearchState === 'loading' ? (
                    <p className="tool-message" role="status">Finding places…</p>
                  ) : null}
                  {routeSearchState === 'empty' ? (
                    <p className="tool-message">No matching place found. Try adding “Imphal” or “Manipur” to the place name.</p>
                  ) : null}
                  {routeSearchState === 'error' ? (
                    <p className="tool-message tool-error" role="alert">{routeMessage}</p>
                  ) : null}
                  {routeSearchField && routeCandidates.length > 0 ? (
                    <div className="place-results route-candidates" aria-label="Choose a route location">
                      {routeCandidates.map((place, index) => (
                        <button
                          className="candidate-button"
                          key={`${place.latitude}-${place.longitude}-${index}`}
                          type="button"
                          onClick={() => setRouteFieldValue(routeSearchField, place)}
                        >
                          <strong>{place.name}</strong>
                          <small>{place.displayName}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="route-actions">
                    <button className="route-submit" type="button" onClick={() => void previewRoute()} disabled={routeLoading}>
                      {routeLoading ? 'Finding route…' : 'Preview driving route'}
                    </button>
                    <button className="route-clear" type="button" onClick={clearRoute}>Clear</button>
                  </div>
                  {routeError ? <p className="tool-message tool-error" role="alert">{routeError}</p> : null}
                  {routePreview ? (
                    <div className="route-summary" aria-live="polite">
                      <strong>{routePreview.distanceKm.toFixed(1)} km</strong>
                      <span>about {Math.max(1, Math.round(routePreview.durationMinutes))} min</span>
                      <small>
                        {routePreview.trafficAdjusted
                          ? `${routePreview.source} live traffic${routePreview.trafficDelayMinutes === null ? '' : ` · ${Math.round(routePreview.trafficDelayMinutes)} min delay`}`
                          : `${routePreview.source} estimate · not live traffic-adjusted`}
                      </small>
                      {routePreview.trafficAdjusted && routePreview.riskAssessment ? (
                        <div className="route-risk-result">
                          <strong>
                            Live route risk: {routePreview.riskAssessment.risk_score == null
                              ? 'unavailable'
                              : `${routePreview.riskAssessment.risk_level} · ${Math.round(routePreview.riskAssessment.risk_score)}/100`}
                          </strong>
                          <small>Live conditions index, not a crash probability.</small>
                          {routePreview.riskAssessment.factors.map((factor) => (
                            <small key={factor.name}>
                              {factor.name}: {Math.round(factor.score)}/100 · {factor.observed_value}
                            </small>
                          ))}
                          <small>Assessed {formatWeatherTime(routePreview.riskAssessment.assessed_at)}</small>
                          <details>
                            <summary>Scoring method and limits</summary>
                            <p>{routePreview.riskAssessment.method_summary}</p>
                            <p>{routePreview.riskAssessment.limitation}</p>
                          </details>
                        </div>
                      ) : null}
                      {routePreview.fallbackMessage ? (
                        <small className="route-fallback-note">
                          Live route unavailable: {routePreview.fallbackMessage}
                        </small>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <section className="sidebar-data" aria-label="Traffic and weather status">
              <div className="traffic-source-row">
                <span className="source-symbol" aria-hidden="true">↗</span>
                <span className="source-copy">
                  <strong>Traffic</strong>
                  <small>{providerName} · {providerLabel}</small>
                </span>
                <span
                  className={`status-indicator ${trafficAvailable ? 'available' : 'unavailable'}`}
                  aria-label={trafficAvailable ? 'Live traffic available' : 'Traffic unavailable'}
                />
              </div>
              {trafficAvailable && locationTraffic.data ? (
                <p className="source-explanation">
                  Nearest road at selected location
                  {` · ${locationTraffic.data.current_speed_kmh.toFixed(0)} km/h`}
                  {locationTraffic.data.traffic_delay_seconds == null
                    ? ''
                    : ` · ${Math.round(locationTraffic.data.traffic_delay_seconds / 60)} min delay`}
                </p>
              ) : locationTraffic.status === 'error' ? (
                <p className="source-explanation source-error">
                  {locationTraffic.message}
                </p>
              ) : null}
              <div className="traffic-roads-status" aria-live="polite">
                {dashboard.roads.status === 'loading' ? (
                  <p className="source-explanation">
                    <LoadingIndicator label="Loading traffic road status" />
                    <span>Checking provider road data…</span>
                  </p>
                ) : dashboard.roads.status === 'available' ? (
                  dashboard.roads.data?.roads?.length ? (
                    <ul>
                      {dashboard.roads.data.roads.map((road, index) => (
                        <li key={`${road.name ?? 'road'}-${index}`}>
                          <span>{road.name ?? 'Road segment'}</span>
                          <strong>
                            {road.average_speed_kmh == null
                              ? road.status ?? 'Status unavailable'
                              : `${road.average_speed_kmh.toFixed(0)} km/h`}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="source-explanation">The provider returned no road snapshots.</p>
                  )
                ) : dashboard.roads.status === 'error' || dashboard.roads.status === 'unavailable' ? (
                  <p className="source-explanation source-error">
                    {dashboard.roads.data?.message ?? dashboard.roads.message ?? 'Traffic road data is unavailable.'}
                  </p>
                ) : (
                  <p className="source-explanation">No traffic road data returned.</p>
                )}
              </div>
              <div className="weather-sidecard">
                <div className="weather-side-heading">
                  <span className="weather-symbol" aria-hidden="true">◌</span>
                  <span><strong>Imphal weather</strong><small>Model estimate</small></span>
                  {weatherData?.temperature_c != null ? (
                    <strong className="weather-temperature">{weatherData.temperature_c}°</strong>
                  ) : null}
                </div>
                {dashboard.weather.status === 'available' && weatherData ? (
                  <>
                    <div className="weather-quick-metrics">
                      {weatherMetrics
                        .filter(([, value]) => value !== null && value !== undefined)
                        .map(([label, value, unit]) => (
                          <span key={label}><small>{label}</small><strong>{value}{unit}</strong></span>
                        ))}
                    </div>
                    <p className="weather-update">
                      {weatherData.provider ?? 'Open-Meteo'} estimate
                      {weatherData.valid_at
                        ? ` · valid ${formatWeatherTime(weatherData.valid_at)}`
                        : ''}
                      {weatherData.fetched_at
                        ? ` · fetched ${formatWeatherTime(weatherData.fetched_at)}`
                        : ''}
                    </p>
                  </>
                ) : dashboard.weather.status === 'loading' ? (
                  <p className="weather-update weather-loading">
                    <LoadingIndicator label="Loading weather estimate" />
                  </p>
                ) : dashboard.weather.status === 'error' || dashboard.weather.status === 'unavailable' ? (
                  <p className="weather-update source-error">{weatherData?.message ?? dashboard.weather.message}</p>
                ) : (
                  <p className="weather-update">No current conditions returned.</p>
                )}
              </div>
            </section>
          </aside>

          <section className="map-area" aria-label="Imphal road map">
            <div className="map-location-bar">
              <span className="map-location-symbol" aria-hidden="true">⌖</span>
              <span>
                <strong>{routePreview ? 'Route preview' : routeStart ? routeStart.name : selectedPlace?.name ?? 'Imphal'}</strong>
                <small>
                  {routePreview
                    ? `${routeStart?.name ?? 'Start'} → ${routeEnd?.name ?? 'Destination'}`
                    : routeStart
                      ? 'Starting point selected'
                      : selectedPlace?.displayName ?? 'Manipur, India'}
                </small>
              </span>
              <span className="map-layer-note">
                {showDemoRisk && showRisk
                  ? 'Recorded + synthetic layers'
                  : showDemoRisk
                    ? 'Synthetic AI demo layer'
                    : showRisk
                      ? 'Recorded risk layer'
                      : 'OpenStreetMap'}
              </span>
            </div>
            <MapView
              state={dashboard.riskMap}
              demoState={dashboard.demoRiskMap}
              selectedPlace={selectedPlace}
              routeStart={routeStart}
              routeEnd={routeEnd}
              route={routePreview}
              trafficSegment={trafficSegment}
              showRisk={showRisk}
              showDemoRisk={showDemoRisk}
              onToggleRisk={() => setShowRisk((visible) => !visible)}
              onToggleDemoRisk={() => setShowDemoRisk((visible) => !visible)}
              onLocated={handleLocated}
            />
          </section>
        </section>

        <section className="records-section" aria-label="Risk analysis demonstrations">
          <div className="records-heading">
            <div>
              <span className="eyebrow">ANALYSIS</span>
              <h2>Risk analysis demonstrations</h2>
            </div>
            <p>The synthetic model and source-report examples below are separate demonstrations; neither changes live traffic or baseline risk scores.</p>
          </div>
          <div className="records-grid">
            <section className="record-panel synthetic-ai-panel" aria-labelledby="synthetic-ai-title">
              <div className="record-title">
                <h3 id="synthetic-ai-title">Synthetic AI demonstration</h3>
                <span>Generated dataset · not live</span>
              </div>
              <SyntheticAIAnalysis
                model={dashboard.demoModel}
                locations={dashboard.demoLocations}
                riskMap={dashboard.demoRiskMap}
                patterns={dashboard.demoPatterns}
                observations={dashboard.demoObservations}
                selection={demoSelection}
                prediction={demoPredictionState}
                onSelectLocation={selectDemoLocation}
              />
            </section>
            <section className="record-panel demo-panel" aria-labelledby="demo-title">
              <div className="record-title">
                <h3 id="demo-title">Demo AI analysis</h3>
                <span>Public report sample</span>
              </div>
              <DemoIncidentAnalysis state={dashboard.demo} />
            </section>
          </div>
        </section>
      </main>
      <footer className="page-footer">
        <span>Manipur road risk monitoring</span>
        <span>Search and route services are public OpenStreetMap community services.</span>
      </footer>
    </div>
  )
}

export default App
