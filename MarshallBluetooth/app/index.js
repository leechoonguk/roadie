/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerBackgroundTasks } from './src/native/backgroundTasks';

AppRegistry.registerComponent(appName, () => App);
registerBackgroundTasks();
