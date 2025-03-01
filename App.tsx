import React, { useEffect, useState, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import SOSAudioRecorder from './src/Transcript';
import MapScreen from './src/MapScreen';
import HospitalDashboard from './src/HospitalDashboard';
import AuthScreen from './src/auth';
import { setupNotifications } from './src/hospitalAlerts';
import { StatusBar } from 'react-native';
import UserDashboard from './src/UserDashboard';
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Create a TabNavigator component for user bottom tabs
const UserTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'SOS') {
            iconName = focused ? 'warning' : 'warning-outline';
          } else if (route.name === 'Map') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'UserDashboard') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#FF3B30',
        tabBarInactiveTintColor: 'gray',
        headerShown: true,
        headerStyle: {
          backgroundColor: '#FF3B30',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}
    >
      <Tab.Screen 
        name="SOS" 
        component={SOSAudioRecorder}
        options={{
          title: 'Emergency SOS',
        }}
      />
      <Tab.Screen 
        name="Map" 
        component={MapScreen}
        options={{
          title: 'Location',
        }}
      />
      <Tab.Screen 
        name="UserDashboard" 
        component={UserDashboard}
        options={{
          title: 'Dashboard',
        }}
      />
    </Tab.Navigator>
  );
};
// Create a TabNavigator component for hospital bottom tabs
const HospitalTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'Dashboard') {
            iconName = focused ? 'medical' : 'medical-outline';
          } else if (route.name === 'Map') {
            iconName = focused ? 'map' : 'map-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#FF3B30',
        tabBarInactiveTintColor: 'gray',
        headerShown: true,
        headerStyle: {
          backgroundColor: '#FF3B30',
        },
        headerTintColor: '#fff',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      })}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={HospitalDashboard}
        options={{
          title: 'Emergency Alerts',
        }}
      />
      <Tab.Screen 
        name="Map" 
        component={MapScreen}
        options={{
          title: 'Location Map',
        }}
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
    console.log('Notifications system initialized');

    // This listener handles notifications received while the app is in the foreground
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received in foreground:', notification);
    });

    // This listener handles the user tapping on a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      // Get the data from the notification
      const data = response.notification.request.content.data;
      
      console.log('Notification tapped, data:', data);
      
      // Check if the notification contains location data
      if (data && data.coordinates) {
        const { latitude, longitude } = data.coordinates;
        const patientName = data.patientName || 'Unknown';
        
        // Use the navigationRef to navigate regardless of which stack we're in
        if (navigationRef.current) {
          // First navigate to the HospitalTabs
          navigationRef.current.navigate('HospitalTabs');
          
          // Then navigate to the Map screen with the alert location
          // We use a small timeout to ensure the HospitalTabs is fully loaded
          setTimeout(() => {
            navigationRef.current.navigate('HospitalTabs', {
              screen: 'Map',
              params: {
                latitude,
                longitude,
                patientName
              }
            });
          }, 100);
        }
      }
    });

    // Cleanup the listeners on unmount
    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  return (
    <>
      <StatusBar
        barStyle="light-content"
        backgroundColor="#FF3B30"
      />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen 
            name="Auth" 
            component={AuthScreen} 
            options={{ title: 'Authentication' }} 
          />
          <Stack.Screen 
            name="UserTabs" 
            component={UserTabNavigator} 
          />
          <Stack.Screen 
            name="HospitalTabs" 
            component={HospitalTabNavigator} 
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
};

export default App;