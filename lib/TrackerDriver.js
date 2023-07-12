'use strict';

const Driver = require('./Driver');

class TrackerDriver extends Driver {

  /*
  | Pairing functions
  */

  // Return devices while pairing
  async getPairDevices({ oAuth2Client }) {
    return oAuth2Client.discoverTrackers();
  }

  // Return capabilities while pairing
  getPairCapabilities(device) {
    const caps = [
      'measure_battery',
      'charging_state',
      'tracker_state',
      'altitude',
      'speed',
    ];

    for (const name of device.capabilities) {
      if (name === 'BUZZER') caps.push('buzzer_control');
      if (name === 'LED') caps.push('led_control');
      if (name === 'LT') caps.push('live_tracking');
    }

    return caps;
  }

  // Return settings value while pairing
  getPairSettings(device) {
    return {
      model_number: device.model_number,
    };
  }

  // Return store value while pairing
  getPairStore(device) {
    return {
      tracker_id: device._id || null,
      pet_id: device.pet._id || null,
      user_id: device.user._id || null,
      subscription_id: device.subscription._id || null,
    };
  }

}

module.exports = TrackerDriver;
