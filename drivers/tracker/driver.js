'use strict';

const Driver = require('../../lib/Driver');

class TrackerDriver extends Driver {

  /*
  | Driver events
  */

  // Driver initialized
  async onOAuth2Init() {
    this.locationTrigger = this.homey.flow.getDeviceTriggerCard('location_changed');

    super.onOAuth2Init().catch(this.error);
  }

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
      'tracker_state',
      'charging_state',
      'battery_state',
    ];

    for (const name of device.capabilities) {
      if (name === 'BUZZER') caps.push('buzzer_control');
      if (name === 'LED') caps.push('led_control');
      if (name === 'LT') caps.push('live_tracking');
    }

    caps.push('altitude', 'speed', 'latitude', 'longitude');

    return caps;
  }

  // Return settings value while pairing
  getPairSettings(device) {
    return {
      product_name: device.product_name,
      model_name: device.model_name,
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
