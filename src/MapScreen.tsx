import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Dimensions, Text } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';

const MapScreen = () => {
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const route = useRoute();
  const navigation = useNavigation();
  const mapRef = useRef(null);
  
  // Extract parameters if they exist
  const params = route.params || {};
  const alertLatitude = params.latitude;
  const alertLongitude = params.longitude;
  const patientName = params.patientName;
  
  // Check if we're displaying an alert location
  const isAlertView = alertLatitude && alertLongitude;

  // Reset hasCentered when parameters change
  const paramsKey = JSON.stringify(params);
  const hasCentered = useRef(false);

  // Create alert location object
  const alertLocation = isAlertView ? {
    coords: {
      latitude: Number(alertLatitude),
      longitude: Number(alertLongitude)
    }
  } : null;

  // State for displayed location
  const [displayLocation, setDisplayLocation] = useState(null);

  // Effect for parameter changes
  useEffect(() => {
    if (
      isAlertView &&
      (alertLatitude !== displayLocation?.coords.latitude ||
        alertLongitude !== displayLocation?.coords.longitude ||
        patientName !== navigation.getState().routes.at(-1)?.params?.patientName)
    ) {
      hasCentered.current = false; // Reset centering state only when necessary
      setDisplayLocation(alertLocation);
  
      if (patientName) {
        navigation.setOptions({ title: `Location: ${patientName}` });
      }
    }
  }, [alertLatitude, alertLongitude, patientName]);
  

  // Separate effect for getting current location
  useEffect(() => {
    // Only get current location if not viewing an alert
    if (!isAlertView) {
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
          latitudeDelta: 0.01,
          longitudeDelta: 0.01
        }, 500);
      }, 100);
    }
  };

  // Reset and recenter when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      // Reset centered state to force recentering
      hasCentered.current = false;
      
      // Force map to reposition if it exists
      if (mapRef.current && displayLocation) {
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
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
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