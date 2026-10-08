import { useEffect, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { RemoteMapState } from './api'
import { getCurrentDeviceLocation, type MapPlace, type RoutePreview } from './mapServices'

type RiskPoint = {
  latitude: number
  longitude: number
  label: string
  properties: Record<string, unknown>
}

type MapViewProps = {
  state: RemoteMapState
  demoState: RemoteMapState
  selectedPlace: MapPlace | null
  routeStart: MapPlace | null
  routeEnd: MapPlace | null
  route: RoutePreview | null
  trafficSegment: [number, number][] | null
  showRisk: boolean
  showDemoRisk: boolean
  onToggleRisk: () => void
  onToggleDemoRisk: () => void
  onLocated: (place: MapPlace) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function makePoint(
  coordinates: unknown,
  properties: Record<string, unknown>,
): RiskPoint | null {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null
  const longitude = numericValue(coordinates[0])
  const latitude = numericValue(coordinates[1])
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) return null

  const label =
    properties.name ??
    properties.location ??
    properties.road_name ??
    properties.area ??
    properties.id ??
    'Risk location'

  return {
    latitude,
    longitude,
    label: String(label),
    properties,
  }
}

function extractRiskPoints(value: unknown): RiskPoint[] {
  if (!isRecord(value)) {
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => {
      if (!isRecord(entry)) return []
      if (
        entry.type === 'Feature' &&
        isRecord(entry.geometry) &&
        entry.geometry.type === 'Point'
      ) {
        const properties = isRecord(entry.properties) ? entry.properties : {}
        const point = makePoint(entry.geometry.coordinates, properties)
        return point ? [point] : []
      }
      const properties = isRecord(entry.properties) ? entry.properties : entry
      const latitude = entry.latitude ?? entry.lat
      const longitude = entry.longitude ?? entry.lng ?? entry.lon
      const point = makePoint([longitude, latitude], properties)
      return point ? [point] : []
    })
  }

  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value.features.flatMap((feature) => {
      if (!isRecord(feature) || !isRecord(feature.geometry)) return []
      if (feature.geometry.type !== 'Point') return []
      const properties = isRecord(feature.properties) ? feature.properties : {}
      const point = makePoint(feature.geometry.coordinates, properties)
      return point ? [point] : []
    })
  }

  for (const key of ['risk_map', 'data', 'result', 'risk_points', 'points', 'locations', 'risk_areas', 'features']) {
    if (value[key] && typeof value[key] === 'object') {
      return extractRiskPoints(value[key])
    }
  }
  return []
}

function propertyValue(properties: Record<string, unknown>, keys: string[]): unknown {
  const foundKey = keys.find((key) => properties[key] !== undefined && properties[key] !== null)
  return foundKey ? properties[foundKey] : undefined
}

function markerColor(properties: Record<string, unknown>): string {
  const severity = String(
    propertyValue(properties, ['risk_level', 'severity', 'status']) ?? '',
  ).toLowerCase()
  if (severity === 'critical' || severity === 'high') return '#b64032'
  if (severity === 'moderate' || severity === 'medium') return '#c27b20'
  if (severity === 'low' || severity === 'clear') return '#39745b'
  return '#315d73'
}

function valueLabel(key: string): string {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function printable(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function MapController({
  selectedPlace,
  route,
}: {
  selectedPlace: MapPlace | null
  route: RoutePreview | null
}) {
  const map = useMap()

  useEffect(() => {
    if (route?.coordinates.length) {
      const bounds: LatLngBoundsExpression = route.coordinates
      map.fitBounds(bounds, { padding: [52, 52], maxZoom: 15 })
    } else if (selectedPlace) {
      map.flyTo([selectedPlace.latitude, selectedPlace.longitude], 15, { duration: 0.65 })
    }
  }, [map, route, selectedPlace])

  return null
}

function MapControls({
  hasRisk,
  hasDemoRisk,
  showRisk,
  showDemoRisk,
  onToggleRisk,
  onToggleDemoRisk,
  onLocated,
}: {
  hasRisk: boolean
  hasDemoRisk: boolean
  showRisk: boolean
  showDemoRisk: boolean
  onToggleRisk: () => void
  onToggleDemoRisk: () => void
  onLocated: (place: MapPlace) => void
}) {
  const map = useMap()
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')

  const locate = async () => {
    setLocationError('')
    setLocating(true)
    try {
      const place = await getCurrentDeviceLocation()
      map.flyTo([place.latitude, place.longitude], 15, { duration: 0.65 })
      onLocated(place)
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : 'Could not find your current location.')
    } finally {
      setLocating(false)
    }
  }

  return (
    <div className="map-controls" aria-label="Map controls">
      <button
        className="map-control-button"
        type="button"
        onClick={locate}
        disabled={locating}
        aria-label="Show my current location"
        title="Show my location"
      >
        <span aria-hidden="true">{locating ? '…' : '◎'}</span>
      </button>
      <button
        className={`map-control-button map-layer-button${showRisk ? ' is-active' : ''}`}
        type="button"
        onClick={onToggleRisk}
        disabled={!hasRisk}
        aria-pressed={showRisk}
        title={hasRisk ? 'Toggle backend risk locations' : 'No backend risk locations are available'}
      >
        <span className="layer-glyph" aria-hidden="true">▱</span>
        <span>Risk</span>
      </button>
      <button
        className={`map-control-button map-layer-button${showDemoRisk ? ' is-active' : ''}`}
        type="button"
        onClick={onToggleDemoRisk}
        disabled={!hasDemoRisk}
        aria-pressed={showDemoRisk}
        title={hasDemoRisk ? 'Toggle synthetic AI demonstration locations' : 'No synthetic AI map locations are available'}
      >
        <span className="layer-glyph demo-layer-glyph" aria-hidden="true">◎</span>
        <span>AI demo</span>
      </button>
      {locationError ? (
        <p className="map-control-error" role="status">{locationError}</p>
      ) : null}
    </div>
  )
}

function MapView({
  state,
  demoState,
  selectedPlace,
  routeStart,
  routeEnd,
  route,
  trafficSegment,
  showRisk,
  showDemoRisk,
  onToggleRisk,
  onToggleDemoRisk,
  onLocated,
}: MapViewProps) {
  const points =
    state.status === 'available' || state.status === 'empty'
      ? extractRiskPoints(state.data)
      : []
  const demoPoints =
    demoState.status === 'available' || demoState.status === 'empty'
      ? extractRiskPoints(demoState.data)
      : []
  return (
    <div className="map-canvas">
      <MapContainer
        center={[24.817, 93.9368]}
        zoom={13}
        scrollWheelZoom
        keyboard
        attributionControl={false}
        aria-label="OpenStreetMap of Imphal with place search, route preview, and backend risk locations"
      >
        <TileLayer
          attribution=""
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController selectedPlace={selectedPlace} route={route} />
        <MapControls
          hasRisk={points.length > 0}
          hasDemoRisk={demoPoints.length > 0}
          showRisk={showRisk}
          showDemoRisk={showDemoRisk}
          onToggleRisk={onToggleRisk}
          onToggleDemoRisk={onToggleDemoRisk}
          onLocated={onLocated}
        />
        {showRisk ? points.map((point, index) => {
          const color = markerColor(point.properties)
          const score = propertyValue(point.properties, ['risk_score', 'score'])
          return (
            <CircleMarker
              key={`${point.latitude}-${point.longitude}-${index}`}
              center={[point.latitude, point.longitude]}
              radius={9}
              pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 0.94, weight: 3 }}
            >
              <Popup>
                <strong>{point.label}</strong>
                <dl className="map-popup-details">
                  {score !== undefined ? (
                    <div><dt>Risk score</dt><dd>{printable(score)}</dd></div>
                  ) : null}
                  {Object.entries(point.properties)
                    .filter(([key, value]) =>
                      !['name', 'location', 'road_name', 'area', 'id', 'risk_score', 'score'].includes(key) &&
                      value !== null &&
                      typeof value !== 'object',
                    )
                    .map(([key, value]) => (
                      <div key={key}><dt>{valueLabel(key)}</dt><dd>{printable(value)}</dd></div>
                    ))}
                </dl>
              </Popup>
            </CircleMarker>
          )
        }) : null}
        {showDemoRisk ? demoPoints.map((point, index) => {
          const color = markerColor(point.properties)
          const score = propertyValue(point.properties, ['risk_score', 'score'])
          return (
            <CircleMarker
              key={`demo-${point.latitude}-${point.longitude}-${index}`}
              center={[point.latitude, point.longitude]}
              radius={10}
              pathOptions={{ color: '#fff', fillColor: color, fillOpacity: 0.9, weight: 3 }}
            >
              <Popup>
                <strong>{point.label}</strong>
                <div className="map-demo-popup-label">Synthetic model output · not measured risk</div>
                <dl className="map-popup-details">
                  {score !== undefined ? (
                    <div><dt>Synthetic score / 100</dt><dd>{printable(score)}</dd></div>
                  ) : null}
                  {Object.entries(point.properties)
                    .filter(([key, value]) =>
                      !['name', 'location', 'road_name', 'area', 'id', 'risk_score', 'score'].includes(key) &&
                      value !== null &&
                      typeof value !== 'object',
                    )
                    .map(([key, value]) => (
                      <div key={key}><dt>{valueLabel(key)}</dt><dd>{printable(value)}</dd></div>
                    ))}
                </dl>
              </Popup>
            </CircleMarker>
          )
        }) : null}
        {trafficSegment && trafficSegment.length >= 2 ? (
          <Polyline
            positions={trafficSegment}
            pathOptions={{ color: '#d87526', weight: 7, opacity: 0.9 }}
          />
        ) : null}
        {route ? (
          <Polyline
            positions={route.coordinates}
            pathOptions={{ color: '#fff', weight: 9, opacity: 0.92 }}
            interactive={false}
          />
        ) : null}
        {route ? (
          <Polyline
            positions={route.coordinates}
            pathOptions={{ color: '#2676d2', weight: 6, opacity: 0.95 }}
          />
        ) : null}
        {selectedPlace ? (
          <CircleMarker
            center={[selectedPlace.latitude, selectedPlace.longitude]}
            radius={8}
            pathOptions={{ color: '#fff', fillColor: '#2478d4', fillOpacity: 1, weight: 3 }}
          >
            <Popup>
              <strong>{selectedPlace.name}</strong>
              <br />
              {selectedPlace.displayName}
            </Popup>
          </CircleMarker>
        ) : null}
        {routeStart ? (
          <CircleMarker
            center={[routeStart.latitude, routeStart.longitude]}
            radius={7}
            pathOptions={{ color: '#fff', fillColor: '#317c54', fillOpacity: 1, weight: 3 }}
          >
            <Popup><strong>Start</strong><br />{routeStart.name}</Popup>
          </CircleMarker>
        ) : null}
        {routeEnd ? (
          <CircleMarker
            center={[routeEnd.latitude, routeEnd.longitude]}
            radius={7}
            pathOptions={{ color: '#fff', fillColor: '#b34436', fillOpacity: 1, weight: 3 }}
          >
            <Popup><strong>Destination</strong><br />{routeEnd.name}</Popup>
          </CircleMarker>
        ) : null}
      </MapContainer>
      {showRisk && state.status === 'loading' ? (
        <div className="map-overlay map-overlay-loading" role="status" aria-label="Loading risk map">
          <span className="loading-spinner" aria-hidden="true" />
        </div>
      ) : showRisk && state.status === 'unavailable' ? (
        <div className="map-overlay" role="status">
          <strong>Backend risk layer unavailable</strong>
          <span>{state.message}</span>
        </div>
      ) : showRisk && state.status === 'error' ? (
        <div className="map-overlay map-overlay-error" role="alert">
          <strong>Backend risk layer could not be loaded</strong>
          <span>{state.message}</span>
        </div>
      ) : null}
      {showDemoRisk && demoState.status === 'loading' ? (
        <div className="map-overlay map-overlay-loading" role="status" aria-label="Loading synthetic AI risk map">
          <span className="loading-spinner" aria-hidden="true" />
        </div>
      ) : showDemoRisk && demoState.status === 'unavailable' ? (
        <div className="map-overlay" role="status">
          <strong>Synthetic AI map unavailable</strong>
          <span>{demoState.message}</span>
        </div>
      ) : showDemoRisk && demoState.status === 'error' ? (
        <div className="map-overlay map-overlay-error" role="alert">
          <strong>Synthetic AI map could not be loaded</strong>
          <span>{demoState.message}</span>
        </div>
      ) : null}
      <a
        className="map-attribution"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  )
}

export default MapView
