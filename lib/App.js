/* eslint-disable camelcase */

'use strict';

const { OAuth2App } = require('homey-oauth2app');
const { Log } = require('homey-log');
const AbortController = require('abort-controller');
const fetch = require('node-fetch');
const Homey = require('homey');
const { blank } = require('./Utils');
const Client = require('./Client');

class App extends OAuth2App {

  static OAUTH2_CLIENT = Client;

  /*
  | Application events
  */

  // Application initialized
  async onOAuth2Init() {
    // Sentry logging
    this.homeyLog = new Log({ homey: this.homey });

    this.homey.on('unload', () => this.onUninit());

    // Register flow cards
    this.registerFlowCards();

    this.log('Initialized');
  }

  // Application destroyed
  async onUninit() {
    // Unregister timer
    this.unregisterTimer();

    // Unregister stream
    await this.unregisterStream();

    this.log('Destroyed');
  }

  /*
  | Stream functions
  */

  // Check stream
  async checkStream() {
    try {
      await this.getSavedOAuth2Devices();
      await this.registerStream();
    } catch (err) {
      this.unregisterStream().catch(this.error);
    }
  }

  // Register message stream
  async registerStream() {
    if (this.stream) return;
    this.stream = 'register';

    let client;

    try {
      // Register timer
      this.registerTimer();

      // Get client
      client = await this.getSavedOAuth2Client();

      this.log('[Stream] Registering');

      // Get access token
      const token = client.getToken().access_token || null;
      if (blank(token)) throw new Error('No OAuth2 Token Found');

      // Set abort controller
      this.controller = new AbortController();

      // Initiate stream
      const response = await fetch(Homey.env.TRACTIVE_CHANNEL_URL, {
        method: 'POST',
        signal: this.controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Tractive-Client': Homey.env.CLIENT_ID,
        },
      });

      if (!response.ok) {
        const err = new Error(`Failed HTTP response (${response.status})`);
        err.status = response.status;
        err.statusText = response.statusText;

        throw err;
      }

      this.stream = response.body;

      this.stream
        .on('data', this.onStreamMessage.bind(this))
        .on('close', this.onStreamClosed.bind(this));

      this.log('[Stream] Registered');
    } catch (err) {
      // Refresh token when unauthorized
      if (err.status === 401) {
        this.log('[Stream] Refresh oAuth token (401)');

        client.refreshToken().catch(this.error);
      } else if (err.message !== 'No OAuth2 Client Found') {
        this.error('[Stream]', err.toString());
      }

      await this.unregisterStream();
    } finally {
      client = null;
    }
  }

  // Unregister stream
  async unregisterStream() {
    if (!this.stream) return;

    // Stream was registering
    if (this.stream === 'register') {
      this.stream = null;

      return;
    }

    try {
      this.log('[Stream] Unregistering');

      // Abort request
      if (this.controller) {
        if (!this.controller.aborted) {
          this.log('[Stream] Abort request');

          this.controller.abort();
        }

        this.controller = null;
      }

      // Destroy stream
      if (!this.stream.destroyed) {
        this.stream.destroy();
      }
    } catch (err) {
      this.error('[Stream]', err.toString());
    } finally {
      this.stream = null;

      this.log('[Stream] Unregistered');
    }
  }

  /*
  | Stream events
  */

  // Stream connection closed
  onStreamClosed(err) {
    this.stream = null;

    let msg = '[Stream] Connection closed';
    if (err) msg += ` due to error "${err}"`;

    this.log(msg);
  }

  // Stream message received
  async onStreamMessage(buffer) {
    let body;
    let data;

    body = Buffer.from(buffer).toString('utf8');
    if (blank(body)) return;

    try {
      data = JSON.parse(body);
    } catch (err) {
      this.error('[Stream] Invalid body:', body);
      data = {};
    }

    // Update message
    if (data.message) {
      this.homey.emit('update', data);
    }

    data = null;
    body = null;
  }

  /*
  | Flow card functions
  */

  // Register flow cards
  registerFlowCards() {
    this.log('[FlowCards] Registering');

    this.registerGlobalFlowCards();
    this.registerActionFlowCards();
    this.registerConditionFlowCards();
    this.registerDeviceTriggerFlowCards();
    this.registerArgumentAutocompleteListeners();

    this.log('[FlowCards] Registered');
  }

  // Register global flow cards
  registerGlobalFlowCards() {
    this.geofenceConditionCard = this.homey.flow.getConditionCard('geofence');
    this.geofenceTriggerCard = this.homey.flow.getDeviceTriggerCard('geofence_changed');
    this.powerSavingZoneConditionCard = this.homey.flow.getConditionCard('power_saving_zone');
    this.powerSavingZoneTriggerCard = this.homey.flow.getDeviceTriggerCard('power_saving_zone_changed');
  }

  // Register action flow cards
  registerActionFlowCards() {
    // ... then turn off sound ...
    this.homey.flow.getActionCard('buzzer_control_false').registerRunListener(async ({ device }) => {
      await device.setBuzzer(false);
    });

    // ... then turn on sound ...
    this.homey.flow.getActionCard('buzzer_control_true').registerRunListener(async ({ device }) => {
      await device.setBuzzer(true);
    });

    // ... then turn off light ...
    this.homey.flow.getActionCard('led_control_false').registerRunListener(async ({ device }) => {
      await device.setLight(false);
    });

    // ... then turn on light ...
    this.homey.flow.getActionCard('led_control_true').registerRunListener(async ({ device }) => {
      await device.setLight(true);
    });

    // ... then stop LIVE Tracking ...
    this.homey.flow.getActionCard('live_tracking_false').registerRunListener(async ({ device }) => {
      await device.setLive(false);
    });

    // ... then start LIVE Tracking ...
    this.homey.flow.getActionCard('live_tracking_true').registerRunListener(async ({ device }) => {
      await device.setLive(true);
    });
  }

  // Register condition flow cards
  registerConditionFlowCards() {
    // ... and battery state is ...
    this.homey.flow.getConditionCard('battery_state').registerRunListener(async ({ device, battery_state }) => {
      return device.getCapabilityValue('battery_state') === battery_state;
    });

    // ... and sound is on ...
    this.homey.flow.getConditionCard('buzzer_control').registerRunListener(async ({ device }) => {
      return device.getCapabilityValue('buzzer_control') === true;
    });

    // ... and is charging...
    this.homey.flow.getConditionCard('charging_state').registerRunListener(async ({ device }) => {
      return device.getCapabilityValue('charging_state') === true;
    });

    // ... and geofence is ...
    this.geofenceConditionCard.registerRunListener(async ({ device, geofence }) => {
      return device.getCapabilityValue('geofence') === geofence.name.trim();
    });

    // ... and light is on ...
    this.homey.flow.getConditionCard('led_control').registerRunListener(async ({ device }) => {
      return device.getCapabilityValue('led_control') === true;
    });

    // ... and LIVE Tracking is started ...
    this.homey.flow.getConditionCard('live_tracking').registerRunListener(async ({ device }) => {
      return device.getCapabilityValue('live_tracking') === true;
    });

    // ... and location source is ...
    this.homey.flow.getConditionCard('location_source').registerRunListener(async ({ device, location_source }) => {
      return device.getCapabilityValue('location_source') === location_source;
    });

    // ... and in Power Saving zone ...
    this.homey.flow.getConditionCard('in_power_saving_zone').registerRunListener(async ({ device }) => {
      return device.getCapabilityValue('in_power_saving_zone') === true;
    });

    // ... and tracker state is ...
    this.homey.flow.getConditionCard('tracker_state').registerRunListener(async ({ device, tracker_state }) => {
      return device.getCapabilityValue('tracker_state') === tracker_state;
    });

    // ... and Power Saving Zone is ...
    this.powerSavingZoneConditionCard.registerRunListener(async ({ device, power_saving_zone }) => {
      return device.getCapabilityValue('power_saving_zone') === power_saving_zone.name.trim();
    });
  }

  // Register device trigger flow cards
  registerDeviceTriggerFlowCards() {
    // ... When battery state changed to ...
    this.homey.flow.getDeviceTriggerCard('battery_state_changed').registerRunListener(async ({ device, battery_state }) => {
      return device.getCapabilityValue('battery_state') === battery_state;
    });

    // ... When geofence changed to ...
    this.geofenceTriggerCard.registerRunListener(async ({ device, geofence }) => {
      return device.getCapabilityValue('geofence') === geofence.name.trim();
    });

    // ... When location source changed to ...
    this.homey.flow.getDeviceTriggerCard('location_source_changed').registerRunListener(async ({ device, location_source }) => {
      return device.getCapabilityValue('location_source') === location_source;
    });

    // ... When Power Saving Zone changed to ...
    this.powerSavingZoneTriggerCard.registerRunListener(async ({ device, power_saving_zone }) => {
      return device.getCapabilityValue('power_saving_zone') === power_saving_zone.name.trim();
    });

    // ... When tracker state changed to ...
    this.homey.flow.getDeviceTriggerCard('tracker_state_changed').registerRunListener(async ({ device, tracker_state }) => {
      return device.getCapabilityValue('tracker_state') === tracker_state;
    });
  }

  // Register argument autocomplete listeners
  registerArgumentAutocompleteListeners() {
    this.geofenceConditionCard.registerArgumentAutocompleteListener('geofence', this.geofenceAutocomplete.bind(this));
    this.geofenceTriggerCard.registerArgumentAutocompleteListener('geofence', this.geofenceAutocomplete.bind(this));
    this.powerSavingZoneConditionCard.registerArgumentAutocompleteListener('power_saving_zone', this.powerSavingZoneAutocomplete.bind(this));
    this.powerSavingZoneTriggerCard.registerArgumentAutocompleteListener('power_saving_zone', this.powerSavingZoneAutocomplete.bind(this));
  }

  /*
  | Timer functions
  */

  // Register timer
  registerTimer() {
    if (this.checkTimer) return;

    const interval = 1000 * 10;
    this.checkTimer = this.homey.setInterval(this.checkStream.bind(this), interval);

    this.log('[Timer] Registered');
  }

  // Unregister timer
  unregisterTimer() {
    if (!this.checkTimer) return;

    this.homey.clearInterval(this.checkTimer);
    this.checkTimer = null;

    this.log('[Timer] Unregistered');
  }

  /*
  | Support functions
  */

  async geofenceAutocomplete(query, args) {
    const fences = args.device.getStoreValue('geofences');
    const results = [];

    for (const fence of fences) {
      results.push({
        name: fence.name,
        id: fence._id,
      });
    }

    // filter based on the query
    return results.filter((result) => {
      return result.name.toLowerCase().includes(query.toLowerCase().trim());
    });
  }

  async powerSavingZoneAutocomplete(query, args) {
    const zones = args.device.getStoreValue('power_saving_zones');
    const results = [];

    for (const [id, name] of Object.entries(zones)) {
      results.push({ name, id });
    }

    // filter based on the query
    return results.filter((result) => {
      return result.name.toLowerCase().includes(query.toLowerCase().trim());
    });
  }

  // Return OAuth2 devices
  async getSavedOAuth2Devices() {
    const sessions = this.getSavedOAuth2Sessions();

    if (blank(sessions)) {
      throw new Error('No OAuth2 Session Found');
    }

    const sessionId = Object.keys(sessions)[0];
    const devices = await this.getOAuth2Devices({ sessionId });

    if (blank(devices)) {
      throw new Error('No OAuth2 Devices Found');
    }

    return devices;
  }

  // Return OAuth2 client
  async getSavedOAuth2Client() {
    try {
      return this.getFirstSavedOAuth2Client();
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return this.getFirstSavedOAuth2Client();
    }
  }

}

module.exports = App;
