/**
 * The window's entry point: the React Native app itself, rendered by
 * react-native-web, plus the tray's requests applied to the speaker.
 */
import { AppRegistry } from 'react-native';

import App from '../../../App';
import { marshallBle } from './marshallBle';

AppRegistry.registerComponent('Roadie', () => App);
AppRegistry.runApplication('Roadie', { rootTag: document.getElementById('root') });

// The speaker's read-back after each write flows to the screen, which then
// republishes, so the tray settles on the value the speaker actually stored.
window.roadie.onControl(request => {
  if (request.kind === 'volume') {
    marshallBle.setVolume(request.identifier, request.level);
  } else {
    marshallBle.setEQ(request.identifier, request.bass, request.treble);
  }
});
