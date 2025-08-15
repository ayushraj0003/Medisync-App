import React, { useState, useEffect } from "react";
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Image,
} from "react-native";
import { supabase } from "./supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";

// Get screen dimensions for responsive design
const { width } = Dimensions.get("window");

interface Hospital {
  id: string;
  name: string;
  email: string;
  address: string;
  latitude: number;
  longitude: number;
  distance?: number;
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
  const [respondingHospital, setRespondingHospital] = useState<Hospital | null>(
    null
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState(null);
  const [activeTab, setActiveTab] = useState("alerts"); // "alerts", "hospitals", "firstaid"

  useEffect(() => {
    loadUserProfile();
    getUserLocation();

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
    const alertToShow = selectedAlertId
      ? alerts.find((alert) => alert.id === selectedAlertId)
      : alerts.find((alert) => alert.status === "responding");

    if (alertToShow?.hospitalid) {
      fetchRespondingHospital(alertToShow.hospitalid);
    } else {
      setRespondingHospital(null);
    }
  }, [alerts, selectedAlertId]);

  useEffect(() => {
    const loadSuggestions = async () => {
      try {
        // Try both possible keys where suggestions might be stored
        const savedSuggestions = await AsyncStorage.getItem("lastAlertSuggestions") 
          || await AsyncStorage.getItem("firstAidSuggestions");
    
        if (savedSuggestions) {
          setSuggestions(savedSuggestions);
          console.log("Loaded suggestions from storage:", savedSuggestions.substring(0, 50) + "...");
        } else {
          console.log("No suggestions found in AsyncStorage");
        }
      } catch (error) {
        console.error("Error loading suggestions:", error);
      }
    };

    loadSuggestions();

    const unsubscribe = navigation.addListener("focus", () => {
      loadSuggestions();
    });

    return unsubscribe;
  }, [navigation]);

  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Permission Denied",
          "We need location permissions to show nearby hospitals."
        );
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    } catch (error) {
      console.error("Error getting user location:", error);
      Alert.alert("Location Error", "Could not determine your location");
    }
  };

  const loadUserProfile = async () => {
    try {
      const profileJson = await AsyncStorage.getItem("userProfile");
      if (profileJson) {
        const profile = JSON.parse(profileJson);
        if (profile.accountType === "user") {
          setUser(profile);
        }
      }
    } catch (error) {
      console.error("Error loading user profile:", error);
    }
  };

  const setupRealtimeAlertSubscription = () => {
    if (!user?.id) return;

    const subscription = supabase
      .channel("alert_status_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alert",
          filter: `userid=eq.${user.id}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const updatedAlert = payload.new as EmergencyAlert;

            setAlerts((prevAlerts) =>
              prevAlerts.map((alert) =>
                alert.id === updatedAlert.id ? updatedAlert : alert
              )
            );

            if (
              updatedAlert.status === "responding" &&
              updatedAlert.hospitalid
            ) {
              setSelectedAlertId(updatedAlert.id);
              Alert.alert(
                "Hospital Responding",
                "A hospital is responding to your emergency"
              );
            }
          }
        }
      )
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
        .from("alert")
        .select("*")
        .eq("userid", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setAlerts(data || []);

      if (!selectedAlertId) {
        const respondingAlert = data?.find(
          (alert) => alert.status === "responding"
        );
        if (respondingAlert) {
          setSelectedAlertId(respondingAlert.id);
        }
      }
    } catch (error) {
      console.error("Error loading alerts:", error);
      Alert.alert("Error", "Failed to load your emergency alerts");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  const loadNearbyHospitals = async () => {
    if (!userLocation) return;

    try {
      const { data, error } = await supabase.from("hospitals").select("*");

      if (error) throw error;

      if (data) {
        const hospitalsWithDistance = data.map((hospital) => {
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

        const closest = hospitalsWithDistance
          .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity))
          .slice(0, 5);

        setNearbyHospitals(closest);
      }
    } catch (error) {
      console.error("Error loading nearby hospitals:", error);
    }
  };

  const fetchRespondingHospital = async (hospitalId: string) => {
    try {
      const { data, error } = await supabase
        .from("hospitals")
        .select("*")
        .eq("id", hospitalId)
        .single();

      if (error) throw error;

      if (data) {
        setRespondingHospital(data);
      }
    } catch (error) {
      console.error("Error fetching responding hospital:", error);
    }
  };

  const calculateDistance = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number => {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) *
        Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
  };

  const deg2rad = (deg: number): number => {
    return deg * (Math.PI / 180);
  };

  const handleLogout = async () => {
    Alert.alert("Confirm Logout", "Are you sure you want to logout?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Logout",
        onPress: async () => {
          try {
            await supabase.auth.signOut();
            await AsyncStorage.removeItem("userProfile");
            navigation.reset({
              index: 0,
              routes: [{ name: "Auth" }],
            });
          } catch (error) {
            console.error("Error during logout:", error);
            Alert.alert("Error", "Failed to logout. Please try again.");
          }
        },
      },
    ]);
  };

  const selectAlert = (alertId: string) => {
    setSelectedAlertId(alertId);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadUserAlerts();
    if (userLocation) {
      await loadNearbyHospitals();
    }
    setRefreshing(false);
  };

  const renderAlerts = () => {
    if (alerts.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="medical" size={48} color="#28A745" />
          <Text style={styles.emptyText}>No emergency alerts at this time</Text>
        </View>
      );
    }

    return (
      <View style={styles.listContainer}>
        {alerts.map((item) => {
          const date = new Date(item.created_at);
          const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
          const isSelected = item.id === selectedAlertId;

          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => selectAlert(item.id)}
              style={[styles.alertItem, isSelected && styles.selectedAlertItem]}
            >
              <View style={styles.alertHeader}>
                <Text style={styles.alertTitle}>
                  Alert: {item.incident_type}
                </Text>
                <View
                  style={[
                    styles.statusBadge,
                    item.status === "active"
                      ? styles.activeStatus
                      : item.status === "responding"
                      ? styles.respondingStatus
                      : styles.resolvedStatus,
                  ]}
                >
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
              </View>

              <Text style={styles.alertInfo}>Time: {formattedDate}</Text>
              <Text style={styles.alertInfo}>Patient: {item.patient_name}</Text>
              <Text style={styles.alertInfo}>
                Priority: {item.priority_status}
              </Text>

              {item.medical_conditions && (
                <View style={styles.detailBox}>
                  <Text style={styles.detailTitle}>Medical Conditions:</Text>
                  <Text style={styles.detailText}>
                    {item.medical_conditions}
                  </Text>
                </View>
              )}

              {item.status !== "resolved" && (
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.mapButton]}
                    onPress={() => {
                      navigation.navigate("Map", {
                        alertId: item.id,
                      });
                    }}
                  >
                    <Ionicons name="location" size={16} color="white" />
                    <Text style={styles.buttonText}>View on Map</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderHospitals = () => {
    if (nearbyHospitals.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="business" size={48} color="#007BFF" />
          <Text style={styles.emptyText}>No nearby hospitals found</Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={loadNearbyHospitals}
          >
            <Ionicons name="refresh" size={18} color="white" />
            <Text style={styles.refreshButtonText}>Refresh Hospitals</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.listContainer}>
        {nearbyHospitals.map((item) => (
          <View key={item.id} style={styles.hospitalItem}>
            <View style={styles.hospitalHeader}>
              <Ionicons name="medical" size={20} color="#007BFF" />
              <Text style={styles.hospitalName}>{item.name}</Text>
            </View>
            <Text style={styles.hospitalInfo}>{item.address}</Text>
            {item.distance && (
              <Text style={styles.hospitalDistance}>
                {item.distance.toFixed(1)} km away
              </Text>
            )}
          </View>
        ))}
      </View>
    );
  };

  const renderFirstAid = () => {
    if (!suggestions) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="medkit" size={48} color="#FF3B30" />
          <Text style={styles.emptyText}>
            No first aid suggestions available
          </Text>
          <TouchableOpacity
            style={[styles.refreshButton, { backgroundColor: "#FF3B30" }]}
            onPress={async () => {
              const demoSuggestions = `
1. What to do immediately:
- Keep the person calm and still
- Call for professional medical help if not already done
- Check their breathing and pulse

2. Key actions to take while waiting:
- Monitor vital signs regularly
- Keep the person comfortable
- Don't give food or drink

3. What NOT to do:
- Don't move the person unless absolutely necessary
- Don't give medications without medical advice
- Don't leave the person alone

4. Signs to monitor:
- Level of consciousness
- Breathing pattern
- Pulse rate
- Skin color and temperature

5. How to prepare for ambulance arrival:
- Have someone ready to direct paramedics
- Gather any medication information
- Keep the path clear for stretcher access
`;
              await AsyncStorage.setItem(
                "lastAlertSuggestions",
                demoSuggestions
              );
              setSuggestions(demoSuggestions);
            }}
          >
            <Ionicons name="download" size={18} color="white" />
            <Text style={styles.refreshButtonText}>Load Sample Advice</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.firstAidContainer}>
        <View style={styles.firstAidCard}>
          <View style={styles.firstAidHeader}>
            <Ionicons name="medkit" size={28} color="#FF3B30" />
            <Text style={styles.firstAidTitle}>Emergency First Aid Guide</Text>
          </View>
          <Text style={styles.firstAidText}>{suggestions}</Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF3B30" />
        <Text style={styles.loadingText}>Loading your dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {respondingHospital && selectedAlertId && (
        <View style={styles.respondingHospitalBanner}>
          <View style={styles.respondingHeader}>
            <Ionicons name="alert-circle" size={24} color="white" />
            <Text style={styles.respondingTitle}>Hospital Responding</Text>
          </View>
          <TouchableOpacity
            style={styles.respondingButton}
            onPress={() => {
              const selectedAlert = alerts.find(
                (a) => a.id === selectedAlertId
              );
              if (selectedAlert) {
                navigation.navigate("Map", {
                  alertId: selectedAlert.id,
                });
              }
            }}
          >
            <Ionicons name="navigate" size={16} color="white" />
            <Text style={styles.respondingButtonText}>Track</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "alerts" && styles.activeTab]}
          onPress={() => setActiveTab("alerts")}
        >
          <Ionicons
            name="warning"
            size={22}
            color={activeTab === "alerts" ? "#FF3B30" : "#666"}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "alerts" && styles.activeTabText,
            ]}
          >
            Alerts
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === "hospitals" && styles.activeTab]}
          onPress={() => setActiveTab("hospitals")}
        >
          <Ionicons
            name="business"
            size={22}
            color={activeTab === "hospitals" ? "#FF3B30" : "#666"}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "hospitals" && styles.activeTabText,
            ]}
          >
            Hospitals
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === "firstaid" && styles.activeTab]}
          onPress={() => setActiveTab("firstaid")}
        >
          <Ionicons
            name="medkit"
            size={22}
            color={activeTab === "firstaid" ? "#FF3B30" : "#666"}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === "firstaid" && styles.activeTabText,
            ]}
          >
            First Aid
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#FF3B30"]}
          />
        }
      >
        {activeTab === "alerts" && (
          <>
            <Text style={styles.sectionTitle}>Your Emergency Alerts</Text>
            {renderAlerts()}
          </>
        )}

        {activeTab === "hospitals" && (
          <>
            <Text style={styles.sectionTitle}>Nearby Medical Facilities</Text>
            {renderHospitals()}
          </>
        )}

        {activeTab === "firstaid" && (
          <>
            <Text style={styles.sectionTitle}>First Aid Information</Text>
            {renderFirstAid()}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <TouchableOpacity
        style={styles.createAlertButton}
        onPress={() => navigation.navigate("EmergencyAlert")}
      >
        <Ionicons name="add-circle" size={22} color="white" />
        <Text style={styles.createAlertText}>Create Emergency Alert</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  respondingHospitalBanner: {
    backgroundColor: "#FF3B30",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  respondingHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  respondingTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "white",
    marginLeft: 8,
  },
  respondingButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  respondingButtonText: {
    color: "white",
    fontWeight: "bold",
    marginLeft: 4,
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "white",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "center",
  },
  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: "#FF3B30",
  },
  tabText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
    marginLeft: 4,
  },
  activeTabText: {
    color: "#FF3B30",
    fontWeight: "bold",
  },
  contentContainer: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 12,
    color: "#333",
    marginTop: 8,
  },
  listContainer: {
    marginBottom: 20,
  },
  alertItem: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    borderLeftWidth: 0,
  },
  selectedAlertItem: {
    borderLeftWidth: 4,
    borderLeftColor: "#FF3B30",
  },
  alertHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  alertTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeStatus: {
    backgroundColor: "#DC3545",
  },
  respondingStatus: {
    backgroundColor: "#FFC107",
  },
  resolvedStatus: {
    backgroundColor: "#28A745",
  },
  statusText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  alertInfo: {
    fontSize: 14,
    marginBottom: 4,
    color: "#666",
  },
  detailBox: {
    backgroundColor: "#F8F9FA",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 4,
    color: "#333",
  },
  detailText: {
    fontSize: 14,
    color: "#666",
  },
  actionButtons: {
    flexDirection: "row",
    marginTop: 12,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    flex: 1,
  },
  mapButton: {
    backgroundColor: "#FF3B30",
  },
  buttonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
    marginLeft: 8,
  },
  hospitalItem: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  hospitalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  hospitalName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginLeft: 8,
  },
  hospitalInfo: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  hospitalDistance: {
    fontSize: 14,
    color: "#007BFF",
    fontWeight: "bold",
    marginTop: 4,
  },
  firstAidContainer: {
    marginBottom: 20,
  },
  firstAidCard: {
    backgroundColor: "white",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  firstAidHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  firstAidTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FF3B30",
    marginLeft: 10,
  },
  firstAidText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#333",
  },
  emptyState: {
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
    backgroundColor: "white",
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  emptyText: {
    marginTop: 12,
    marginBottom: 16,
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#007BFF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  refreshButtonText: {
    color: "white",
    marginLeft: 6,
  },
  createAlertButton: {
    position: "absolute",
    bottom: 20,
    left: width * 0.1,
    right: width * 0.1,
    backgroundColor: "#FF3B30",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 30,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  createAlertText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 8,
  },
  logoutButton: {
    marginRight: 15,
  },
});

export default UserDashboard;
