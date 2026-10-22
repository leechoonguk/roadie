/**
 * The window's entry point: the React Native app itself, rendered by
 * react-native-web, plus the tray's requests applied to the speaker.
 */
import { AppRegistry } from 'react-native';

import App from '../../../App';
import { marshallBle } from './marshallBle';

AppRegistry.registerComponent('Roadie', () => App);
AppRegistry.runApplication('Roadie', { rootTag: document.getElementById('root') });

// The speaker's read-back flows to the screen, which then republishes, so the
// tray settles on the value the speaker actually stored. A failure reaches the
// screen as a device failure; nothing is left to handle here.
window.roadie.onControl(({ identifier, action }) => {
  marshallBle.applyStep(identifier, action).catch(() => undefined);
});
