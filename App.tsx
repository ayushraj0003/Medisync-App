import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import SOSAudioRecorder from './src/Transcript';
import MapScreen from './src/MapScreen';
import AuthScreen from './src/auth';
import { setupNotifications } from './src/hospitalAlerts';
import { StatusBar } from 'react-native';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Create a TabNavigator component for bottom tabs
const TabNavigator = () => {
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
            name="MainTabs" 
            component={TabNavigator} 
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
};

export default App;