import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  SafeAreaView,
  Image,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai"; // Import Gemini API
import * as Location from "expo-location";
import { GEMINI_API_KEY, ASSEMBLY_AI_API_KEY } from "@env"; // Import API keys from .env file
import { sendSOSAlerts } from "./hospitalAlerts";
import { useNavigation } from "@react-navigation/native"; // Import for tion
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "./supabase"; // You'll need to create this

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2)); // Distance in km, rounded to 2 decimal places
};

const findNearbyHospitals = async (latitude, longitude) => {
  try {
    const { data: hospitals, error } = await supabase
      .from("hospitals")
      .select("name, latitude, longitude");

    if (error) {
      console.error("Error fetching hospitals:", error);
      return;
    }

    console.log(
      "\n=== Searching for hospitals near:",
      latitude,
      longitude,
      "==="
    );

    const nearbyHospitals = hospitals.filter((hospital) => {
      const distance = calculateDistance(
        latitude,
        longitude,
        Number(hospital.latitude),
        Number(hospital.longitude)
      );
      hospital.distance = distance;
      return distance <= 5; // 5km radius
    });

    // Sort by distance and log
    const sortedHospitals = nearbyHospitals.sort(
      (a, b) => a.distance - b.distance
    );

    console.log("\n=== Nearby Hospitals (within 5km) ===");
    if (sortedHospitals.length === 0) {
      console.log("No hospitals found within 5km radius");
    } else {
      sortedHospitals.forEach((hospital) => {
        console.log(`${hospital.name} - ${hospital.distance}km away`);
      });
    }
    console.log("=====================================\n");

    return sortedHospitals;
  } catch (error) {
    console.error("Error in findNearbyHospitals:", error);
    return [];
  }
};

const transcribeAudio = async (fileUri) => {
  try {
    const response = await fetch(fileUri);
    const blob = await response.blob();

    console.log("Supabase URL:", GEMINI_API_KEY);
    console.log("Supabase Key:", ASSEMBLY_AI_API_KEY);

    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: {
        authorization: ASSEMBLY_AI_API_KEY,
        "Content-Type": "audio/m4a",
      },
      body: blob,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    const uploadData = await uploadResponse.json();

    const transcriptionResponse = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: uploadData.upload_url,
        language_code: "en_us",
      },
      {
        headers: {
          authorization: ASSEMBLY_AI_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    checkTranscriptionStatus(transcriptionResponse.data.id);
  } catch (error) {
    Alert.alert("Error", `Upload failed: ${error.message}`);
  }
};

const checkTranscriptionStatus = async (transcriptId) => {
  try {
    const response = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      {
        headers: { authorization: ASSEMBLY_AI_API_KEY },
      }
    );

    const { status, text } = response.data;

    if (status === "completed") {
      console.log("Transcribed Text:", text);
      Alert.alert("Transcription Complete", text);

      // Fetch real-time location before sending to Gemini
      const location = await getUserLocation();
      console.log("Raw location data:", location);
      if (!location) {
        Alert.alert("Location Unavailable", "Could not fetch location.");
      }

      console.log("Location fetched:", location); // Debugging line
      await analyzeWithGemini(text, location);
    } else if (status === "error") {
      Alert.alert("Error", response.data.error);
    } else {
      setTimeout(() => checkTranscriptionStatus(transcriptId), 3000);
    }
  } catch (error) {
    Alert.alert("Error", "Failed to check transcription status");
  }
};

const getUserLocation = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Please enable location services.");
      return null;
    }

    const location = await Location.getCurrentPositionAsync({});
    console.log("Raw location data:", location); // Debug raw location

    const locationData = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
    console.log("Formatted location data:", locationData); // Debug formatted location

    return locationData;
  } catch (error) {
    console.error("Error fetching location:", error);
    return null;
  }
};

const analyzeWithGemini = async (transcription, location) => {
  try {
    // Verify location data
    if (
      !location ||
      typeof location.latitude !== "number" ||
      typeof location.longitude !== "number"
    ) {
      console.warn("Invalid or missing location data:", location);
      location = null;
    }
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("Error fetching authenticated user:", userError);
      Alert.alert(
        "Authentication Error",
        "Failed to retrieve user information"
      );
      return;
    }
    const userId = user.id;
    // Create a JSON structure that will be part of the prompt
    const exampleJson = {
      "Patient Name": "Extracted Name or null",
      "Address or location of the incident": "Extracted Location or null",
      Latitude: location ? location.latitude : null,
      Longitude: location ? location.longitude : null,
      "Type of incident": "Accident / Medical / Fire / Other",
      "Medical conditions mentioned": "List any conditions mentioned",
      "Priority status": "High / Medium / Low",
      "Reason for priority status": "Explain why this category was assigned",
    };

    const prompt = `
  The following message is an emergency SOS call. Extract critical information and categorize the priority level based on urgency.

  ### **Priority Criteria:**
  - **High:** Immediate danger to life (e.g., cardiac arrest, severe bleeding, unconsciousness, stroke, difficulty breathing, major accidents, severe burns).
  - **Medium:** Urgent but not life-threatening (e.g., broken bones, moderate burns, difficulty moving, high fever, allergic reaction without airway blockage).
  - **Low:** Non-urgent (e.g., minor cuts, stable condition, mild pain, general health consultation, transport requests).

  ### **Required Information Extraction:**
  Respond with ONLY the JSON object, without any markdown formatting or code blocks. Use this exact structure:

  ${JSON.stringify(exampleJson, null, 2)}

  **SOS Message:**  
  "${transcription}"

  Important: 
  - Use the exact latitude (${
    location ? location.latitude : "null"
  }) and longitude (${location ? location.longitude : "null"}) provided.
  - Return ONLY the JSON object without any markdown formatting, code blocks, or additional text.
  - If any information is missing, use "null" for that field.
  `;

    console.log("Sending prompt with location:", location);

    const result = await model.generateContent(prompt);
    let analysis = result.response.text();

    // Clean the response by removing markdown code blocks and any extra whitespace
    analysis = analysis.replace(/```json\n?|\n?```/g, "").trim();

    console.log("Cleaned response:", analysis);

    try {
      const jsonResponse = JSON.parse(analysis);
      console.log("Parsed JSON response:", jsonResponse);

      // Save to Supabase
      const { data, error } = await supabase
        .from("alert")
        .insert([
          {
            patient_name: jsonResponse["Patient Name"] || "Unknown",
            incident_location:
              jsonResponse["Address or location of the incident"] || "Unknown",
            latitude: location?.latitude || 0,
            longitude: location?.longitude || 0,
            incident_type: jsonResponse["Type of incident"] || "Unknown",
            medical_conditions:
              jsonResponse["Medical conditions mentioned"] || "None reported",
            priority_status: jsonResponse["Priority status"] || "Low",
            priority_reason:
              jsonResponse["Reason for priority status"] ||
              "No reason provided",
            userid: userId,
          },
        ])
        .select();

      // After successfully saving to Supabase
      await sendSOSAlerts({
        patient_name: jsonResponse["Patient Name"] || "Unknown",
        incident_location:
          jsonResponse["Address or location of the incident"] || "Unknown",
        latitude: location?.latitude || 0,
        longitude: location?.longitude || 0,
        incident_type: jsonResponse["Type of incident"] || "Unknown",
        medical_conditions:
          jsonResponse["Medical conditions mentioned"] || "None reported",
        priority_status: jsonResponse["Priority status"] || "Low",
        priority_reason:
          jsonResponse["Reason for priority status"] || "No reason provided",
        userid: userId,
      });

      if (error) {
        console.error("Error saving to Supabase:", error);
        Alert.alert("Error", "Failed to save alert to database");
        return;
      }

      console.log("Successfully saved to Supabase:", data);
      const nearbyHospitals = await findNearbyHospitals(
        location.latitude,
        location.longitude
      );

      // Create a message that includes both alert and hospital information
      const alertMessage = `Emergency alert has been recorded with priority: ${
        jsonResponse["Priority status"]
      }\n\n${
        nearbyHospitals.length > 0
          ? `Found ${
              nearbyHospitals.length
            } hospitals within 5km:\n${nearbyHospitals
              .slice(0, 3)
              .map((h) => `- ${h.name} (${h.distance}km)`)
              .join("\n")}`
          : "No hospitals found within 5km radius"
      }`;

      Alert.alert("Alert Saved", alertMessage);
    } catch (e) {
      console.error("Failed to parse JSON or save to database:", e);
      console.error("Response content:", analysis);
      Alert.alert("Error", "Failed to process and save alert");
    }
  } catch (error) {
    console.error("Error in analyzeWithGemini:", error);
    Alert.alert("Error", "Failed to analyze and save alert");
  }
};

export default function ExpoAudioRecorder() {
  const navigation = useNavigation();
  const [recording, setRecording] = useState(null);
  const [recordingStatus, setRecordingStatus] = useState("idle");
  const [audioPermission, setAudioPermission] = useState(false);
  const [recordingUri, setRecordingUri] = useState(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processingAlert, setProcessingAlert] = useState(false);

  useEffect(() => {
    let interval = null;

    if (recordingStatus === "recording") {
      interval = setInterval(() => {
        setRecordingTime((prevTime) => prevTime + 1);
      }, 1000);
    } else {
      setRecordingTime(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [recordingStatus]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = (seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  };

  useEffect(() => {
    const getPermission = async () => {
      try {
        const permission = await Audio.requestPermissionsAsync();
        setAudioPermission(permission.status === "granted");

        if (permission.status !== "granted") {
          Alert.alert(
            "Permission required",
            "Please grant access to the microphone."
          );
        }
      } catch (err) {
        console.error("Failed to get permission:", err);
      }
    };

    getPermission();
  }, []);

  const startRecording = async () => {
    try {
      if (!audioPermission) {
        Alert.alert(
          "Permission required",
          "Please grant access to the microphone."
        );
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      await newRecording.startAsync();

      setRecording(newRecording);
      setRecordingStatus("recording");

      console.log("Recording started");
    } catch (err) {
      console.error("Failed to start recording:", err);
      Alert.alert("Error", "Failed to start recording");
    }
  };

  const stopRecording = async () => {
    try {
      if (!recording) return;

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

      if (uri) {
        setProcessingAlert(true);
        const recordingsDir = `${FileSystem.documentDirectory}recordings/`;
        const dirInfo = await FileSystem.getInfoAsync(recordingsDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(recordingsDir, {
            intermediates: true,
          });
        }

        const filename = `recording-${Date.now()}.m4a`;
        const newUri = recordingsDir + filename;

        await FileSystem.moveAsync({
          from: uri,
          to: newUri,
        });

        setRecordingUri(newUri);
        console.log("Recording saved to:", newUri);

        transcribeAudio(newUri);

        Alert.alert(
          "Recording Saved",
          "The recording has been saved and is being transcribed. Redirecting to dashboard...",
          [
            {
              text: "OK",
              onPress: () => {
                setProcessingAlert(false);
                navigation.navigate("UserTabs", { screen: "UserDashboard" });
              },
            },
          ]
        );
      }

      setRecording(null);
      setRecordingStatus("stopped");
    } catch (err) {
      setProcessingAlert(false);
      console.error("Failed to stop recording:", err);
      Alert.alert("Error", "Failed to stop recording");
    }
  };

  const handleLogout = async () => {
    try {
      Alert.alert("Logout", "Are you sure you want to logout?", [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Logout",
          onPress: async () => {
            const { error } = await supabase.auth.signOut();
            console.log("Success");

            if (error) {
              console.error("Error signing out:", error);
              Alert.alert("Error", "Failed to sign out");
              return;
            }

            await AsyncStorage.removeItem("userProfile");

            navigation.reset({
              index: 0,
              routes: [{ name: "Auth" }],
            });
          },
        },
      ]);
    } catch (error) {
      console.error("Logout error:", error);
      Alert.alert("Error", "Failed to logout");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#FF3B30" />

      {/* <View style={styles.header}>
        <Ionicons name="medkit" size={24} color="white" />
        <Text style={styles.headerText}>Emergency Alert</Text>
      </View> */}

      <ScrollView style={styles.scrollView}>
        <View style={styles.container}>
          <View style={styles.sosContainer}>
            <View style={styles.sosIconContainer}>
              <Ionicons name="warning" size={40} color="white" />
            </View>
            <Text style={styles.sosTitle}>SOS MEDICAL ALERT</Text>
          </View>

          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusIndicator,
                  recordingStatus === "recording"
                    ? styles.statusIndicatorActive
                    : {},
                ]}
              />
              <Text style={styles.statusLabel}>Status:</Text>
              <Text
                style={[
                  styles.statusValue,
                  recordingStatus === "recording" ? styles.recordingText : {},
                ]}
              >
                {recordingStatus === "recording" ? "RECORDING" : "Ready"}
              </Text>
            </View>

            {recordingStatus === "recording" && (
              <Text style={styles.timerText}>{formatTime(recordingTime)}</Text>
            )}
          </View>

          <View style={styles.guideCard}>
            <Text style={styles.guideTitle}>
              <Ionicons name="information-circle" size={20} color="#007AFF" />{" "}
              Emergency Voice Guide
            </Text>
            <Text style={styles.guideSubtitle}>
              Please include the following details clearly:
            </Text>

            <View style={styles.guideItem}>
              <Ionicons
                name="person"
                size={20}
                color="#555"
                style={styles.guideIcon}
              />
              <View>
                <Text style={styles.guideItemTitle}>Your Name</Text>
                <Text style={styles.guideItemDesc}>State your full name</Text>
              </View>
            </View>

            <View style={styles.guideItem}>
              <Ionicons
                name="location"
                size={20}
                color="#555"
                style={styles.guideIcon}
              />
              <View>
                <Text style={styles.guideItemTitle}>Your Location</Text>
                <Text style={styles.guideItemDesc}>
                  Describe your exact location with landmarks
                </Text>
              </View>
            </View>

            <View style={styles.guideItem}>
              <Ionicons
                name="alert-circle"
                size={20}
                color="#555"
                style={styles.guideIcon}
              />
              <View>
                <Text style={styles.guideItemTitle}>Emergency Details</Text>
                <Text style={styles.guideItemDesc}>
                  Describe the incident, injuries, symptoms
                </Text>
              </View>
            </View>

            <View style={styles.guideItem}>
              <Ionicons
                name="medical"
                size={20}
                color="#555"
                style={styles.guideIcon}
              />
              <View>
                <Text style={styles.guideItemTitle}>Medical Information</Text>
                <Text style={styles.guideItemDesc}>
                  Mention allergies, conditions, medications
                </Text>
              </View>
            </View>

            <Text style={styles.exampleText}>
              Example: "My name is John Smith. I'm at Central Park near the
              fountain. I'm having severe chest pain and difficulty breathing. I
              have a history of heart problems and take medication for high
              blood pressure."
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.recordButton,
              recordingStatus === "recording" ? styles.stopButton : {},
            ]}
            onPress={
              recordingStatus === "recording" ? stopRecording : startRecording
            }
          >
            <Ionicons
              name={recordingStatus === "recording" ? "stop" : "mic"}
              size={30}
              color="white"
            />
            <Text style={styles.recordButtonText}>
              {recordingStatus === "recording"
                ? "Stop Recording"
                : "Start Recording"}
            </Text>
          </TouchableOpacity>

          {/* <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Ionicons
              name="log-out"
              size={18}
              color="white"
              style={{ marginRight: 5 }}
            />
            <Text style={styles.buttonText}>Logout</Text>
          </TouchableOpacity> */}
        </View>
      </ScrollView>

      {processingAlert && (
        <View style={styles.processingOverlay}>
          <View style={styles.processingCard}>
            <ActivityIndicator size="large" color="#FF3B30" />
            <Text style={styles.processingText}>
              Processing your emergency alert...
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: "#FF3B30",
    paddingVertical: 15,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  headerText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 10,
  },
  container: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  sosContainer: {
    width: "100%",
    alignItems: "center",
    marginBottom: 20,
  },
  sosIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 50,
    backgroundColor: "#FF3B30",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  sosTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginTop: 5,
  },
  statusCard: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#888",
    marginRight: 10,
  },
  statusIndicatorActive: {
    backgroundColor: "#FF3B30",
  },
  statusLabel: {
    fontSize: 16,
    color: "#666",
    marginRight: 5,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  recordingText: {
    color: "#FF3B30",
  },
  timerText: {
    fontSize: 30,
    fontWeight: "bold",
    color: "#FF3B30",
    textAlign: "center",
    marginTop: 10,
  },
  guideCard: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  guideTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#007AFF",
    marginBottom: 10,
  },
  guideSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 15,
  },
  guideItem: {
    flexDirection: "row",
    marginBottom: 15,
    alignItems: "flex-start",
  },
  guideIcon: {
    marginRight: 10,
    marginTop: 2,
  },
  guideItemTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  guideItemDesc: {
    fontSize: 14,
    color: "#666",
  },
  exampleText: {
    fontSize: 14,
    fontStyle: "italic",
    color: "#666",
    backgroundColor: "#f8f8f8",
    padding: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  recordButton: {
    backgroundColor: "#007AFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    marginVertical: 10,
    width: "90%",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  stopButton: {
    backgroundColor: "#FF3B30",
  },
  recordButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
    marginLeft: 10,
  },
  logoutButton: {
    backgroundColor: "#FF9500",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 25,
    marginTop: 20,
    width: "90%",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  processingOverlay: {
    position: "absolute",
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  processingCard: {
    backgroundColor: "white",
    padding: 20,
    borderRadius: 10,
    alignItems: "center",
    width: "80%",
  },
  processingText: {
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 15,
    color: "#333",
  },
});
