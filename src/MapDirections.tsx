"use client";

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
import * as Location from "expo-location";
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

export default function MapDirections(props) {
  // Extract params from both props and route
  const route = props.route || {};

  // Get params either directly from props or from route.params
  const destinationLatitude =
    props.destinationLatitude || route.params?.destinationLatitude;
  const destinationLongitude =
    props.destinationLongitude || route.params?.destinationLongitude;
  const alertId = props.alertId || route.params?.alertId;
  const status = props.status || route.params?.status || "active";

  // Log what we received for debugging
  useEffect(() => {
    console.log("MapDirections received:", {
      fromProps: {
        destinationLatitude: props.destinationLatitude,
        destinationLongitude: props.destinationLongitude,
        alertId: props.alertId,
        status: props.status,
      },
      fromRoute: route.params,
      usingValues: {
        destinationLatitude,
        destinationLongitude,
        alertId,
        status,
      },
    });
  }, [props, route]);

  const [updateError, setUpdateError] = useState(null);
  // Rest of your component stays the same
  const alertIdRef = useRef(alertId);
  const lastUpdateTimeRef = useRef(0);
  const UPDATE_INTERVAL_MS = 3000;

  const mapRef = useRef<MapView>(null);
  const [origin, setOrigin] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<Location[]>([]);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [locationSubscription, setLocationSubscription] = useState<any>(null);
  const [followUserLocation, setFollowUserLocation] = useState(true);
  const [lastRouteFetchTime, setLastRouteFetchTime] = useState(0);
  const [mapPadding, setMapPadding] = useState({
    top: 100,
    right: 50,
    bottom: 100,
    left: 50,
  });

  // Listen for changes in alertId. If a new alertId is passed, reset tracking.
  // Uncomment and modify this effect to use current location
useEffect(() => {
  if (alertId && status === "responding" && currentLocation) {
    // Do a direct update with current location whenever it changes
    const updateWithCurrentLocation = async () => {
      try {
        console.log("Updating with current location:", currentLocation);
        
        const { data, error } = await supabase
          .from("alert")
          .update({
            ambulance_latitude: currentLocation.latitude,
            ambulance_longitude: currentLocation.longitude,
            ambulance_last_updated: new Date().toISOString()
          })
          .eq("id", alertId);
          
        if (error) {
          console.error("❌ LOCATION UPDATE FAILED:", error);
          setUpdateError(error.message);
        } else {
          console.log("✅ LOCATION UPDATE SUCCEEDED");
        }
      } catch (e) {
        console.error("❌ EXCEPTION IN LOCATION UPDATE:", e);
        setUpdateError(e.message);
      }
    };
    
    // Update when this effect runs
    updateWithCurrentLocation();
  }
}, [alertId, status, currentLocation]);  // This will run whenever location changes

  // Add this effect to check authentication status
useEffect(() => {
  const checkAuth = async () => {
    const { data, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error("❌ AUTH ERROR:", error);
      setUpdateError(`Auth error: ${error.message}`);
    } else if (!data.session) {
      console.warn("⚠️ NO AUTH SESSION - updates might be rejected");
    } else {
      console.log("✅ AUTH SESSION VALID:", data.session.user?.id);
    }
  };
  
  checkAuth();
}, []);

  useEffect(() => {
    if (!alertId) {
      console.warn("No alertId provided - location updates won't be saved");
      return;
    }

    // If the new alertId differs from the old one, restart tracking
    if (alertId !== alertIdRef.current) {
      console.log("New alert ID detected:", alertId);
      alertIdRef.current = alertId;
      lastUpdateTimeRef.current = 0;
      // Clean up old subscription if it exists
      if (locationSubscription) {
        locationSubscription.remove();
        setLocationSubscription(null);
      }
      startLocationTracking(); // re-start with new alert ID
    }
  }, [alertId]);

  // Log initial props
  useEffect(() => {
    console.log("Props received:", {
      destinationLatitude,
      destinationLongitude,
      alertId,
      status,
    });
  }, [destinationLatitude, destinationLongitude, alertId, status]);

  // Update destination when props change
  useEffect(() => {
    if (destinationLatitude && destinationLongitude) {
      const lat = parseFloat(destinationLatitude);
      const lng = parseFloat(destinationLongitude);

      console.log("Setting destination to:", lat, lng, alertId);

      if (!isNaN(lat) && !isNaN(lng)) {
        const newDestination = {
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        };
        setDestination(newDestination);

        // If we already have the user's location, update the route
        if (origin) {
          getDirections(origin, newDestination);
        }

        // Fit the map to show both points if we have origin
        if (origin && mapRef.current) {
          const coordinates = [origin, newDestination];
          mapRef.current.fitToCoordinates(coordinates, {
            edgePadding: mapPadding,
            animated: true,
          });
        }
      } else {
        console.error(
          "Invalid destination coordinates:",
          destinationLatitude,
          destinationLongitude
        );
      }
    } else {
      console.warn("Missing destination coordinates");
    }
  }, [destinationLatitude, destinationLongitude, origin]);

  // Request location permissions on mount
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.error("Permission to access location was denied");
        Alert.alert(
          "Location Permission Denied",
          "Please enable location permissions to track ambulance position."
        );
        return;
      }
      // Only start tracking here if alertId was provided initially
      if (alertIdRef.current) {
        startLocationTracking();
      }
    })();

    return () => {
      // Clean up subscription when component unmounts
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, []);

  // Periodically verify location updates stored in DB
  // useEffect(() => {
  //   if (!alertId) return;
  //   const interval = setInterval(async () => {
  //     try {
  //       const { data, error } = await supabase
  //         .from("alert")
  //         .select(
  //           "ambulance_latitude, ambulance_longitude, ambulance_last_updated"
  //         )
  //         .eq("id", alertId)
  //         .single();

  //       if (error) {
  //         console.error("Failed to verify location updates:", error);
  //         return;
  //       }
  //       if (data) {
  //         const lastUpdateTime = data.ambulance_last_updated
  //           ? new Date(data.ambulance_last_updated)
  //           : null;
  //         const timeSinceUpdate = lastUpdateTime
  //           ? (new Date().getTime() - lastUpdateTime.getTime()) / 1000
  //           : null;

  //         console.log(
  //           `DB ambulance location: (${data.ambulance_latitude}, ${
  //             data.ambulance_longitude
  //           }), last updated: ${
  //             timeSinceUpdate ? Math.round(timeSinceUpdate) + "s ago" : "never"
  //           }`
  //         );
  //       }
  //     } catch (err) {
  //       console.error("Error verifying location updates:", err);
  //     }
  //   }, 15000);

  //   return () => clearInterval(interval);
  // }, [alertId]);

  // Update ambulance location in Supabase
  // const updateAmbulanceLocation = async (
  //   latitude: number,
  //   longitude: number
  // ) => {
  //   const currentAlertId = alertIdRef.current;
  //   if (!currentAlertId) {
  //     console.log(
  //       "No valid alert ID available for updating ambulance location"
  //     );
  //     return false;
  //   }
  //   if (typeof latitude !== "number" || typeof longitude !== "number") {
  //     console.error("Invalid coordinates:", latitude, longitude);
  //     return false;
  //   }
  //   const now = Date.now();
  //   if (now - lastUpdateTimeRef.current < UPDATE_INTERVAL_MS) {
  //     console.log("Skipping update - too soon after last update");
  //     return false;
  //   }
  //   // Ensure the status is exactly 'responding'
  //   if (status !== "responding") {
  //     console.log(
  //       `Status is not 'responding' (current: ${status}), skipping DB update`
  //     );
  //     return false;
  //   }

  //   try {
  //     console.log(
  //       `Updating ambulance location for alert ${currentAlertId}: lat=${latitude}, lng=${longitude}`
  //     );
  //     const { data, error } = await supabase
  //       .from("alert")
  //       .update({
  //         ambulance_latitude: latitude,
  //         ambulance_longitude: longitude,
  //         ambulance_last_updated: new Date().toISOString(),
  //       })
  //       .eq("id", currentAlertId);

  //     if (error) {
  //       console.error("Error updating ambulance location:", error);
  //       return false;
  //     }
  //     lastUpdateTimeRef.current = now;
  //     console.log("Successfully updated ambulance location in database");
  //     return true;
  //   } catch (error) {
  //     console.error("Exception updating ambulance location:", error);
  //     return false;
  //   }
  // };

  // Start real-time location tracking
  const startLocationTracking = async () => {
    try {
      console.log("Starting location tracking for alert:", alertIdRef.current);
      const initialLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      const { latitude, longitude } = initialLocation.coords;
      const newLocation = {
        latitude,
        longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      };

      setCurrentLocation(newLocation);
      setOrigin(newLocation);

      // const updated = await updateAmbulanceLocation(latitude, longitude);
      // console.log(
      //   `Initial location update ${updated ? "successful" : "failed"}`
      // );

      // Subscribe to location updates
      setTimeout(async () => {
        const subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Highest,
            distanceInterval: 10,
            timeInterval: 5000,
          },
          async (location) => {
            const { latitude, longitude } = location.coords;
            const newLoc = {
              latitude,
              longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            };
            setCurrentLocation(newLoc);
            setOrigin(newLoc);

            // const updated = await updateAmbulanceLocation(latitude, longitude);
            // if (!updated) {
            //   console.warn("Failed to update ambulance location in database");
            // }

            if (followUserLocation && mapRef.current) {
              mapRef.current.animateToRegion(newLoc, 500);
            }

            if (destination && shouldUpdateRoute(newLoc)) {
              getDirections(newLoc, destination);
            }
          }
        );
        setLocationSubscription(subscription);
      }, 1000);
    } catch (error) {
      console.error("Error starting location tracking:", error);
      Alert.alert(
        "Location Error",
        "Failed to start location tracking. Please check your device settings."
      );
    }
  };

  // Decide if we should get new directions
  const shouldUpdateRoute = (newLocation: Location): boolean => {
    if (!origin || routeCoordinates.length === 0) return true;
    const distance = getDistanceFromLatLonInKm(
      newLocation.latitude,
      newLocation.longitude,
      origin.latitude,
      origin.longitude
    );
    const currentTime = Date.now();
    // At least 15s since last route fetch AND user moved more than 30m
    return currentTime - lastRouteFetchTime > 15000 && distance > 0.03;
  };

  // Calculate distance
  const getDistanceFromLatLonInKm = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371;
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

  // Get directions from Google Maps
  const getDirections = async (start: Location, end: Location) => {
    if (!start || !end) return;
    try {
      setLoading(true);
      setLastRouteFetchTime(Date.now());

      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&key=${GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.status !== "OK") {
        throw new Error(`Directions API returned status: ${data.status}`);
      }

      const route = data.routes[0];
      const points = decode(route.overview_polyline.points);
      const routeCoords = points.map((point: [number, number]) => ({
        latitude: point[0],
        longitude: point[1],
      }));

      setRouteCoordinates(routeCoords);

      const leg = route.legs[0];
      setRouteInfo({
        distance: leg.distance.text,
        duration: leg.duration.text,
      });

      if (mapRef.current && routeCoords.length > 0) {
        mapRef.current.fitToCoordinates(routeCoords, {
          edgePadding: mapPadding,
          animated: true,
        });
      }
    } catch (error) {
      console.error("Error getting directions:", error);
      fallbackDirections(start, end);
    } finally {
      setLoading(false);
    }
  };

  // Fallback if Google Maps fails
  const fallbackDirections = (start: Location, end: Location) => {
    console.warn("Using fallback directions method");
    const points = [
      { latitude: start.latitude, longitude: start.longitude },
      { latitude: end.latitude, longitude: end.longitude },
    ];
    setRouteCoordinates(points);

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
  };

  // Center map on current location
  const centerOnUser = () => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion(currentLocation, 500);
      setFollowUserLocation(true);
    }
  };

  // Toggle following user
  const toggleFollowUser = () => {
    setFollowUserLocation(!followUserLocation);
    if (!followUserLocation && currentLocation && mapRef.current) {
      mapRef.current.animateToRegion(currentLocation, 500);
    }
  };

  // Fetch directions when origin/destination both set
  useEffect(() => {
    if (origin && destination) {
      console.log(
        "Both origin and destination available, getting directions..."
      );
      getDirections(origin, destination);
    }
  }, [origin, destination]);

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

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={
          currentLocation || {
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
        onPanDrag={() => setFollowUserLocation(false)}
        minZoomLevel={5}
        maxZoomLevel={20}
        zoomEnabled
        zoomControlEnabled
        rotateEnabled
        scrollEnabled
        pitchEnabled
      >
        {origin && (
          <Marker coordinate={origin} title="Your Location">
            <AmbulanceMarker />
          </Marker>
        )}

        {destination && (
          <Marker coordinate={destination} title="Destination" pinColor="red" />
        )}

        {routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeWidth={5}
            strokeColor="#4285F4"
          />
        )}
      </MapView>

      {alertId && (
        <View style={styles.debugInfoContainer}>
          <Text style={styles.debugText}>
            Alert ID: {alertId.substring(0, 8)}...
          </Text>
          <Text style={styles.debugText}>
            Updates: {currentLocation ? "Active" : "Waiting..."}
          </Text>
        </View>
      )}

      {routeInfo && (
        <View style={styles.routeInfoContainer}>
          <Text style={styles.routeInfoText}>
            Distance: {routeInfo.distance} • Duration: {routeInfo.duration}
          </Text>
          <Text style={styles.updateText}>
            Updates in real-time as you move
          </Text>
        </View>
      )}

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4285F4" />
        </View>
      )}

      <View style={styles.mapControls}>
        <TouchableOpacity style={styles.controlButton} onPress={centerOnUser}>
          <Ionicons name="locate" size={24} color="#4285F4" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.controlButton,
            followUserLocation && styles.activeControlButton,
          ]}
          onPress={toggleFollowUser}
        >
          <Ionicons
            name="navigate"
            size={24}
            color={followUserLocation ? "white" : "#4285F4"}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => {
            if (mapRef.current) {
              mapRef.current.getCamera().then((camera) => {
                if (camera) {
                  camera.zoom = (camera.zoom || 15) + 1;
                  mapRef.current?.animateCamera(camera, { duration: 300 });
                }
              });
            }
          }}
        >
          <Ionicons name="add" size={24} color="#4285F4" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => {
            if (mapRef.current) {
              mapRef.current.getCamera().then((camera) => {
                if (camera) {
                  camera.zoom = Math.max((camera.zoom || 15) - 1, 5);
                  mapRef.current?.animateCamera(camera, { duration: 300 });
                }
              });
            }
          }}
        >
          <Ionicons name="remove" size={24} color="#4285F4" />
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
  markerContainer: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  ambulanceContainer: {
    backgroundColor: "white",
    borderRadius: 15,
    padding: 5,
    borderWidth: 2,
    borderColor: "#4285F4",
  },
  medicalIcon: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "red",
    borderRadius: 10,
    padding: 2,
    zIndex: 1,
  },
  routeInfoContainer: {
    position: "absolute",
    bottom: 40,
    left: 10,
    right: 10,
    backgroundColor: "white",
    borderRadius: 8,
    padding: 15,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  routeInfoText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  updateText: {
    fontSize: 12,
    color: "#4285F4",
    marginTop: 5,
  },
  loadingContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.7)",
  },
  mapControls: {
    position: "absolute",
    right: 16,
    bottom: 160,
    alignItems: "center",
  },
  controlButton: {
    width: 50,
    height: 50,
    backgroundColor: "white",
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  activeControlButton: {
    backgroundColor: "#4285F4",
  },
  debugInfoContainer: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: 5,
    padding: 5,
  },
  debugText: {
    color: "white",
    fontSize: 10,
  },
});
