"use client";

import React, { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
// Import leaflet CSS at the top level for Next.js (will be included only on client)
import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";
import "leaflet-defaulticon-compatibility";
// If you get a TS7016 error for the above, add a file src/types/leaflet-defaulticon-compatibility.d.ts with:
// declare module 'leaflet-defaulticon-compatibility';

// Dynamically import react-leaflet components (to avoid SSR issues)
const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
);
const GeoJSON = dynamic(
  () => import("react-leaflet").then((mod) => mod.GeoJSON),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false }
);

// Helper: get color based on sales count
function getCountyColor(sales: number, max: number): string {
  if (sales === 0) return "#f0f0f0";
  // Blue scale: interpolate from light to dark
  const percent = Math.min(sales / max, 1);
  const light = 230 - Math.round(percent * 120); // 230 (light) to 110 (dark)
  return `rgb(${light},${light + 10},255)`;
}

interface UkSalesMapProps {
  countySalesMap: Record<string, number>;
}

const UK_BOUNDS: [[number, number], [number, number]] = [
  [49.8, -8.7], // SW
  [60.9, 1.8],  // NE
];

const LAD_JSON_PATH = "/lad.json";

const UkSalesMap: React.FC<UkSalesMapProps> = ({ countySalesMap }) => {
  const [geoData, setGeoData] = useState<any>(null);
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<[number, number] | null>(null);

  // Find max sales for color scaling
  const maxSales = useMemo(() =>
    Math.max(1, ...Object.values(countySalesMap)),
    [countySalesMap]
  );

  // Load GeoJSON (client-side only)
  useEffect(() => {
    fetch(LAD_JSON_PATH)
      .then((res) => res.json())
      .then(setGeoData)
      .catch(console.error);
  }, []);

  // Style function for GeoJSON
  const styleFn = (feature: any) => {
    const countyName = feature.properties?.LAD23NM || feature.properties?.name;
    const sales = countySalesMap[countyName] || 0;
    return {
      fillColor: getCountyColor(sales, maxSales),
      weight: 1,
      opacity: 1,
      color: "#333",
      fillOpacity: 0.7,
      cursor: "pointer",
    };
  };

  // onEachFeature for GeoJSON
  const onEachFeature = (feature: any, layer: any) => {
    const countyName = feature.properties?.LAD23NM || feature.properties?.name;
    const sales = countySalesMap[countyName] || 0;
    layer.on({
      click: (e: any) => {
        setSelectedCounty(countyName);
        setPopupPos([e.latlng.lat, e.latlng.lng]);
      },
      mouseover: function (e: any) {
        layer.setStyle({ weight: 3, color: "#222" });
      },
      mouseout: function (e: any) {
        layer.setStyle({ weight: 1, color: "#333" });
      },
    });
    layer.bindTooltip(
      `${countyName}: ${sales} orders`,
      { sticky: true, direction: "top", className: "leaflet-tooltip" }
    );
  };

  return (
    <div style={{ width: "100%", height: 400, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 8px #0001" }}>
      {geoData && (
        <MapContainer
          bounds={UK_BOUNDS}
          style={{ width: "100%", height: "100%", zIndex: 0 }}
          scrollWheelZoom={true}
          zoom={6}
          minZoom={5}
          maxBounds={UK_BOUNDS}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <GeoJSON
            data={geoData}
            style={styleFn}
            onEachFeature={onEachFeature}
          />
          {selectedCounty && popupPos && (
            <Popup position={popupPos} eventHandlers={{ remove: () => setSelectedCounty(null) }}>
              <div>
                <strong>{selectedCounty}</strong>
                <br />
                Orders: {countySalesMap[selectedCounty] || 0}
              </div>
            </Popup>
          )}
        </MapContainer>
      )}
      {!geoData && (
        <div className="flex items-center justify-center h-full text-gray-500">Loading map…</div>
      )}
    </div>
  );
};

export default UkSalesMap; 