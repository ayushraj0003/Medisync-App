import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";  // Import Gemini API
import * as Location from 'expo-location';
import {GEMINI_API_KEY, ASSEMBLY_AI_API_KEY} from "@env";  // Import API keys from .env file

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const transcribeAudio = async (fileUri) => {
  try {
    const response = await fetch(fileUri);
    const blob = await response.blob();

    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: 'POST',
      headers: {
        authorization: ASSEMBLY_AI_API_KEY,
        'Content-Type': 'audio/m4a',
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
// Function to analyze transcription with Gemini
const analyzeWithGemini = async (transcription, location) => {
  try {
    // Verify location data
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      console.warn('Invalid or missing location data:', location);
      location = null;
    }

    // Create a JSON structure that will be part of the prompt
    const exampleJson = {
      "Patient Name": "Extracted Name or null",
      "Address or location of the incident": "Extracted Location or null",
      "Latitude": location ? location.latitude : null,
      "Longitude": location ? location.longitude : null,
      "Type of incident": "Accident / Medical / Fire / Other",
      "Medical conditions mentioned": "List any conditions mentioned",
      "Priority status": "High / Medium / Low",
      "Reason for priority status": "Explain why this category was assigned"
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
- Use the exact latitude (${location ? location.latitude : 'null'}) and longitude (${location ? location.longitude : 'null'}) provided.
- Return ONLY the JSON object without any markdown formatting, code blocks, or additional text.
- If any information is missing, use "null" for that field.
`;

    console.log("Sending prompt with location:", location);

    const result = await model.generateContent(prompt);
    let analysis = result.response.text();

    // Clean the response by removing markdown code blocks and any extra whitespace
    analysis = analysis.replace(/```json\n?|\n?```/g, '').trim();
    
    console.log("Cleaned response:", analysis);

    try {
      const jsonResponse = JSON.parse(analysis);
      console.log("Parsed JSON response:", jsonResponse);
      Alert.alert("Analysis Complete", JSON.stringify(jsonResponse, null, 2));
    } catch (e) {
      console.error("Failed to parse JSON:", e);
      console.error("Response content:", analysis);
      Alert.alert("Error", "Failed to parse analysis response");
    }

  } catch (error) {
    console.error("Error analyzing with Gemini:", error);
    Alert.alert("Error", "Failed to analyze with Gemini");
  }
};

export default function ExpoAudioRecorder() {
  const [recording, setRecording] = useState(null);
  const [recordingStatus, setRecordingStatus] = useState("idle");
  const [audioPermission, setAudioPermission] = useState(false);
  const [recordingUri, setRecordingUri] = useState(null);

  useEffect(() => {
    const getPermission = async () => {
      try {
        const permission = await Audio.requestPermissionsAsync();
        setAudioPermission(permission.status === "granted");

        if (permission.status !== "granted") {
          Alert.alert("Permission required", "Please grant access to the microphone.");
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
        Alert.alert("Permission required", "Please grant access to the microphone.");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
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
        const recordingsDir = `${FileSystem.documentDirectory}recordings/`;
        const dirInfo = await FileSystem.getInfoAsync(recordingsDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(recordingsDir, { intermediates: true });
        }

        const filename = `recording-${Date.now()}.m4a`;
        const newUri = recordingsDir + filename;

        await FileSystem.moveAsync({
          from: uri,
          to: newUri,
        });

        setRecordingUri(newUri);
        console.log("Recording saved to:", newUri);

        // Trigger transcription
        transcribeAudio(newUri);

        Alert.alert("Recording Saved", "The recording has been saved and is being transcribed.");
      }

      setRecording(null);
      setRecordingStatus("stopped");
    } catch (err) {
      console.error("Failed to stop recording:", err);
      Alert.alert("Error", "Failed to stop recording");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>Status: {recordingStatus}</Text>
      {recordingUri && <Text>Last recording: {recordingUri.split('/').pop()}</Text>}
      <TouchableOpacity
        style={[styles.button, recordingStatus === "recording" && styles.recordingButton]}
        onPress={recordingStatus === "recording" ? stopRecording : startRecording}
      >
        <Text style={styles.buttonText}>
          {recordingStatus === "recording" ? "Stop Recording" : "Start Recording"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  statusText: {
    fontSize: 16,
    marginBottom: 10,
    color: '#666',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 10,
    marginVertical: 10,
  },
  recordingButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
