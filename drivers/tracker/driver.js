'use strict';

const Driver = require('../../lib/Driver');
const { TrackerCapabilities } = require('../../lib/Enums');

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
      'tracker_state',
      'charging_state',
      'battery_state',
      'in_geofence',
      'geofence',
    ];

    for (const [name, capabilities] of Object.entries(TrackerCapabilities)) {
      if (device.capabilities.includes(name)) {
        for (const capability of capabilities) {
          caps.push(capability);
        }
      }
    }

    caps.push('location_source', 'altitude', 'speed', 'latitude', 'longitude');

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
    };
  }

}

module.exports = TrackerDriver;
