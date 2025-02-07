import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import SOSAudioRecorder from './src/Transcript';
const Stack = createStackNavigator();

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