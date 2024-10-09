'use strict';

const { OAuth2Driver } = require('homey-oauth2app');
const { TrackerCapabilities } = require('./Enums');
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

    const devices = await oAuth2Client.discoverTrackers();

    if (blank(devices)) return [];

    return devices.map((device) => this.getDeviceData(device)).filter((e) => e);
  }

  /**
   * Repair device.
   *
   * @param {PairSession} socket
   * @param {Device} device
   */
  onRepair(socket, device) {
    this.log('[Repair] Session connected');

    let client;

    let {
      OAuth2SessionId,
      OAuth2ConfigId,
    } = device.getStore();

    if (!OAuth2SessionId) {
      OAuth2SessionId = OAuth2Util.getRandomId();
    }

    if (!OAuth2ConfigId) {
      OAuth2ConfigId = this.getOAuth2ConfigId();
    }

    try {
      client = this.homey.app.getOAuth2Client({
        sessionId: OAuth2SessionId,
        configId: OAuth2ConfigId,
      });
    } catch (err) {
      client = this.homey.app.createOAuth2Client({
        sessionId: OAuth2SessionId,
        configId: OAuth2ConfigId,
      });
    }

    const onLogin = async ({ username, password }) => {
      this.log('[Repair] Login');

      await client.getTokenByCredentials({ username, password });
      const session = await client.onGetOAuth2SessionInformation();

      OAuth2SessionId = session.id;
      const token = client.getToken();
      const { title } = session;
      client.destroy();

      // Replace the temporary client by the final one and save it
      client = this.homey.app.createOAuth2Client({
        sessionId: session.id,
        configId: OAuth2ConfigId,
      });

      client.setTitle({ title });
      client.setToken({ token });

      await client.save();

      // Set client for OAuth2 devices
      await this.homey.app.setClientOAuth2Devices(client, OAuth2SessionId, OAuth2ConfigId);

      return true;
    };

    const onDisconnect = async () => {
      this.log('[Repair] Session disconnected');
    };

    socket
      .setHandler('login', onLogin)
      .setHandler('disconnect', onDisconnect);
  }

  // Return data to create the device
  getDeviceData(device) {
    const data = {
      name: device._id,
      data: {
        id: device._id,
      },
      settings: {
        product_name: device.product_name,
        model_name: device.model_name,
      },
      capabilities: this.getPairCapabilities(device),
    };

    this.log('Device found', JSON.stringify(data));

    return data;
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
