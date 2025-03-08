import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

interface Hospital {
  id: string;
  name: string;
  email: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface AlertNotification {
  id: string;
  alert_id: string;
  hospital_id: string;
  notification_types: string[];
  sent_at: string;
  status: string;
  received_confirmation_at: string | null;
  response_time_minutes: number | null;
}

interface EmergencyAlert {
  id: string;
  patient_name: string;
  incident_location: string | null;
  latitude: number;
  longitude: number;
  incident_type: string;
  medical_conditions: string | null;
  priority_status: string;
  priority_reason: string | null;
  created_at: string;
  resolved_at: string | null;
  status: string;
  notification_id: string; // Storing the notification ID for later use
}

const HospitalDashboard = () => {
  const navigation = useNavigation();
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadHospitalProfile();
    loadEmergencyAlerts();

    // Set up real-time subscription for new alert notifications
    const setupRealTimeNotifications = async () => {
      if (!hospital?.id) return;

      const subscription = supabase
        .channel('alert_notifications_changes')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'alert_notifications',
          filter: `hospital_id=eq.${hospital.id}`,
        }, async (payload) => {
          // Fetch the alert details for the new notification
          const newNotification = payload.new as AlertNotification;
          const alertDetails = await fetchAlertDetails(newNotification.alert_id);
          
          if (alertDetails) {
            // Add the combined data to our alerts state
            const newAlert: EmergencyAlert = {
              ...alertDetails,
              notification_id: newNotification.id
            };
            
            setAlerts(prevAlerts => [newAlert, ...prevAlerts]);
            Alert.alert('New Emergency Alert', `New emergency alert from ${newAlert.patient_name}`);
          }
        })
        .subscribe();

      return () => {
        subscription.unsubscribe();
      };
    };

    if (hospital?.id) {
      const unsubscribe = setupRealTimeNotifications();
      return () => {
        unsubscribe.then(cleanup => cleanup && cleanup());
      };
    }

    // Set up the logout button in the header
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={24} color="white" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, hospital?.id]);

  const fetchAlertDetails = async (alertId: string): Promise<EmergencyAlert | null> => {
    try {
      const { data, error } = await supabase
        .from('alert')
        .select('*')
        .eq('id', alertId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error fetching alert details:', error);
      return null;
    }
  };

  const handleLogout = async () => {
    Alert.alert(
      "Confirm Logout",
      "Are you sure you want to logout?",
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "Logout",
          onPress: async () => {
            try {
              // Sign out from Supabase auth
              await supabase.auth.signOut();
              
              // Clear the stored user profile
              await AsyncStorage.removeItem('userProfile');
              
              // Navigate back to the Auth screen
              navigation.reset({
                index: 0,
                routes: [{ name: 'Auth' }],
              });
            } catch (error) {
              console.error('Error during logout:', error);
              Alert.alert('Error', 'Failed to logout. Please try again.');
            }
          }
        }
      ]
    );
  };

  const loadHospitalProfile = async () => {
    try {
      const profileJson = await AsyncStorage.getItem('userProfile');
      if (profileJson) {
        const profile = JSON.parse(profileJson);
        if (profile.accountType === 'hospital') {
          setHospital(profile);
        }
      }
    } catch (error) {
      console.error('Error loading hospital profile:', error);
    }
  };

  const loadEmergencyAlerts = async () => {
    if (!hospital?.id) return;
    
    setRefreshing(true);
    try {
      // First get all notifications for this hospital
      const { data: notificationsData, error: notificationsError } = await supabase
        .from('alert_notifications')
        .select('*')
        .eq('hospital_id', hospital.id)
        .order('sent_at', { ascending: false });

      if (notificationsError) throw notificationsError;

      if (notificationsData?.length) {
        // Get all alert IDs from notifications
        const alertIds = notificationsData.map(notification => notification.alert_id);
        
        // Fetch the details for all these alerts
        const { data: alertsData, error: alertsError } = await supabase
          .from('alert')
          .select('*')
          .in('id', alertIds);

        if (alertsError) throw alertsError;

        if (alertsData) {
          // Combine notification data with alert data
          const combinedAlerts = alertsData.map(alert => {
            const notification = notificationsData.find(
              notification => notification.alert_id === alert.id
            );
            return {
              ...alert,
              notification_id: notification?.id
            };
          });

          setAlerts(combinedAlerts);
        }
      } else {
        setAlerts([]);
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
      Alert.alert('Error', 'Failed to load emergency alerts');
    } finally {
      setRefreshing(false);
    }
  };

  const updateAlertStatus = async (alertId: string, newStatus: string) => {
    try {
      // Find the current alert from our state to get its coordinates
      const currentAlert = alerts.find(alert => alert.id === alertId);
      if (!currentAlert) {
        throw new Error('Alert not found');
      }
      
      // Update the alert status with hospitalid when status changes to 'responding'
      const updateData = {
        status: newStatus,
        ...(newStatus === 'resolved' ? { resolved_at: new Date().toISOString() } : {}),
        ...(newStatus === 'responding' ? { hospitalid: hospital?.id } : {})
      };
  
      const { error } = await supabase
        .from('alert')
        .update(updateData)
        .eq('id', alertId);
  
      if (error) throw error;
  
      // If this is a "responding" status, update the notification as well
      if (newStatus === 'responding') {
        const notification = alerts.find(alert => alert.id === alertId)?.notification_id;
        
        if (notification) {
          const now = new Date();
          const { error: notificationError } = await supabase
            .from('alert_notifications')
            .update({ 
              status: 'received',
              received_confirmation_at: now.toISOString(),
              // Calculate response time in minutes
              response_time_minutes: Math.floor(
                (now.getTime() - new Date(currentAlert.created_at || 0).getTime()) / 60000
              )
            })
            .eq('id', notification);
            
          if (notificationError) throw notificationError;
        }
        
        // Call MapDirections component with the incident coordinates when responding
        navigation.navigate('MapDirections', {
          destinationLatitude: currentAlert.latitude,
          destinationLongitude: currentAlert.longitude
        });
      }
  
      // Update the local state
      setAlerts(prevAlerts => 
        prevAlerts.map(alert => 
          alert.id === alertId ? { ...alert, status: newStatus, ...(newStatus === 'responding' ? { hospitalid: hospital?.id } : {}) } : alert
        )
      );
  
      Alert.alert('Status Updated', `Alert marked as ${newStatus}`);
    } catch (error) {
      console.error('Error updating alert status:', error);
      Alert.alert('Error', 'Failed to update alert status');
    }
  };

  const renderAlertItem = ({ item }: { item: EmergencyAlert }) => {
    const date = new Date(item.created_at);
    const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    
    return (
      <View style={styles.alertItem}>
        <View style={styles.alertHeader}>
          <Text style={styles.alertTitle}>Emergency: {item.patient_name}</Text>
          <View style={[
            styles.statusBadge, 
            item.status === 'active' ? styles.newStatus : 
            item.status === 'responding' ? styles.respondingStatus : 
            styles.resolvedStatus
          ]}>
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        </View>
        
        <Text style={styles.alertInfo}>Time: {formattedDate}</Text>
        <Text style={styles.alertInfo}>Type: {item.incident_type}</Text>
        <Text style={styles.alertInfo}>Priority: {item.priority_status}</Text>
        
        {item.medical_conditions && (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptTitle}>Medical Conditions:</Text>
            <Text style={styles.transcript}>{item.medical_conditions}</Text>
          </View>
        )}
        
        {item.priority_reason && (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptTitle}>Priority Reason:</Text>
            <Text style={styles.transcript}>{item.priority_reason}</Text>
          </View>
        )}
        
        <View style={styles.actionButtons}>
          {item.status === 'active' && (
            <TouchableOpacity 
              style={[styles.actionButton, styles.respondButton]}
              onPress={() => updateAlertStatus(item.id, 'responding')}
            >
              <Ionicons name="medical" size={16} color="white" />
              <Text style={styles.buttonText}>Respond</Text>
            </TouchableOpacity>
          )}
          
          {(item.status === 'active' || item.status === 'responding') && (
            <TouchableOpacity 
              style={[styles.actionButton, styles.resolveButton]}
              onPress={() => updateAlertStatus(item.id, 'resolved')}
            >
              <Ionicons name="checkmark-circle" size={16} color="white" />
              <Text style={styles.buttonText}>Resolve</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity 
            style={[styles.actionButton, styles.mapButton]}
            onPress={() => {
                // Navigate to the Map tab with the actual alert location parameters
                navigation.navigate('Map', {
                latitude: item.latitude,
                longitude: item.longitude,
                patientName: item.patient_name || "Unknown"
                });
            }}
            >
            <Ionicons name="location" size={16} color="white" />
            <Text style={styles.buttonText}>View Location</Text>
            </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderHospitalProfile = () => {
    if (!hospital) return null;
    
    return (
      <View style={styles.profileContainer}>
        <Text style={styles.profileTitle}>Hospital Profile</Text>
        <View style={styles.profileDetails}>
          <Text style={styles.profileName}>{hospital.name}</Text>
          <Text style={styles.profileInfo}>Email: {hospital.email}</Text>
          <Text style={styles.profileInfo}>Address: {hospital.address}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Emergency Alerts Dashboard</Text>
      
      {renderHospitalProfile()}
      
      <View style={styles.alertsContainer}>
        <Text style={styles.sectionTitle}>Recent Alerts</Text>
        
        {alerts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle" size={48} color="#28A745" />
            <Text style={styles.emptyText}>No emergency alerts at this time</Text>
          </View>
        ) : (
          <FlatList
            data={alerts}
            renderItem={renderAlertItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.alertsList}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={loadEmergencyAlerts}
                colors={["#FF3B30"]}
              />
            }
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 16,
  },
  logoutButton: {
    marginRight: 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
    color: '#333',
  },
  profileContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  profileTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  profileDetails: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
  },
  profileName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  profileInfo: {
    fontSize: 14,
    marginBottom: 4,
    color: '#555',
  },
  alertsContainer: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  alertsList: {
    paddingBottom: 16,
  },
  alertItem: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  newStatus: {
    backgroundColor: '#DC3545',
  },
  respondingStatus: {
    backgroundColor: '#FFC107',
  },
  resolvedStatus: {
    backgroundColor: '#28A745',
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  alertInfo: {
    fontSize: 14,
    marginBottom: 4,
    color: '#666',
  },
  transcriptBox: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  transcriptTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
  },
  transcript: {
    fontSize: 14,
    color: '#666',
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 12,
    justifyContent: 'space-between',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    flex: 1,
    marginHorizontal: 4,
  },
  respondButton: {
    backgroundColor: '#FFC107',
  },
  resolveButton: {
    backgroundColor: '#28A745',
  },
  mapButton: {
    backgroundColor: '#007BFF',
  },
  buttonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});

export default HospitalDashboard;