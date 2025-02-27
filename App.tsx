import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import SOSAudioRecorder from './src/Transcript';
import MapScreen from './src/MapScreen';
import HospitalDashboard from './src/HospitalDashboard';
import AuthScreen from './src/auth';
import { setupNotifications } from './src/hospitalAlerts';
import { StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    </Tab.Navigator>
  );
};

// Create a TabNavigator component for hospital bottom tabs
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
        // Set headerShown to true to show the header
        headerShown: true,
        // Default header styles that can be overridden by individual screens
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
        options={({ navigation }) => ({
          title: 'Emergency Alerts',
          // The individual screen will now control its own headerRight
        })}
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
  // Initialize notifications when the app starts
  useEffect(() => {
    // Set up push notifications for hospitals
    setupNotifications();
    console.log('Notifications system initialized');
  }, []);

  return (
    <>
      <StatusBar
        barStyle="light-content"
        backgroundColor="#FF3B30"
      />
      <NavigationContainer>
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