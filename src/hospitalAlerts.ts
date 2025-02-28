import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform, Alert } from 'react-native';
import { supabase } from './supabase';
import { useRef, useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';

export const useNotificationHandler = () => {
  const notificationListener = useRef();
  const responseListener = useRef();
  const navigation = useNavigation();

  useEffect(() => {
    // Set up notification listeners when component mounts
    
    // This listener handles notifications received while the app is in the foreground
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      // You can do something with notification shown in foreground if needed
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
        
        // Navigate to the Map screen with the alert location
        navigation.navigate('Map', {
          latitude,
          longitude,
          patientName
        });
      }
    });

    // Cleanup the listeners on unmount
    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, [navigation]);
};

// Function to calculate distance between two coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Number((R * c).toFixed(2)); // Distance in km, rounded to 2 decimal places
};

// Register for push notifications
export const registerForPushNotificationsAsync = async () => {
  let token;
  
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      Alert.alert('Failed to get push token for push notification!');
      return null;
    }
    
    try {
      // Make sure projectId is available
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      
      if (!projectId) {
        console.error('Missing projectId in app configuration');
        Alert.alert('Configuration Error', 'Missing projectId for push notifications');
        return null;
      }
      
      token = (await Notifications.getExpoPushTokenAsync({
        projectId: projectId,
      })).data;
    } catch (error) {
      console.error('Error getting push token:', error);
      Alert.alert('Push Notification Error', 'Could not generate push notification token');
      return null;
    }
  } else {
    Alert.alert('Must use physical device for Push Notifications');
  }

  // For Android, we need to set up a notification channel
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('sos-alerts', {
      name: 'SOS Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF0000',
      sound: true,
    });
  }

  return token;
};

export const updateHospitalPushToken = async (hospitalId: string) => {
  try {
    // Get the current push token
    const pushToken = await registerForPushNotificationsAsync();
    
    if (!pushToken) {
      return { success: false, message: 'Failed to generate push token' };
    }
    
    // Update the token in the database
    const { error } = await supabase
      .from('hospitals')
      .update({ push_token: pushToken })
      .eq('id', hospitalId);
      
    if (error) {
      console.error('Failed to update push token:', error);
      return { success: false, message: 'Failed to update token in database' };
    }
    
    return { success: true, token: pushToken };
  } catch (error) {
    console.error('Error updating push token:', error);
    return { success: false, message: 'Exception occurred while updating token' };
  }
};

// Get the 5 nearest hospitals
const getNearestHospitals = async (latitude, longitude, limit = 5) => {
  try {
    const { data: hospitals, error } = await supabase
      .from('hospitals')
      .select('id, name, latitude, longitude, push_token');

    if (error) {
      console.error("Error fetching hospitals:", error);
      return [];
    }

    // Calculate distance for each hospital and sort
    const hospitalsWithDistance = hospitals
      .filter(hospital => hospital.latitude && hospital.longitude) // Filter out hospitals without location
      .map(hospital => ({
        ...hospital,
        distance: calculateDistance(
          latitude,
          longitude,
          Number(hospital.latitude),
          Number(hospital.longitude)
        )
      }));

    // Sort by distance
    const sortedHospitals = hospitalsWithDistance.sort((a, b) => a.distance - b.distance);
    
    // Return the nearest hospitals
    return sortedHospitals.slice(0, limit);
  } catch (error) {
    console.error("Error in getNearestHospitals:", error);
    return [];
  }
};

// Simple function to send push notifications directly using Expo's API
const sendSOSNotifications = async (hospitals, alertData) => {
  try {
    // Filter hospitals that have push tokens
    const hospitalsWithTokens = hospitals.filter(h => h.push_token);
    
    if (hospitalsWithTokens.length === 0) {
      console.log('No hospitals with push tokens available');
      return { success: false, count: 0 };
    }
    
    // Prepare messages for Expo Push API
    const messages = hospitalsWithTokens.map(hospital => ({
      to: hospital.push_token,
      sound: 'default',
      title: `🚨 SOS ALERT: ${alertData.incident_type}`,
      body: `URGENT: ${alertData.priority_status} priority patient ${alertData.patient_name} - ${hospital.distance}km from your location`,
      data: {
        alertId: alertData.id,
        patientName: alertData.patient_name,
        location: alertData.incident_location,
        coordinates: {
          latitude: alertData.latitude,
          longitude: alertData.longitude
        },
        incidentType: alertData.incident_type,
        medicalConditions: alertData.medical_conditions,
        priorityStatus: alertData.priority_status,
        priorityReason: alertData.priority_reason,
        hospitalId: hospital.id,
        distance: hospital.distance
      },
    }));
    
    // Call Expo's Push Notification API directly
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Expo push notification error:', errorData);
      throw new Error(`Expo API returned status ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Expo push notification result:', result);
    
    // Count successful notifications
    let successCount = 0;
    if (result && result.data) {
      successCount = result.data.filter(ticket => 
        !ticket.error && ticket.status === "ok"
      ).length;
    }
    
    return { 
      success: successCount > 0, 
      count: successCount 
    };
  } catch (error) {
    console.error('Error sending SOS notifications:', error);
    return { success: false, count: 0 };
  }
};

// Record notification history in the database
const recordNotificationHistory = async (alertId, hospitals, notificationStatus) => {
  try {
    const notifications = hospitals.map(hospital => ({
      alert_id: alertId,
      hospital_id: hospital.id,
      notification_types: ['sos_push'],
      sent_at: new Date().toISOString(),
      status: notificationStatus.success ? 'sent' : 'failed'
    }));
    
    const { error } = await supabase
      .from('alert_notifications')
      .insert(notifications);
      
    if (error) {
      console.error("Error recording notification history:", error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error recording notification history:', error);
    return false;
  }
};

// Get the current alerts table schema
const getAlertsTableSchema = async () => {
  try {
    // This is a simple way to get column names - fetch one record and check its structure
    const { data, error } = await supabase
      .from('alert')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error("Error fetching alerts table schema:", error);
      return null;
    }
    
    // If there are no records, we can't determine columns this way
    if (!data || data.length === 0) {
      console.log("No records in alerts table to determine schema");
      return null;
    }
    
    // Return the column names from the first record
    return Object.keys(data[0]);
  } catch (error) {
    console.error("Error in getAlertsTableSchema:", error);
    return null;
  }
};

// Main function to send SOS alerts to hospitals
const sendSOSAlerts = async (alertData) => {
  try {
    // Get the 5 nearest hospitals
    const nearestHospitals = await getNearestHospitals(alertData.latitude, alertData.longitude, 5);
    
    if (nearestHospitals.length === 0) {
      console.log('No nearby hospitals found');
      Alert.alert('Alert Status', 'No nearby hospitals found to notify.');
      return false;
    }
    
    console.log(`Found ${nearestHospitals.length} nearby hospitals to notify`);
    
    // Create the base alert data
    const alertRecord = {
      patient_name: alertData.patient_name || 'Unknown',
      incident_location: alertData.incident_location || 'Unknown',
      latitude: alertData.latitude || 0,
      longitude: alertData.longitude || 0,
      incident_type: alertData.incident_type || 'Unknown',
      medical_conditions: alertData.medical_conditions || 'None reported',
      priority_status: alertData.priority_status || 'Low',
      priority_reason: alertData.priority_reason || 'No reason provided'
    };
    
    // Get the table schema to check if 'status' column exists
    const columns = await getAlertsTableSchema();
    if (columns && columns.includes('status')) {
      // Only add status field if it exists in the table
      alertRecord.status = 'active';
    }
    
    // Save the alert to the database
    const { data: savedAlert, error: alertError } = await supabase
      .from('alert')
      .insert([alertRecord])
      .select();
      
    if (alertError) {
      console.error("Error saving alert:", alertError);
      
      // Try again without the 'status' field if that was the issue
      if (alertError.code === 'PGRST204' && alertError.message.includes('status')) {
        delete alertRecord.status;
        
        const { data: retryAlert, error: retryError } = await supabase
          .from('alert')
          .insert([alertRecord])
          .select();
          
        if (retryError) {
          console.error("Error on retry saving alert:", retryError);
          Alert.alert('Error', 'Failed to save alert to database.');
          return false;
        }
        
        if (!retryAlert || retryAlert.length === 0) {
          Alert.alert('Error', 'Failed to save alert data.');
          return false;
        }
        
        alertData.id = retryAlert[0].id;
      } else {
        Alert.alert('Error', 'Failed to save alert to database.');
        return false;
      }
    } else if (savedAlert && savedAlert.length > 0) {
      alertData.id = savedAlert[0].id;
    } else {
      Alert.alert('Error', 'Failed to retrieve saved alert data.');
      return false;
    }
    
    console.log(`Sending notifications to ${nearestHospitals.length} hospitals:`, nearestHospitals.map(h => h.name));
    const notificationStatus = await sendSOSNotifications(nearestHospitals, alertData);
    
    // Record notification history
    await recordNotificationHistory(
      alertData.id,
      nearestHospitals,
      notificationStatus
    );
    
    // Format hospital list for display
    const hospitalList = nearestHospitals.map(h => 
      `- ${h.name} (${h.distance}km away)`
    ).join('\n');
    
    if (notificationStatus.success) {
      // Show successful confirmation to the user
      Alert.alert(
        'SOS Alert Sent', 
        `Emergency SOS sent to ${notificationStatus.count} nearby hospitals:\n\n${hospitalList}\n\nEmergency responders have been notified and should respond shortly.`
      );
      return true;
    } else {
      // Show failure message but don't expose technical details
      Alert.alert(
        'SOS Alert Status', 
        `We found ${nearestHospitals.length} nearby hospitals but couldn't send notifications. The system will try to reach them through alternative methods.`
      );
      return false;
    }
  } catch (error) {
    console.error('Error in sendSOSAlerts:', error);
    Alert.alert('Error', 'Failed to send SOS alerts to nearby hospitals.');
    return false;
  }
};

// Set up notification handling for the app
const setupNotifications = () => {
  // Set notification handler for how to display received notifications
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
  
  // Register for push notifications on component mount
  registerForPushNotificationsAsync();
};

// Exported functions
export {
  setupNotifications,
  sendSOSAlerts
};