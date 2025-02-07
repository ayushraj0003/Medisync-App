import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";  // Import Gemini API

const ASSEMBLY_AI_API_KEY = "";
const GEMINI_API_KEY = "";  // Replace with your actual Gemini API key

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
      Alert.alert("Transcription Complete", text);
      console.log("Transcribed Text:", text);

      // Send the transcribed text to Gemini for extracting patient details
      await analyzeWithGemini(text);
    } else if (status === "error") {
      Alert.alert("Error", response.data.error);
    } else {
      // Continue polling if not complete
      setTimeout(() => checkTranscriptionStatus(transcriptId), 3000);
    }
  } catch (error) {
    Alert.alert("Error", "Failed to check transcription status");
  }
};

// Function to analyze transcription with Gemini
const analyzeWithGemini = async (transcription) => {
  try {
    const prompt = `
  The following message is an emergency SOS call. Please carefully analyze and extract the following information:
  
  1. **Patient Name** (if mentioned)
  2. **Address or location** of the incident
  3. **Type of incident** (e.g., accident, fire, medical emergency, etc.)
  4. **Medical conditions** mentioned, if any
  5. **Priority status** (High, Medium, Low) based on urgency

  Respond in the following JSON format:
  {
    "Patient Name": "",
    "Address or location of the incident": "",
    "Type of incident": "",
    "Medical conditions mentioned": "",
    "Priority status": ""
  }

  SOS Message: "${transcription}"
  
  Only include the fields that can be confidently extracted based on the message.
`;


    const result = await model.generateContent(prompt);
    const analysis = result.response.text();

    console.log("Gemini Analysis:", analysis);
    Alert.alert("Analysis Complete", analysis);
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