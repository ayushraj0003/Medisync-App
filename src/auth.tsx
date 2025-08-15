import React, { useState, useEffect } from 'react';
import { Text, View, TextInput, Button, StyleSheet, Alert, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { supabase } from './supabase';
import { NavigationProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { registerForPushNotificationsAsync, updateHospitalPushToken } from './hospitalAlerts';
import { Ionicons } from '@expo/vector-icons';

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
        authResponse = await supabase.auth.signUp({
          email: userData.email,
          password: userData.password,
        });
        if (authResponse.error) throw authResponse.error;
        const { error: userError } = await supabase
          .from('users')
          .insert({
            id: authResponse.data.user!.id,
            name: userData.name,
            email: userData.email,
            mobile: userData.mobile,
            latitude: location.latitude,
            longitude: location.longitude,
          });
        if (userError) {
          throw userError;
        }
      } else {
        const pushToken = await registerForPushNotificationsAsync();
        authResponse = await supabase.auth.signUp({
          email: hospitalData.email,
          password: hospitalData.password,
        });
        if (authResponse.error) throw authResponse.error;
        const { error: hospitalError } = await supabase
          .from('hospitals')
          .insert({
            id: authResponse.data.user!.id,
            name: hospitalData.name,
            email: hospitalData.email,
            address: hospitalData.address,
            latitude: location.latitude,
            longitude: location.longitude,
            push_token: pushToken || null,
          });
        if (hospitalError) {
          throw hospitalError;
        }
        if (!pushToken) {
          Alert.alert('Warning', 'Account created, but push notifications may not work. Please ensure you\'re using a physical device and have granted notification permissions.');
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

      if (data.session) {
        await AsyncStorage.setItem('supabaseSession', JSON.stringify(data.session));
      }

      const table = accountType === 'user' ? 'users' : 'hospitals';
      const { data: profile, error: profileError } = await supabase
        .from(table)
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError) throw profileError;

      if (accountType === 'hospital') {
        const tokenResult = await updateHospitalPushToken(data.user.id);
        if (!tokenResult.success) {
          console.warn('Failed to update push token:', tokenResult.message);
        }
      }

      await AsyncStorage.setItem('userProfile', JSON.stringify({
        ...profile,
        accountType
      }));

      Alert.alert('Success', 'Login successful');

      if (accountType === 'hospital') {
        navigation.replace('HospitalTabs');
      } else {
        navigation.replace('UserTabs');
      }
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.logoContainer}>
          <Ionicons name="medkit" size={56} color="#FF3B30" />
          <Text style={styles.appTitle}>Medi Emergency</Text>
        </View>

        <View style={styles.authBox}>
          <Text style={styles.title}>{authMode === 'login' ? 'Login' : 'Sign Up'}</Text>

          {/* Improved toggle for account type */}
          <View style={styles.toggleContainer}>
            <TouchableOpacity
              style={[
                styles.toggleButton,
                accountType === 'user' && styles.toggleButtonActive,
              ]}
              onPress={() => setAccountType('user')}
              activeOpacity={0.8}
            >
              <Ionicons name="person-outline" size={18} color={accountType === 'user' ? '#fff' : '#FF3B30'} />
              <Text style={[
                styles.toggleButtonText,
                accountType === 'user' && styles.toggleButtonTextActive,
              ]}>User</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.toggleButton,
                accountType === 'hospital' && styles.toggleButtonActive,
              ]}
              onPress={() => setAccountType('hospital')}
              activeOpacity={0.8}
            >
              <Ionicons name="medkit-outline" size={18} color={accountType === 'hospital' ? '#fff' : '#FF3B30'} />
              <Text style={[
                styles.toggleButtonText,
                accountType === 'hospital' && styles.toggleButtonTextActive,
              ]}>Hospital</Text>
            </TouchableOpacity>
          </View>

          {accountType === 'user' ? (
            <>
              {authMode === 'signup' && (
                <>
                  <TextInput
                    placeholder="Name"
                    style={styles.input}
                    value={userData.name}
                    onChangeText={(value) => updateUserData('name', value)}
                    placeholderTextColor="#999"
                  />
                  <TextInput
                    placeholder="Mobile Number"
                    style={styles.input}
                    value={userData.mobile}
                    onChangeText={(value) => updateUserData('mobile', value)}
                    keyboardType="phone-pad"
                    placeholderTextColor="#999"
                  />
                </>
              )}

              <TextInput
                placeholder="Email"
                style={styles.input}
                value={userData.email}
                onChangeText={(value) => updateUserData('email', value)}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor="#999"
              />
              <TextInput
                placeholder="Password"
                style={styles.input}
                value={userData.password}
                onChangeText={(value) => updateUserData('password', value)}
                secureTextEntry
                placeholderTextColor="#999"
              />
            </>
          ) : (
            <>
              {authMode === 'signup' && (
                <>
                  <TextInput
                    placeholder="Hospital Name"
                    style={styles.input}
                    value={hospitalData.name}
                    onChangeText={(value) => updateHospitalData('name', value)}
                    placeholderTextColor="#999"
                  />
                  <TextInput
                    placeholder="Address"
                    style={[styles.input, { height: 60 }]}
                    value={hospitalData.address}
                    onChangeText={(value) => updateHospitalData('address', value)}
                    multiline
                    placeholderTextColor="#999"
                  />
                </>
              )}

              <TextInput
                placeholder="Email"
                style={styles.input}
                value={hospitalData.email}
                onChangeText={(value) => updateHospitalData('email', value)}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor="#999"
              />
              <TextInput
                placeholder="Password"
                style={styles.input}
                value={hospitalData.password}
                onChangeText={(value) => updateHospitalData('password', value)}
                secureTextEntry
                placeholderTextColor="#999"
              />
            </>
          )}

          <TouchableOpacity
            style={styles.button}
            onPress={authMode === 'login' ? handleLogin : handleSignup}
            activeOpacity={0.85}
          >
            <Ionicons
              name={authMode === 'login' ? 'log-in-outline' : 'person-add-outline'}
              size={22}
              color="#fff"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.buttonText}>
              {authMode === 'login' ? 'Login' : 'Sign Up'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
            style={styles.switchBox}
            activeOpacity={0.7}
          >
            <Text style={styles.switchText}>
              {authMode === 'login'
                ? "Don't have an account? "
                : 'Already have an account? '}
              <Text style={styles.switchTextBold}>
                {authMode === 'login' ? 'Sign Up' : 'Login'}
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FF3B30',
    marginTop: 8,
    letterSpacing: 1,
  },
  authBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 18,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  input: {
    height: 44,
    borderColor: '#FF3B30',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 14,
    backgroundColor: '#FAFAFA',
    fontSize: 16,
    color: '#222',
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFF5F5',
    borderRadius: 10,
    marginBottom: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  toggleButtonActive: {
    backgroundColor: '#FF3B30',
  },
  toggleButtonText: {
    color: '#FF3B30',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 6,
  },
  toggleButtonTextActive: {
    color: '#fff',
  },
  button: {
    flexDirection: 'row',
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 17,
    letterSpacing: 0.5,
  },
  switchBox: {
    marginTop: 10,
    alignItems: 'center',
  },
  switchText: {
    color: '#444',
    fontSize: 15,
  },
  switchTextBold: {
    color: '#FF3B30',
    fontWeight: 'bold',
  },
});