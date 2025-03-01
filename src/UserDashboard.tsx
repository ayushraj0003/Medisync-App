import React, { useState, useEffect } from 'react';
import { Text, View, StyleSheet, FlatList, TouchableOpacity, Alert, RefreshControl, ActivityIndicator } from 'react-native';
import { supabase } from './supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';

interface Hospital {
  id: string;
  name: string;
  email: string;
  address: string;
  latitude: number;
  longitude: number;
  distance?: number; // For sorting by distance
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
  userid: string | null;
  hospitalid: string | null;
}

const UserDashboard = () => {
  const navigation = useNavigation();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [nearbyHospitals, setNearbyHospitals] = useState<Hospital[]>([]);
  const [respondingHospital, setRespondingHospital] = useState<Hospital | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  useEffect(() => {
    loadUserProfile();
    getUserLocation();

    // Set up the logout button in the header
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={24} color="white" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    if (user?.id) {
      loadUserAlerts();
      setupRealtimeAlertSubscription();
    }
  }, [user]);

  useEffect(() => {
    if (userLocation) {
      loadNearbyHospitals();
    }
  }, [userLocation]);

  useEffect(() => {
    // Find the selected alert or the first responding alert if none is selected
    const alertToShow = selectedAlertId 
      ? alerts.find(alert => alert.id === selectedAlertId)
      : alerts.find(alert => alert.status === 'responding');
      
    if (alertToShow?.hospitalid) {
      fetchRespondingHospital(alertToShow.hospitalid);
    } else {
      setRespondingHospital(null);
    }
  }, [alerts, selectedAlertId]);

  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'We need location permissions to show nearby hospitals.');
        return;
      }
      
      const location = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      });
    } catch (error) {
      console.error('Error getting user location:', error);
      Alert.alert('Location Error', 'Could not determine your location');
    }
  };

  const loadUserProfile = async () => {
    try {
      const profileJson = await AsyncStorage.getItem('userProfile');
      if (profileJson) {
        const profile = JSON.parse(profileJson);
        if (profile.accountType === 'user') {
          setUser(profile);
        }
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const setupRealtimeAlertSubscription = () => {
    if (!user?.id) return;

    const subscription = supabase
      .channel('alert_status_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'alert',
        filter: `userid=eq.${user.id}`,
      }, (payload) => {
        if (payload.eventType === 'UPDATE') {
          const updatedAlert = payload.new as EmergencyAlert;
          
          setAlerts(prevAlerts => 
            prevAlerts.map(alert => 
              alert.id === updatedAlert.id ? updatedAlert : alert
            )
          );
          
          // If status changed to responding, select this alert
          if (updatedAlert.status === 'responding' && updatedAlert.hospitalid) {
            setSelectedAlertId(updatedAlert.id);
            Alert.alert('Hospital Responding', 'A hospital is responding to your emergency');
          }
        }
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  };

  const loadUserAlerts = async () => {
    if (!user?.id) return;
    
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('alert')
        .select('*')
        .eq('userid', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setAlerts(data || []);
      
      // If nothing is selected, default to the first responding alert
      if (!selectedAlertId) {
        const respondingAlert = data?.find(alert => alert.status === 'responding');
        if (respondingAlert) {
          setSelectedAlertId(respondingAlert.id);
        }
      }
    } catch (error) {
      console.error('Error loading alerts:', error);
      Alert.alert('Error', 'Failed to load your emergency alerts');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  const loadNearbyHospitals = async () => {
    if (!userLocation) return;
    
    try {
      const { data, error } = await supabase
        .from('hospitals')
        .select('*');

      if (error) throw error;
      
      if (data) {
        // Calculate distance for each hospital
        const hospitalsWithDistance = data.map(hospital => {
          if (hospital.latitude && hospital.longitude) {
            const distance = calculateDistance(
              userLocation.latitude,
              userLocation.longitude,
              hospital.latitude,
              hospital.longitude
            );
            return { ...hospital, distance };
          }
          return { ...hospital, distance: Infinity };
        });
        
        // Sort by distance and take the 5 closest
        const closest = hospitalsWithDistance
          .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity))
          .slice(0, 5);
          
        setNearbyHospitals(closest);
      }
    } catch (error) {
      console.error('Error loading nearby hospitals:', error);
    }
  };

  const fetchRespondingHospital = async (hospitalId: string) => {
    try {
      const { data, error } = await supabase
        .from('hospitals')
        .select('*')
        .eq('id', hospitalId)
        .single();

      if (error) throw error;
      
      if (data) {
        setRespondingHospital(data);
      }
    } catch (error) {
      console.error('Error fetching responding hospital:', error);
    }
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    // Simple distance calculation using Haversine formula
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    const distance = R * c; // Distance in km
    return distance;
  };

  const deg2rad = (deg: number): number => {
    return deg * (Math.PI/180);
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
              await supabase.auth.signOut();
              await AsyncStorage.removeItem('userProfile');
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

  const selectAlert = (alertId: string) => {
    setSelectedAlertId(alertId);
  };

  const renderAlertItem = ({ item }: { item: EmergencyAlert }) => {
    const date = new Date(item.created_at);
    const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    const isSelected = item.id === selectedAlertId;
    
    return (
      <TouchableOpacity 
        onPress={() => selectAlert(item.id)}
        style={[styles.alertItem, isSelected && styles.selectedAlertItem]}
      >
        <View style={styles.alertHeader}>
          <Text style={styles.alertTitle}>Alert: {item.incident_type}</Text>
          <View style={[
            styles.statusBadge, 
            item.status === 'active' ? styles.activeStatus : 
            item.status === 'responding' ? styles.respondingStatus : 
            styles.resolvedStatus
          ]}>
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        </View>
        
        <Text style={styles.alertInfo}>Time: {formattedDate}</Text>
        <Text style={styles.alertInfo}>Patient: {item.patient_name}</Text>
        <Text style={styles.alertInfo}>Priority: {item.priority_status}</Text>
        
        {item.medical_conditions && (
          <View style={styles.detailBox}>
            <Text style={styles.detailTitle}>Medical Conditions:</Text>
            <Text style={styles.detailText}>{item.medical_conditions}</Text>
          </View>
        )}
        
        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={[styles.actionButton, styles.mapButton]}
            onPress={() => {
              navigation.navigate('Map', {
                latitude: item.latitude,
                longitude: item.longitude,
                alertId: item.id
              });
            }}
          >
            <Ionicons name="location" size={16} color="white" />
            <Text style={styles.buttonText}>View on Map</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHospitalItem = ({ item }: { item: Hospital }) => {
    return (
      <View style={styles.hospitalItem}>
        <View style={styles.hospitalHeader}>
          <Ionicons name="medical" size={20} color="#007BFF" />
          <Text style={styles.hospitalName}>{item.name}</Text>
        </View>
        <Text style={styles.hospitalInfo}>{item.address}</Text>
        {item.distance && (
          <Text style={styles.hospitalDistance}>{item.distance.toFixed(1)} km away</Text>
        )}
      </View>
    );
  };

  const renderRespondingHospital = () => {
    // Get the selected alert
    const selectedAlert = alerts.find(alert => alert.id === selectedAlertId);
    
    if (!respondingHospital || !selectedAlert) return null;
    
    return (
      <View style={styles.respondingHospitalContainer}>
        <View style={styles.respondingHeader}>
          <Ionicons name="alert-circle" size={24} color="#FFC107" />
          <Text style={styles.respondingTitle}>Hospital Responding to Alert</Text>
        </View>
        
        <View style={styles.alertSummary}>
          <Text style={styles.alertSummaryText}>
            <Text style={styles.alertSummaryLabel}>Alert Type:</Text> {selectedAlert.incident_type}
          </Text>
          <Text style={styles.alertSummaryText}>
            <Text style={styles.alertSummaryLabel}>Patient:</Text> {selectedAlert.patient_name}
          </Text>
          <Text style={styles.alertSummaryText}>
            <Text style={styles.alertSummaryLabel}>Status:</Text> {selectedAlert.status}
          </Text>
        </View>
        
        <View style={styles.respondingHospitalCard}>
          <Text style={styles.respondingHospitalName}>{respondingHospital.name}</Text>
          <Text style={styles.respondingHospitalInfo}>{respondingHospital.address}</Text>
          <Text style={styles.respondingHospitalInfo}>Email: {respondingHospital.email}</Text>
          
          <TouchableOpacity 
            style={styles.viewOnMapButton}
            onPress={() => {
              navigation.navigate('Map', {
                latitude: respondingHospital.latitude,
                longitude: respondingHospital.longitude,
                hospitalName: respondingHospital.name
              });
            }}
          >
            <Ionicons name="location" size={16} color="white" />
            <Text style={styles.buttonText}>Track Hospital Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007BFF" />
        <Text style={styles.loadingText}>Loading your dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Patient Dashboard</Text>
      
      {/* Section for responding hospital (shows only when a hospital is responding) */}
      {renderRespondingHospital()}
      
      {/* Alert section */}
      <View style={styles.alertsContainer}>
        <View style={styles.alertsHeaderContainer}>
          <Text style={styles.sectionTitle}>Your Emergency Alerts</Text>
          <Text style={styles.helpText}>Tap an alert to view hospital response</Text>
        </View>
        
        {alerts.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="medical" size={48} color="#28A745" />
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
                onRefresh={loadUserAlerts}
                colors={["#007BFF"]}
              />
            }
          />
        )}
      </View>
      
      {/* Nearby hospitals section (shows only when no hospital is responding) */}
      {!respondingHospital && (
        <View style={styles.hospitalsContainer}>
          <View style={styles.hospitalsSectionHeader}>
            <Text style={styles.sectionTitle}>Nearby Hospitals</Text>
            <TouchableOpacity onPress={loadNearbyHospitals}>
              <Ionicons name="refresh" size={20} color="#007BFF" />
            </TouchableOpacity>
          </View>
          
          {nearbyHospitals.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No nearby hospitals found</Text>
            </View>
          ) : (
            <FlatList
              data={nearbyHospitals}
              renderItem={renderHospitalItem}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.hospitalsList}
              horizontal={false}
            />
          )}
        </View>
      )}
      
      {/* Create New Alert button */}
      <TouchableOpacity 
        style={styles.createAlertButton}
        onPress={() => navigation.navigate('SOS')}
      >
        <Ionicons name="add-circle" size={20} color="white" />
        <Text style={styles.createAlertText}>Create New Emergency Alert</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
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
  alertsContainer: {
    flex: 2,
    marginBottom: 16,
  },
  alertsHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  helpText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  hospitalsContainer: {
    flex: 1,
  },
  hospitalsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  respondingHospitalContainer: {
    backgroundColor: '#FFF9E5',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFC107',
  },
  respondingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  respondingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFC107',
    marginLeft: 8,
  },
  alertSummary: {
    backgroundColor: '#FFFBF0',
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#FFC107',
  },
  alertSummaryText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  alertSummaryLabel: {
    fontWeight: 'bold',
  },
  respondingHospitalCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
  },
  respondingHospitalName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  respondingHospitalInfo: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  viewOnMapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFC107',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 12,
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
  hospitalsList: {
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
    borderLeftWidth: 0,
  },
  selectedAlertItem: {
    borderLeftWidth: 4,
    borderLeftColor: '#007BFF',
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
  activeStatus: {
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
  detailBox: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
  },
  detailText: {
    fontSize: 14,
    color: '#666',
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    flex: 1,
  },
  mapButton: {
    backgroundColor: '#007BFF',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  createAlertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC3545',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  createAlertText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  hospitalItem: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  hospitalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  hospitalName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginLeft: 8,
  },
  hospitalInfo: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
    marginLeft: 28,
  },
  hospitalDistance: {
    fontSize: 14,
    color: '#007BFF',
    fontWeight: 'bold',
    marginLeft: 28,
  },
  emptyState: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 30,
  },
  emptyText: {
    marginTop: 8,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});

export default UserDashboard;