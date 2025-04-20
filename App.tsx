import React, { useEffect, useRef } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { View, Text, StatusBar, TouchableOpacity } from "react-native";

// Import components
import SOSAudioRecorder from "./src/Transcript";
import MapDirections from "./src/MapDirections";
import PatientMap from "./src/PatientMap";
import HospitalDashboard from "./src/HospitalDashboard";
import AuthScreen from "./src/auth";
import UserDashboard from "./src/UserDashboard";
import { setupNotifications } from "./src/hospitalAlerts";
import { supabase } from "./src/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native"; 



// Create navigators
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Create a TabNavigator component for user bottom tabs
const UserTabNavigator = () => {
  const navigation = useNavigation();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === "EmergencyAlert")
            iconName = focused ? "warning" : "warning-outline";
          else if (route.name === "Map")
            iconName = focused ? "map" : "map-outline";
          else if (route.name === "UserDashboard")
            iconName = focused ? "person" : "person-outline";
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#FF3B30",
        tabBarInactiveTintColor: "gray",
        headerShown: true,
        headerStyle: { backgroundColor: "#FF3B30" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      })}
    >
      <Tab.Screen
        name="EmergencyAlert"
        component={SOSAudioRecorder}
        options={{
          title: "Emergency Alert",
          headerRight: () => (
            <TouchableOpacity
              style={{ marginRight: 15 }}
              onPress={async () => {
                try {
                  await supabase.auth.signOut();
                  await AsyncStorage.removeItem("userProfile");

            navigation.reset({
              index: 0,
              routes: [{ name: "Auth" }],
            });
                } catch (error) {
                  console.error("Logout error:", error);
                }
              }}
            >
              <Ionicons name="log-out-outline" size={24} color="white" />
            </TouchableOpacity>
          ),
        }}
      />
      <Tab.Screen
        name="Map"
        component={EmptyMapScreen}
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

// Simple component for when no alert is active
const EmptyMapScreen = ({ route }) => {
  if (route.params?.alertId) {
    return <PatientMap alertId={route.params.alertId} />;
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Ionicons name="location-outline" size={64} color="#ccc" />
      <Text style={{ fontSize: 18, marginTop: 20, fontWeight: "bold" }}>
        No Active Tracking
      </Text>
      <Text
        style={{
          marginTop: 8,
          textAlign: "center",
          paddingHorizontal: 40,
          color: "#666",
        }}
      >
        Start an emergency alert to track ambulance.
      </Text>
    </View>
  );
};

// Create a TabNavigator component for hospital bottom tabs
const HospitalTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName =
            route.name === "Dashboard"
              ? focused
                ? "medical"
                : "medical-outline"
              : focused
              ? "map"
              : "map-outline";
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#FF3B30",
        tabBarInactiveTintColor: "gray",
        headerShown: true,
        headerStyle: { backgroundColor: "#FF3B30" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      })}
    >
      <Tab.Screen name="Dashboard" component={HospitalDashboard} />
      <Tab.Screen
        name="HospitalMap"
        component={MapDirections}
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

        // Handle hospital notifications
        if (data?.coordinates && navigationRef.current) {
          const { latitude, longitude } = data.coordinates;
          const alertId = data.alertId;

          // Navigate to hospital map with parameters
          navigationRef.current.navigate("HospitalTabs", {
            screen: "HospitalMap",
            params: {
              destinationLatitude: latitude,
              destinationLongitude: longitude,
              alertId: alertId,
              status: data.status || "responding",
            },
          });
        }

        // Handle patient notifications (for tracking ambulance)
        if (data?.alertId && !data.coordinates && navigationRef.current) {
          // Navigate to patient map with alertId
          navigationRef.current.navigate("UserTabs", {
            screen: "Map",
            params: {
              alertId: data.alertId,
            },
          });
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
