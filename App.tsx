import React, { useEffect, useState, useRef } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import SOSAudioRecorder from "./src/Transcript";
import MapDirections from "./src/MapDirections";
import PatientMap from "./src/PatientMap";
import HospitalDashboard from "./src/HospitalDashboard";
import AuthScreen from "./src/auth";
import { setupNotifications } from "./src/hospitalAlerts";
import { View, Text, StatusBar } from "react-native";
import UserDashboard from "./src/UserDashboard";
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Create a TabNavigator component for user bottom tabs
const UserTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === "SOS") {
            iconName = focused ? "warning" : "warning-outline";
          } else if (route.name === "Map") {
            iconName = focused ? "map" : "map-outline";
          } else if (route.name === "UserDashboard") {
            iconName = focused ? "person" : "person-outline";
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#FF3B30",
        tabBarInactiveTintColor: "gray",
        headerShown: true,
        headerStyle: {
          backgroundColor: "#FF3B30",
        },
        headerTintColor: "#fff",
        headerTitleStyle: {
          fontWeight: "bold",
        },
      })}
    >
      <Tab.Screen name="SOS" component={SOSAudioRecorder} />
      <Tab.Screen
        name="Map"
        component={PatientMapWrapper}
        options={{ title: "Track Ambulance" }}
      />
      <Tab.Screen
        name="UserDashboard"
        component={UserDashboard}
        options={{ title: "Profile" }}
      />
    </Tab.Navigator>
  );
};

// Create a wrapper for PatientMap to handle alertId
// Create a wrapper for PatientMap to handle alertId
const PatientMapWrapper = ({ route }) => {
  // Check if alertId is available in route params
  if (!route.params?.alertId) {
    // Return a component that shows no active alerts
    console.log("Patient alertId found in route params:", route.params);
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text>No active ambulance tracking available.</Text>
        <Text>Start an emergency alert to track ambulance.</Text>
      </View>
    );
  }

  // If alertId is available, render the PatientMap
  return <PatientMap alertId={route.params.alertId} />;
};

// Create a wrapper component for MapDirections to handle default coordinates
// In your MapDirectionsWrapper component:

const MapDirectionsWrapper = ({ route }) => {
  console.log("MapDirectionsWrapper route params:", route?.params);

  // Default coordinates
  const defaultLatitude = 10.0459501;
  const defaultLongitude = 76.3291872;

  // Use coordinates from route params if available
  const destinationLatitude =
    route?.params?.destinationLatitude || defaultLatitude;
  const destinationLongitude =
    route?.params?.destinationLongitude || defaultLongitude;

  // Explicitly extract alertId
  const alertId = route?.params?.alertId;

  console.log("Passing to MapDirections:", {
    destinationLatitude,
    destinationLongitude,
    alertId,
  });

  return (
    <MapDirections
      destinationLatitude={destinationLatitude}
      destinationLongitude={destinationLongitude}
      alertId={alertId}
    />
  );
};

// Create a TabNavigator component for hospital bottom tabs
const HospitalTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === "Dashboard") {
            iconName = focused ? "medical" : "medical-outline";
          } else if (route.name === "Map") {
            iconName = focused ? "map" : "map-outline";
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#FF3B30",
        tabBarInactiveTintColor: "gray",
        headerShown: true,
        headerStyle: {
          backgroundColor: "#FF3B30",
        },
        headerTintColor: "#fff",
        headerTitleStyle: {
          fontWeight: "bold",
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={HospitalDashboard} />
      <Tab.Screen
        name="HospitalMap"
        component={MapDirectionsWrapper}
        options={{ title: "Emergency Map" }}
      />
    </Tab.Navigator>
  );
};

const App = () => {
  // Reference to navigation
  const navigationRef = useRef(null);
  const notificationListener = useRef();
  const responseListener = useRef();

  // Initialize notifications when the app starts
  useEffect(() => {
    // Set up push notifications for hospitals
    setupNotifications();
    console.log("Notifications system initialized");

    // This listener handles notifications received while the app is in the foreground
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log("Notification received in foreground:", notification);
      });

    // This listener handles the user tapping on a notification
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        // Get the data from the notification
        const data = response.notification.request.content.data;

        console.log("Notification tapped, data:", data);

        // Check if the notification contains location data
        if (data && data.coordinates) {
          const { latitude, longitude } = data.coordinates;
          const patientName = data.patientName || "Unknown";
          const alertId = data.alertId; // Make sure this is captured

          // Use the navigationRef to navigate
          if (navigationRef.current) {
            // Navigate to HospitalTabs first
            navigationRef.current.navigate("HospitalTabs");

            // Then navigate to the Map screen with parameters
            setTimeout(() => {
              navigationRef.current.navigate("HospitalTabs", {
                screen: "Map",
                params: {
                  destinationLatitude: latitude,
                  destinationLongitude: longitude,
                  patientName,
                  alertId: alertId, // Make sure to pass alertId correctly
                },
              });
            }, 100);
          }
        }

        // Handle patient notifications (for tracking ambulance)
        if (data && data.alertId) {
          const alertId = data.alertId;

          if (navigationRef.current) {
            // Navigate to user tabs first
            navigationRef.current.navigate("UserTabs");

            // Then navigate to the Map tab with alertId
            setTimeout(() => {
              navigationRef.current.navigate("UserTabs", {
                screen: "Map",
                params: {
                  alertId: alertId, // Make sure to use alertId here
                },
              });
            }, 100);
          }
        }
      });

    // Cleanup the listeners on unmount
    return () => {
      Notifications.removeNotificationSubscription(
        notificationListener.current
      );
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor="#FF3B30" />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName="Auth">
          <Stack.Screen
            name="Auth"
            component={AuthScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="UserTabs"
            component={UserTabNavigator}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="HospitalTabs"
            component={HospitalTabNavigator}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
};

export default App;
