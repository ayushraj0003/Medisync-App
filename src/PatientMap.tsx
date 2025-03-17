import { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { decode } from "@mapbox/polyline";
import { supabase } from "./supabase"; // Import your Supabase client
import {GOOGLE_MAPS_API_KEY} from "@env";

// You'll need to replace this with your actual Google Maps API key
// const GOOGLE_MAPS_API_KEY = "";

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
  // Store alertId in a ref to ensure it's always available in callbacks
  const alertIdRef = useRef(alertId);
  
  // Track the alert's status
  const [alertStatus, setAlertStatus] = useState<string | null>(null);
  
  // Track ambulance assignment status
  const [isAmbulanceAssigned, setIsAmbulanceAssigned] = useState(false);
  
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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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
            has_ambulance: Boolean(data.ambulance_latitude && data.ambulance_longitude)
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
                longitude: data.longitude
              });
            }
          } else {
            setIsAmbulanceAssigned(false);
            console.log("No ambulance assigned yet");
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
            updatedAlert.ambulance_latitude && 
            updatedAlert.ambulance_longitude;
            
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
        mapRef.current.animateToRegion({
          ...patientLocation,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01
        }, 500);
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4285F4" />
        <Text style={{ marginTop: 10 }}>Loading emergency data...</Text>
      </View>
    );
  }
  
  // Check if alertId is missing
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
        {ambulanceLocation && isAmbulanceAssigned && (
          <Marker 
            coordinate={ambulanceLocation} 
            title="Ambulance"
            tracksViewChanges={false}
          >
            <AmbulanceMarker />
          </Marker>
        )}

        {/* Route Polyline */}
        {routeCoordinates.length > 0 && isAmbulanceAssigned && (
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
          Emergency Status: {alertStatus ? alertStatus.toUpperCase() : "UNKNOWN"}
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
            <ActivityIndicator size="small" color="#FF3B30" style={styles.spinner} />
            <View style={styles.waitingTextContainer}>
              <Text style={styles.waitingText}>
                Waiting for ambulance to be dispatched...
              </Text>
              <Text style={styles.waitingSubtext}>
                {alertStatus === 'responding' 
                  ? 'Hospital is responding to your emergency'
                  : 'Your alert has been sent to nearby hospitals'}
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
});