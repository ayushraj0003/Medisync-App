import { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
  Platform,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { decode } from "@mapbox/polyline";
import { supabase } from "./supabase";
import { GOOGLE_MAPS_API_KEY } from "@env";

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
  const alertIdRef = useRef<string | null>(null);
  const [alertStatus, setAlertStatus] = useState<string | null>(null);
  const [isAmbulanceAssigned, setIsAmbulanceAssigned] = useState(false);
  const mapRef = useRef<MapView>(null);
  const [patientLocation, setPatientLocation] = useState<Location | null>(null);
  const [ambulanceLocation, setAmbulanceLocation] = useState<Location | null>(null);
  const [hospitalLocation, setHospitalLocation] = useState<Location | null>(null);
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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Enhanced Google Maps check for development builds
  useEffect(() => {
    console.log("=== Google Maps Debug Info ===");
    console.log("Platform:", Platform.OS);
    console.log("Build type:", __DEV__ ? "Development" : "Production");
    console.log("API Key exists:", !!GOOGLE_MAPS_API_KEY);
    console.log("API Key length:", GOOGLE_MAPS_API_KEY?.length || 0);
    
    if (GOOGLE_MAPS_API_KEY) {
      console.log("API Key prefix:", GOOGLE_MAPS_API_KEY.substring(0, 10) + "...");
      
      // Test API key validity
      fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${GOOGLE_MAPS_API_KEY}`)
        .then(response => response.json())
        .then(data => {
          if (data.status === 'REQUEST_DENIED') {
            console.error("❌ Google Maps API key is invalid or restricted");
            setMapError("Google Maps API key is invalid or restricted");
          } else {
            console.log("✅ Google Maps API key is valid");
          }
        })
        .catch(error => {
          console.error("❌ Could not validate Google Maps API key:", error);
        });
    } else {
      console.error("❌ Google Maps API key is missing!");
      setMapError("Google Maps API key is not configured");
    }
    
    // Check if react-native-maps is properly linked
    try {
      console.log("MapView component available:", !!MapView);
      console.log("PROVIDER_GOOGLE available:", !!PROVIDER_GOOGLE);
    } catch (error) {
      console.error("react-native-maps import error:", error);
      setMapError("Map component failed to load");
    }
  }, []);

  // Log the received props for debugging
  useEffect(() => {
    console.log("PatientMapView received alertId:", alertId);

    // Update the ref whenever alertId changes
    alertIdRef.current = alertId;

    // Log warning if alertId is missing
    if (!alertId) {
      console.warn("No alertId provided - cannot track ambulance");
    }
  }, [alertId]);

  // Fetch initial alert data and subscribe to updates
  useEffect(() => {
    if (!alertId) {
      setLoading(false);
      return;
    }

    // Initial fetch of the alert data
    const fetchAlertData = async () => {
      try {
        setLoading(true);
        console.log("Fetching alert data for ID:", alertId);

        const { data, error } = await supabase
          .from("alert")
          .select("*")
          .eq("id", alertId)
          .single();

        if (error) {
          console.error("Error fetching alert data:", error.message);
          Alert.alert("Error", "Failed to fetch alert information.");
          throw error;
        }

        if (data) {
          console.log("Alert data received:", {
            status: data.status,
            has_ambulance: Boolean(
              data.ambulance_latitude && data.ambulance_longitude
            ),
          });

          setAlertDetails(data);
          setAlertStatus(data.status);

          // Set patient location from alert data
          if (data.latitude && data.longitude) {
            const patientLoc = {
              latitude: data.latitude,
              longitude: data.longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            };
            setPatientLocation(patientLoc);
          } else {
            console.warn("Alert has no patient location coordinates");
          }

          // Set ambulance location if available
          if (data.ambulance_latitude && data.ambulance_longitude) {
            setIsAmbulanceAssigned(true);

            const ambulanceLoc = {
              latitude: data.ambulance_latitude,
              longitude: data.ambulance_longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            };
            setAmbulanceLocation(ambulanceLoc);

            if (data.ambulance_last_updated) {
              setLastUpdated(new Date(data.ambulance_last_updated));
            }

            // Calculate route if both locations are available
            if (data.latitude && data.longitude) {
              getDirections(ambulanceLoc, {
                latitude: data.latitude,
                longitude: data.longitude,
              });
            }
          } else {
            setIsAmbulanceAssigned(false);
            console.log("No ambulance assigned yet");
          }

          if (data.hospitalid) {
            // Fetch hospital location from hospitals table
            const { data: hospitalData, error: hospitalError } = await supabase
              .from("hospitals")
              .select("latitude, longitude, name")
              .eq("id", data.hospitalid)
              .single();

            if (!hospitalError && hospitalData && hospitalData.latitude && hospitalData.longitude) {
              setHospitalLocation({
                latitude: hospitalData.latitude,
                longitude: hospitalData.longitude,
                latitudeDelta: 0.005,
                longitudeDelta: 0.005,
                name: hospitalData.name,
              });
            } else {
              setHospitalLocation(null);
            }
          } else {
            setHospitalLocation(null);
          }
        } else {
          console.warn("No alert data found for ID:", alertId);
        }
      } catch (error) {
        console.error("Error in fetchAlertData:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAlertData();

    // Subscribe to real-time updates for this alert
    console.log("Setting up real-time subscription for alert:", alertId);

    const subscription = supabase
      .channel(`patient-alert:${alertId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "alert",
          filter: `id=eq.${alertId}`,
        },
        (payload) => {
          console.log("Real-time update received:", {
            ambulance_lat: payload.new.ambulance_latitude,
            ambulance_lng: payload.new.ambulance_longitude,
            status: payload.new.status,
          });

          const updatedAlert = payload.new;
          setAlertDetails(updatedAlert);
          setAlertStatus(updatedAlert.status);

          // Update ambulance assignment status
          const hasAmbulanceLocation =
            updatedAlert.ambulance_latitude && updatedAlert.ambulance_longitude;

          setIsAmbulanceAssigned(hasAmbulanceLocation);

          // Update ambulance location if available
          if (hasAmbulanceLocation) {
            const newAmbulanceLocation = {
              latitude: updatedAlert.ambulance_latitude,
              longitude: updatedAlert.ambulance_longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            };
            setAmbulanceLocation(newAmbulanceLocation);

            if (updatedAlert.ambulance_last_updated) {
              setLastUpdated(new Date(updatedAlert.ambulance_last_updated));
            }

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
      console.log("Cleaning up subscription");
      supabase.removeChannel(subscription);
    };
  }, [alertId]);

  // Get directions between two points using Google Maps Directions API
  const getDirections = async (start: Location, end: Location) => {
    if (!start || !end) {
      console.warn("Missing start or end coordinates for directions");
      return;
    }

    try {
      // Only fetch new directions if enough time has passed (to avoid excessive API calls)
      const currentTime = Date.now();
      if (currentTime - lastRouteFetchTime < 15000) {
        console.log("Skipping route update - too soon after last update");
        return;
      }

      setLastRouteFetchTime(currentTime);
      console.log("Getting directions from ambulance to patient");

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
        mapRef.current.fitToCoordinates([start, end], {
          edgePadding: mapPadding,
          animated: true,
        });
      }
    } catch (error) {
      console.error("Error getting directions:", error);

      // Fallback to simple straight line if API fails
      console.log("Using fallback straight line path");
      const points = [
        { latitude: start.latitude, longitude: start.longitude },
        { latitude: end.latitude, longitude: end.longitude },
      ];
      setRouteCoordinates(points);

      // Calculate straight-line distance
      const distance = getDistanceFromLatLonInKm(
        start.latitude,
        start.longitude,
        end.latitude,
        end.longitude
      );

      setRouteInfo({
        distance: `${distance.toFixed(1)} km (straight line)`,
        duration: `${Math.ceil((distance / 0.5) * 60)} mins (estimate)`,
      });
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
    if (mapRef.current) {
      if (patientLocation && ambulanceLocation) {
        // If both markers exist, fit to both
        mapRef.current.fitToCoordinates([patientLocation, ambulanceLocation], {
          edgePadding: mapPadding,
          animated: true,
        });
      } else if (patientLocation) {
        // If only patient location exists, center on it
        mapRef.current.animateToRegion(
          {
            ...patientLocation,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          500
        );
      }
    }
  };

  // Format time difference for user-friendly display
  const getTimeSinceUpdate = () => {
    if (!lastUpdated) return "N/A";

    const now = new Date();
    const diffMs = now.getTime() - lastUpdated.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 60) {
      return `${diffSecs} seconds ago`;
    } else if (diffSecs < 3600) {
      return `${Math.floor(diffSecs / 60)} minutes ago`;
    } else {
      return `${Math.floor(diffSecs / 3600)} hours ago`;
    }
  };

  // Handle map errors
  const handleMapError = (error: any) => {
    console.error("=== Map Error Details ===");
    console.error("Error object:", error);
    console.error("Error message:", error?.message);
    console.error("Error stack:", error?.stack);
    
    const errorMessage = error?.message || error?.toString() || "Unknown map error";
    setMapError(`Map failed to load: ${errorMessage}`);
  };

  // Map ready handler
  const handleMapReady = () => {
    console.log("✅ Map is ready!");
    setMapReady(true);
    setMapError(null);
  };

  // Show error state if map fails
  if (mapError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={64} color="#FF3B30" />
        <Text style={styles.errorTitle}>Map Error</Text>
        <Text style={styles.errorText}>{mapError}</Text>
        <Text style={styles.debugText}>
          Platform: {Platform.OS}
          {"\n"}API Key: {GOOGLE_MAPS_API_KEY ? "Present" : "Missing"}
          {"\n"}Build: Development
        </Text>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => {
            setMapError(null);
            setMapReady(false);
          }}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={{ marginTop: 10 }}>Loading emergency data...</Text>
      </View>
    );
  }

  if (!alertId) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={64} color="#FF3B30" />
        <Text style={styles.errorTitle}>No Alert Selected</Text>
        <Text style={styles.errorText}>
          Cannot track ambulance without an emergency alert ID.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Map loading overlay */}
      {!mapReady && (
        <View style={styles.mapLoadingOverlay}>
          <ActivityIndicator size="large" color="#4285F4" />
          <Text style={styles.mapLoadingText}>Loading map...</Text>
          <Text style={styles.debugText}>
            Build: {__DEV__ ? "Development" : "Production"}
            {"\n"}Provider: {Platform.OS === 'android' ? 'Google' : 'Apple'}
          </Text>
        </View>
      )}

      {/* Map View with enhanced configuration for development builds */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        onMapReady={handleMapReady}
        onError={handleMapError}
        initialRegion={
          patientLocation || {
            latitude: 28.6139, // Delhi coordinates as fallback
            longitude: 77.2090,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }
        }
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={true}
        showsScale={true}
        loadingEnabled={true}
        loadingIndicatorColor="#4285F4"
        loadingBackgroundColor="#ffffff"
        // Development build specific props
        mapType="standard"
        showsBuildings={true}
        showsTraffic={false}
        showsIndoors={false}
      >
        {/* Patient Marker */}
        {patientLocation && mapReady && (
          <Marker
            coordinate={patientLocation}
            title="Your Location"
            pinColor="blue"
          />
        )}

        {/* Ambulance Marker */}
        {ambulanceLocation && isAmbulanceAssigned && mapReady && (
          <Marker
            coordinate={ambulanceLocation}
            title="Ambulance"
            tracksViewChanges={false}
          >
            <AmbulanceMarker />
          </Marker>
        )}

        {/* Hospital Marker */}
        {hospitalLocation && mapReady && (
          <Marker
            coordinate={hospitalLocation}
            title={hospitalLocation.name ? hospitalLocation.name : "Responding Hospital"}
            pinColor="green"
          >
            <Ionicons name="medkit" size={28} color="#2ecc40" />
          </Marker>
        )}

        {/* Route Polyline */}
        {routeCoordinates.length > 0 && isAmbulanceAssigned && mapReady && (
          <Polyline
            coordinates={routeCoordinates}
            strokeWidth={5}
            strokeColor="#4285F4"
          />
        )}
      </MapView>

      {/* Status Box */}
      <View style={styles.statusContainer}>
        <Text style={styles.statusTitle}>
          Emergency Status:{" "}
          {alertStatus ? alertStatus.toUpperCase() : "UNKNOWN"}
        </Text>

        {isAmbulanceAssigned ? (
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
              Last updated: {getTimeSinceUpdate()}
            </Text>
          </>
        ) : (
          <View style={styles.waitingContainer}>
            <ActivityIndicator
              size="small"
              color="#FF3B30"
              style={styles.spinner}
            />
            <View style={styles.waitingTextContainer}>
              <Text style={styles.waitingText}>
                Waiting for ambulance to be dispatched...
              </Text>
              <Text style={styles.waitingSubtext}>
                {alertStatus === "responding"
                  ? "Hospital is responding to your emergency"
                  : "Your alert has been sent to nearby hospitals"}
              </Text>
            </View>
          </View>
        )}

        {alertId && (
          <View style={styles.alertIDContainer}>
            <Text style={styles.alertIDText}>
              Alert ID: {alertId.substring(0, 8)}...
            </Text>
          </View>
        )}
      </View>

      {/* Map Controls */}
      <View style={styles.mapControls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={fitMapToMarkers}
        >
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
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    padding: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 20,
    marginBottom: 10,
    color: "#FF3B30",
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
    color: "#666",
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
  waitingContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 5,
  },
  spinner: {
    marginRight: 10,
  },
  waitingTextContainer: {
    flex: 1,
  },
  waitingText: {
    fontSize: 16,
    color: "#FF3B30",
  },
  waitingSubtext: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  alertIDContainer: {
    marginTop: 10,
    padding: 5,
    backgroundColor: "#f0f0f0",
    borderRadius: 5,
    alignSelf: "flex-start",
  },
  alertIDText: {
    fontSize: 10,
    color: "#888",
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
  debugText: {
    fontSize: 12,
    color: "#666",
    marginTop: 10,
    textAlign: "center",
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  retryButtonText: {
    color: "#4285F4",
    fontSize: 16,
    fontWeight: "bold",
  },
  mapLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  mapLoadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#4285F4",
  },
});
