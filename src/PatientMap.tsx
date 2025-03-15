import { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { decode } from "@mapbox/polyline";
import { supabase } from "./supabase"; // Import your Supabase client

// You'll need to replace this with your actual Google Maps API key
const GOOGLE_MAPS_API_KEY = "";

interface Location {
  latitude: number;
  longitude: number;
  latitudeDelta?: number;
  longitudeDelta?: number;
}

interface RouteInfo {
  distance: string;
  duration: string;
}

interface PatientMapViewProps {
  alertId: string; // The ID of the alert to track
}

export default function PatientMapView({ alertId }: PatientMapViewProps) {
  const mapRef = useRef<MapView>(null);
  const [patientLocation, setPatientLocation] = useState<Location | null>(null);
  const [ambulanceLocation, setAmbulanceLocation] = useState<Location | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<Location[]>([]);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRouteFetchTime, setLastRouteFetchTime] = useState(0);
  const [mapPadding, setMapPadding] = useState({
    top: 100,
    right: 50,
    bottom: 100,
    left: 50,
  });
  const [alertDetails, setAlertDetails] = useState<any>(null);

  // Fetch initial alert data and subscribe to updates
  useEffect(() => {
    // Initial fetch of the alert data
    const fetchAlertData = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("alert")
          .select("*")
          .eq("id", alertId)
          .single();

        if (error) {
          throw error;
        }

        if (data) {
          setAlertDetails(data);
          
          // Set patient location from alert data
          const patientLoc = {
            latitude: data.latitude,
            longitude: data.longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          };
          setPatientLocation(patientLoc);
          
          // Set ambulance location if available
          if (data.ambulance_latitude && data.ambulance_longitude) {
            const ambulanceLoc = {
              latitude: data.ambulance_latitude,
              longitude: data.ambulance_longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            };
            setAmbulanceLocation(ambulanceLoc);
            
            // Calculate route if both locations are available
            if (patientLoc && ambulanceLoc) {
              getDirections(ambulanceLoc, patientLoc);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching alert data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAlertData();

    // Subscribe to real-time updates for this alert
    const subscription = supabase
      .channel(`alert:${alertId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "alert",
          filter: `id=eq.${alertId}`,
        },
        (payload) => {
          const updatedAlert = payload.new;
          setAlertDetails(updatedAlert);
          
          // Update ambulance location if available
          if (
            updatedAlert.ambulance_latitude &&
            updatedAlert.ambulance_longitude
          ) {
            const newAmbulanceLocation = {
              latitude: updatedAlert.ambulance_latitude,
              longitude: updatedAlert.ambulance_longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            };
            setAmbulanceLocation(newAmbulanceLocation);
            
            // Update route if patient location is available
            if (patientLocation) {
              getDirections(newAmbulanceLocation, patientLocation);
            }
          }
        }
      )
      .subscribe();

    // Cleanup subscription
    return () => {
      supabase.removeChannel(subscription);
    };
  }, [alertId]);

  // Get directions between two points using Google Maps Directions API
  const getDirections = async (start: Location, end: Location) => {
    if (!start || !end) return;

    try {
      // Only fetch new directions if enough time has passed (to avoid excessive API calls)
      const currentTime = Date.now();
      if (currentTime - lastRouteFetchTime < 15000) {
        return;
      }
      
      setLastRouteFetchTime(currentTime);

      // Construct the Directions API URL
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&key=${GOOGLE_MAPS_API_KEY}`;

      // Fetch directions data
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== "OK") {
        throw new Error(`Directions API returned status: ${data.status}`);
      }

      // Parse the response
      const route = data.routes[0];

      // Decode the polyline
      const points = decode(route.overview_polyline.points);

      // Convert to the format expected by react-native-maps
      const routeCoordinates = points.map((point: [number, number]) => ({
        latitude: point[0],
        longitude: point[1],
      }));

      setRouteCoordinates(routeCoordinates);

      // Extract route info
      const leg = route.legs[0];
      setRouteInfo({
        distance: leg.distance.text,
        duration: leg.duration.text,
      });

      // Fit map to show both markers and the route
      if (mapRef.current && routeCoordinates.length > 0) {
        mapRef.current.fitToCoordinates(
          [start, end],
          {
            edgePadding: mapPadding,
            animated: true,
          }
        );
      }
    } catch (error) {
      console.error("Error getting directions:", error);
      
      // Fallback to simple straight line if API fails
      const points = [
        { latitude: start.latitude, longitude: start.longitude },
        { latitude: end.latitude, longitude: end.longitude },
      ];
      setRouteCoordinates(points);
    }
  };

  // Calculate distance between two points (for direct line distance)
  const getDistanceFromLatLonInKm = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) *
        Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const deg2rad = (deg: number): number => {
    return deg * (Math.PI / 180);
  };

  // Custom ambulance marker component
  const AmbulanceMarker = () => (
    <View style={styles.markerContainer}>
      <Ionicons
        name="medical"
        size={16}
        color="white"
        style={styles.medicalIcon}
      />
      <View style={styles.ambulanceContainer}>
        <Ionicons name="car" size={24} color="red" />
      </View>
    </View>
  );

  // Center map to show all markers
  const fitMapToMarkers = () => {
    if (mapRef.current && patientLocation && ambulanceLocation) {
      mapRef.current.fitToCoordinates([patientLocation, ambulanceLocation], {
        edgePadding: mapPadding,
        animated: true,
      });
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={{ marginTop: 10 }}>Loading ambulance location...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Map View */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={
          patientLocation || {
            latitude: 37.78825,
            longitude: -122.4324,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }
        }
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass
        showsScale
      >
        {/* Patient Marker */}
        {patientLocation && (
          <Marker 
            coordinate={patientLocation} 
            title="Your Location" 
            pinColor="blue"
          />
        )}

        {/* Ambulance Marker */}
        {ambulanceLocation && (
          <Marker coordinate={ambulanceLocation} title="Ambulance">
            <AmbulanceMarker />
          </Marker>
        )}

        {/* Route Polyline */}
        {routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeWidth={5}
            strokeColor="#4285F4"
          />
        )}
      </MapView>

      {/* Status Box */}
      <View style={styles.statusContainer}>
        <Text style={styles.statusTitle}>Ambulance Status</Text>
        {ambulanceLocation ? (
          <>
            <Text style={styles.statusText}>Ambulance is on the way!</Text>
            {routeInfo && (
              <>
                <Text style={styles.routeInfoText}>
                  Distance: {routeInfo.distance}
                </Text>
                <Text style={styles.routeInfoText}>
                  Estimated arrival: {routeInfo.duration}
                </Text>
              </>
            )}
            <Text style={styles.updateText}>
              Location updates in real-time
            </Text>
          </>
        ) : (
          <Text style={styles.statusText}>
            Waiting for ambulance to be dispatched...
          </Text>
        )}
      </View>

      {/* Map Controls */}
      <View style={styles.mapControls}>
        <TouchableOpacity style={styles.controlButton} onPress={fitMapToMarkers}>
          <Ionicons name="locate" size={24} color="#4285F4" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  statusContainer: {
    position: "absolute",
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: "white",
    borderRadius: 10,
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#4285F4",
  },
  statusText: {
    fontSize: 16,
    marginBottom: 5,
  },
  routeInfoText: {
    fontSize: 14,
    marginBottom: 2,
    color: "#444",
  },
  updateText: {
    fontSize: 12,
    marginTop: 5,
    color: "#888",
    fontStyle: "italic",
  },
  mapControls: {
    position: "absolute",
    bottom: 30,
    right: 20,
  },
  controlButton: {
    backgroundColor: "white",
    borderRadius: 50,
    width: 50,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  markerContainer: {
    alignItems: "center",
  },
  ambulanceContainer: {
    backgroundColor: "white",
    borderRadius: 50,
    padding: 5,
    borderWidth: 2,
    borderColor: "red",
  },
  medicalIcon: {
    position: "absolute",
    top: -8,
    zIndex: 1,
    backgroundColor: "red",
    borderRadius: 10,
    padding: 2,
  },
});