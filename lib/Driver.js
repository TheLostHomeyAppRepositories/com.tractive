'use strict';

const { OAuth2Driver } = require('homey-oauth2app');
const { blank } = require('./Utils');

class Driver extends OAuth2Driver {

  /*
  | Driver events
  */

  // Driver initialized
  async onOAuth2Init() {
    // Register device trigger flow cards
    this.registerDeviceTriggerFlowCards();

    this.log('Initialized');
  }

  // Driver destroyed
  async onUninit() {
    this.log('Destroyed');
  }

  /*
  | Pairing functions
  */

  // Pair devices
  async onPairListDevices({ oAuth2Client }) {
    this.log(`Pairing ${this.id}s`);

    const devices = await this.getPairDevices({ oAuth2Client });

    if (blank(devices)) return [];

    return devices.map((device) => this.getDeviceData(device)).filter((e) => e);
  }

  // Return data to create the device
  getDeviceData(device) {
    const data = {
      name: device._id,
      data: {
        id: device._id,
      },
      settings: this.getPairSettings(device),
      capabilities: this.getPairCapabilities(device),
    };

    this.log('Device found', JSON.stringify(data));

    return data;
  }

  /*
  | Flow card functions
  */

  // Register device trigger flow cards
  registerDeviceTriggerFlowCards() {
    this.locationChangedTrigger = this.homey.flow.getDeviceTriggerCard('location_changed');
    this.inDangerZoneTrueTrigger = this.homey.flow.getDeviceTriggerCard('in_danger_zone_true');
    this.inGeofenceFalseTrigger = this.homey.flow.getDeviceTriggerCard('in_geofence_false');
    this.inGeofenceTrueTrigger = this.homey.flow.getDeviceTriggerCard('in_geofence_true');
    this.inPowerSavingZoneTrueTrigger = this.homey.flow.getDeviceTriggerCard('in_power_saving_zone_true');
    this.inSafeZoneTrueTrigger = this.homey.flow.getDeviceTriggerCard('in_safe_zone_true');

    this.log('Device trigger flow cards registered');
  }

}

module.exports = Driver;
