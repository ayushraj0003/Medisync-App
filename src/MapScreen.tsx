import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Dimensions, Text, Alert } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';

const MapScreen = () => {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const route = useRoute();
  const navigation = useNavigation();
  const mapRef = useRef(null);
  
  // Log incoming route params for debugging
  useEffect(() => {
    console.log('MapScreen received params:', JSON.stringify(route.params));
  }, [route.params]);
  
  // Extract parameters if they exist
  const params = route.params || {};
  const alertLatitude = params.latitude !== undefined ? Number(params.latitude) : null;
  const alertLongitude = params.longitude !== undefined ? Number(params.longitude) : null;
  const patientName = params.patientName;
  
  // Check if we're displaying an alert location - ensure we have valid numbers
  const isAlertView = alertLatitude !== null && 
                      alertLongitude !== null && 
                      !isNaN(alertLatitude) && 
                      !isNaN(alertLongitude);

  // Reset hasCentered when parameters change
  const paramsKey = JSON.stringify(params);
  const hasCentered = useRef(false);

  // Create alert location object
  const alertLocation = isAlertView ? {
    coords: {
      latitude: alertLatitude,
      longitude: alertLongitude
    }
  } : null;

  // State for displayed location
  const [displayLocation, setDisplayLocation] = useState(null);

  // Effect for parameter changes
  useEffect(() => {
    console.log('Parameter effect triggered:', isAlertView ? 'Alert View' : 'Normal View');
    
    if (isAlertView) {
      console.log(`Alert location: ${alertLatitude}, ${alertLongitude}`);
      
      // Update display location
      setDisplayLocation(alertLocation);
      hasCentered.current = false;
      
      // Update title
      if (patientName) {
        navigation.setOptions({ title: `Location: ${patientName}` });
      }
      
      // For debugging - show an alert to confirm we received coordinates
      // You can remove this in production
      console.log(`Setting map to alert location for: ${patientName || 'Unknown'}`);
    }
  }, [alertLatitude, alertLongitude, patientName, isAlertView]);

  // Separate effect for getting current location
  useEffect(() => {
    // Only get current location if not viewing an alert
    if (!isAlertView) {
      console.log('Getting current location');
      (async () => {
        try {
          let { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') {
            setErrorMsg('Permission to access location was denied');
            return;
          }

          let currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          console.log('Current location:', currentLocation);
          setLocation(currentLocation);
          setDisplayLocation(currentLocation);
        } catch (error) {
          console.error('Error getting location:', error);
          setErrorMsg('Failed to get location');
        }
      })();
    }
  }, [isAlertView]);

  // When the map is ready, make sure it's centered on the marker
  const handleMapReady = () => {
    if (displayLocation && mapRef.current && !hasCentered.current) {
      console.log("Centering map on location", 
        isAlertView ? "alert" : "current", 
        displayLocation.coords.latitude, 
        displayLocation.coords.longitude);
      
      // Mark that we've centered the map
      hasCentered.current = true;
      
      // Use timeout to ensure map is ready
      setTimeout(() => {
        mapRef.current.animateToRegion({
          latitude: displayLocation.coords.latitude,
          longitude: displayLocation.coords.longitude,
          latitudeDelta: 0.005,  // Zoom in closer for alerts
          longitudeDelta: 0.005
        }, 500);
      }, 200);  // Increased timeout for reliability
    }
  };

  // Reset and recenter when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      console.log('Map screen focused');
      // Reset centered state to force recentering
      hasCentered.current = false;
      
      // Force map to reposition if it exists
      if (mapRef.current && displayLocation) {
        console.log('Forcing map center on focus');
        handleMapReady();
      }
      
      return () => {
        // Clean up when screen loses focus if needed
      };
    }, [displayLocation])
  );

  return (
    <View style={styles.container}>
      {errorMsg ? (
        <Text style={styles.errorText}>{errorMsg}</Text>
      ) : !displayLocation ? (
        <Text style={styles.loadingText}>Loading map...</Text>
      ) : (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: displayLocation.coords.latitude,
            longitude: displayLocation.coords.longitude,
            latitudeDelta: isAlertView ? 0.005 : 0.01,
            longitudeDelta: isAlertView ? 0.005 : 0.01,
          }}
          onMapReady={handleMapReady}
          onLayout={handleMapReady} // Also try to center when layout is done
          showsUserLocation={!isAlertView}
          showsMyLocationButton={true}
          key={`map-${displayLocation.coords.latitude}-${displayLocation.coords.longitude}`} // Force remount when location changes
        >
          <Marker
            coordinate={{
              latitude: displayLocation.coords.latitude,
              longitude: displayLocation.coords.longitude,
            }}
            title={isAlertView ? `Alert: ${patientName || 'Unknown'}` : "Your Location"}
            description={isAlertView 
              ? "Emergency Alert Location" 
              : `Lat: ${displayLocation.coords.latitude.toFixed(4)}, Long: ${displayLocation.coords.longitude.toFixed(4)}`
            }
            pinColor={isAlertView ? "red" : "blue"}
          />
        </MapView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  errorText: {
    fontSize: 16,
    color: 'red',
    textAlign: 'center',
    margin: 20,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    margin: 20,
  },
});

export default MapScreen;