import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SOSAudioRecorder from './src/Transcript';

const Stack = createNativeStackNavigator();

const App = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="sos">
        <Stack.Screen name="sos" component={SOSAudioRecorder} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;