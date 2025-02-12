import React, { useState, useEffect } from 'react';
import { Text, View, TextInput, Button, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from './supabase'; // You'll need to create this
import { Picker } from '@react-native-picker/picker';
import { NavigationProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';


type AuthMode = 'login' | 'signup';
type AccountType = 'user' | 'hospital';

interface LocationCoords {
  latitude: number;
  longitude: number;
}

interface AuthScreenProps {
  navigation: NavigationProp<any>;
}

interface UserData {
  name: string;
  email: string;
  password: string;
  mobile: string;
  location?: LocationCoords;
}

interface HospitalData {
  name: string;
  email: string;
  password: string;
  address: string;
  location?: LocationCoords;
}

export default function AuthScreen({ navigation }: AuthScreenProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [accountType, setAccountType] = useState<AccountType>('user');
  
  // Form states
  const [userData, setUserData] = useState<UserData>({
    name: '',
    email: '',
    password: '',
    mobile: '',
  });
  
  const [hospitalData, setHospitalData] = useState<HospitalData>({
    name: '',
    email: '',
    password: '',
    address: '',
  });
  
  const [location, setLocation] = useState<LocationCoords | null>(null);

  useEffect(() => {
    getLocation();
  }, []);

  const getLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location access is required for signup');
        return;
      }
      let location = await Location.getCurrentPositionAsync({});
      setLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    } catch (error) {
      Alert.alert('Error', 'Failed to get location');
    }
  };

  const handleSignup = async () => {
    if (!location) {
      Alert.alert('Error', 'Unable to get location');
      return;
    }

    try {
      let authResponse;
      
      if (accountType === 'user') {
        // First create the auth user
        authResponse = await supabase.auth.signUp({
          email: userData.email,
          password: userData.password,
        });

        if (authResponse.error) throw authResponse.error;

        // Then insert into users table using the auth id
        const { error: userError } = await supabase
          .from('users')
          .insert({
            id: authResponse.data.user!.id, // Use the auth user id
            name: userData.name,
            email: userData.email,
            mobile: userData.mobile,
            latitude: location.latitude,
            longitude: location.longitude,
          });

        if (userError) {
          // If user table insert fails, we should handle cleanup
          // Ideally delete the auth user, but Supabase doesn't expose this API
          throw userError;
        }
      } else {
        // First create the auth user for hospital
        authResponse = await supabase.auth.signUp({
          email: hospitalData.email,
          password: hospitalData.password,
        });

        if (authResponse.error) throw authResponse.error;

        // Then insert into hospitals table using the auth id
        const { error: hospitalError } = await supabase
          .from('hospitals')
          .insert({
            id: authResponse.data.user!.id, // Use the auth user id
            name: hospitalData.name,
            email: hospitalData.email,
            address: hospitalData.address,
            latitude: location.latitude,
            longitude: location.longitude,
          });

        if (hospitalError) {
          // If hospital table insert fails, we should handle cleanup
          throw hospitalError;
        }
      }

      Alert.alert('Success', 'Account created successfully! Please check your email for verification.');
      setAuthMode('login');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const handleLogin = async () => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: accountType === 'user' ? userData.email : hospitalData.email,
        password: accountType === 'user' ? userData.password : hospitalData.password,
      });

      if (error) throw error;

      // After successful login, fetch additional details
      const table = accountType === 'user' ? 'users' : 'hospitals';
      const { data: profile, error: profileError } = await supabase
        .from(table)
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError) throw profileError;

      // Store the complete profile data
      await AsyncStorage.setItem('userProfile', JSON.stringify({
        ...profile,
        accountType
      }));

      Alert.alert('Success', 'Login successful');
      navigation.navigate('MainTabs', { screen: 'SOS' });
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const updateUserData = (field: keyof UserData, value: string) => {
    setUserData(prev => ({ ...prev, [field]: value }));
  };

  const updateHospitalData = (field: keyof HospitalData, value: string) => {
    setHospitalData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{authMode === 'login' ? 'Login' : 'Signup'}</Text>

      <View style={styles.pickerBox}>
        <Picker
          selectedValue={accountType}
          style={styles.picker}
          onValueChange={(value: AccountType) => setAccountType(value)}
        >
          <Picker.Item label="User" value="user" />
          <Picker.Item label="Hospital" value="hospital" />
        </Picker>
      </View>

      {accountType === 'user' ? (
        // User Form
        <>
          {authMode === 'signup' && (
            <>
              <TextInput
                placeholder="Name"
                style={styles.input}
                value={userData.name}
                onChangeText={(value) => updateUserData('name', value)}
              />
              <TextInput
                placeholder="Mobile Number"
                style={styles.input}
                value={userData.mobile}
                onChangeText={(value) => updateUserData('mobile', value)}
                keyboardType="phone-pad"
              />           
            </>
          )}

          <TextInput
            placeholder="Email"
            style={styles.input}
            value={userData.email}
            onChangeText={(value) => updateUserData('email', value)}
            keyboardType="email-address"
          />
          <TextInput
            placeholder="Password"
            style={styles.input}
            value={userData.password}
            onChangeText={(value) => updateUserData('password', value)}
            secureTextEntry
          />
        </>
      ) : (
        // Hospital Form
        <>
          {authMode === 'signup' && (
            <>
              <TextInput
                placeholder="Hospital Name"
                style={styles.input}
                value={hospitalData.name}
                onChangeText={(value) => updateHospitalData('name', value)}
              />
              <TextInput
                placeholder="Address"
                style={styles.input}
                value={hospitalData.address}
                onChangeText={(value) => updateHospitalData('address', value)}
                multiline
              />
            </>
          )}

          <TextInput
            placeholder="Email"
            style={styles.input}
            value={hospitalData.email}
            onChangeText={(value) => updateHospitalData('email', value)}
            keyboardType="email-address"
          />
          <TextInput
            placeholder="Password"
            style={styles.input}
            value={hospitalData.password}
            onChangeText={(value) => updateHospitalData('password', value)}
            secureTextEntry
          />
        </>
      )}

      <Button
        title={authMode === 'login' ? 'Login' : 'Signup'}
        onPress={authMode === 'login' ? handleLogin : handleSignup}
      />

      <Text
        onPress={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
        style={styles.switchText}
      >
        {authMode === 'login' ? 'Create an account' : 'Already have an account? Login'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  title: {
    fontSize: 24,
    marginBottom: 16,
    textAlign: 'center',
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 12,
    padding: 8,
  },
  pickerBox: {
    borderWidth: 1,
    borderColor: 'gray',
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
    marginBottom: 12,
  },
  picker: {
    height: 50,
    width: '100%',
  },
  switchText: {
    textAlign: 'center',
    marginTop: 16,
    color: 'blue',
  },
});