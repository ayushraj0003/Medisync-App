import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function AlertDetails({ route }) {
  const alertData = route.params;

  const openMaps = () => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${alertData.latitude},${alertData.longitude}`;
    Linking.openURL(url);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.priorityBanner}>
        <Ionicons name="alert-circle" size={24} color="white" />
        <Text style={styles.priorityText}>{alertData.priority_status} Priority</Text>
      </View>

      <View style={styles.detailsContainer}>
        <View style={styles.detailItem}>
          <Text style={styles.label}>Patient Name</Text>
          <Text style={styles.value}>{alertData.patientName}</Text>
        </View>

        <View style={styles.detailItem}>
          <Text style={styles.label}>Incident Type</Text>
          <Text style={styles.value}>{alertData.incidentType}</Text>
        </View>

        <View style={styles.detailItem}>
          <Text style={styles.label}>Medical Conditions</Text>
          <Text style={styles.value}>{alertData.medicalConditions}</Text>
        </View>

        <View style={styles.detailItem}>
          <Text style={styles.label}>Distance</Text>
          <Text style={styles.value}>{alertData.distance.toFixed(1)} km away</Text>
        </View>

        <TouchableOpacity style={styles.mapButton} onPress={openMaps}>
          <Ionicons name="navigate" size={24} color="white" />
          <Text style={styles.mapButtonText}>Navigate to Location</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  priorityBanner: {
    backgroundColor: '#FF3B30',
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  priorityText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  detailsContainer: {
    padding: 20,
  },
  detailItem: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  value: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  mapButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
    gap: 10,
  },
  mapButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});