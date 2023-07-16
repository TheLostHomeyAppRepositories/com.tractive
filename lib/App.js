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

    // Register flow cards
    this.registerFlowCards();

    this.homey.on('unload', () => this.onUninit.bind(this));

    this.log('Initialized');
  }

  // Application destroyed
  async onUninit() {
    // Unregister timer
    await this.unregisterTimer();

    // Unregister stream
    await this.unregisterStream();
  }

  /*
  | Stream functions and events
  */

  // Register message stream
  async registerStream() {
    if (this.stream) return;

    this.stream = 'register';
    this.log('[Stream] Registering...');

    // Wait one seconds
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let client;

    try {
      // Register timer
      await this.registerTimer();

      // Get client
      client = this.getFirstSavedOAuth2Client();
      if (blank(client)) throw new Error('No OAuth2 Client Found');

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
          'X-Tractive-Client': Homey.env.CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      });

      this.stream = response.body;

      this.stream
        .on('data', this.onStreamMessage.bind(this))
        .on('close', this.onStreamClosed.bind(this));

      this.log('[Stream] Registered...');
    } catch (err) {
      // Refresh token when unauthorized
      if (err.statusCode || 0 === 401) {
        this.log('[Stream] Refresh oAuth token');

        client.refreshToken().catch(this.error);
      } else if (err.message !== 'No OAuth2 Client Found') {
        this.error('[Stream]', err.toString());
      }

      this.unregisterStream().catch(this.error);
    } finally {
      client = null;
    }
  }

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

    body = buffer.toString().trim();
    if (blank(body)) return;

    try {
      data = JSON.parse(body);
    } catch (err) {
      data = {};
    }

    // Tracker update message
    if (data.message && data.message === 'tracker_status') {
      this.homey.emit(data.message, data);
    }

    data = null;
    body = null;
  }

  /*
  | Support functions
  */

  // Unregister stream
  async unregisterStream() {
    if (!this.stream) return;

    this.log('[Stream] Unregistering...');

    // Abort request
    if (this.controller && !this.controller.aborted) {
      this.log('[Stream] Abort request');

      this.controller.abort();
      this.controller = null;
    }

    // Destroy stream
    if (!this.stream.destroyed) {
      this.log('[Stream] Destroying...');
      this.stream.destroy();
      this.log('[Stream] Destroyed');
    }

    this.stream = null;

    this.log('[Stream] Unregistered');
  }

  // Check stream
  async checkStream() {
    if (this.stream) return;

    this.log('[Stream] Reconnecting...');
    this.registerStream().catch(this.error);
    this.log('[Stream] Reconnected');
  }

  /*
  | Flow card functions
  */

  // Register flow cards
  registerFlowCards() {
    this.log('[FlowCards] Registering...');

    this.registerActionFlowCards();
    this.registerConditionFlowCards();
    this.registerDeviceTriggerFlowCards();

    this.log('[FlowCards] Registered');
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

    // ... and light is on ...
    this.homey.flow.getConditionCard('led_control').registerRunListener(async ({ device }) => {
      return device.getCapabilityValue('led_control') === true;
    });

    // ... and LIVE Tracking is started ...
    this.homey.flow.getConditionCard('live_tracking').registerRunListener(async ({ device }) => {
      return device.getCapabilityValue('live_tracking') === true;
    });

    // ... and tracker state is ...
    this.homey.flow.getConditionCard('tracker_state').registerRunListener(async ({ device, tracker_state }) => {
      return device.getCapabilityValue('tracker_state') === tracker_state;
    });
  }

  // Register device trigger flow cards
  registerDeviceTriggerFlowCards() {
    // ... When battery state changed to ...
    this.homey.flow.getDeviceTriggerCard('battery_state_changed').registerRunListener(async ({ device, battery_state }) => {
      return device.getCapabilityValue('battery_state') === battery_state;
    });

    // ... When tracker state changed to ...
    this.homey.flow.getDeviceTriggerCard('tracker_state_changed').registerRunListener(async ({ device, tracker_state }) => {
      return device.getCapabilityValue('tracker_state') === tracker_state;
    });
  }

  /*
  | Timer functions
  */

  // Register timer
  async registerTimer() {
    if (this.checkTimer) return;

    this.checkTimer = this.homey.setInterval(this.checkStream.bind(this), (1000 * 7));

    this.log('[Timer] Registered');
  }

  // Unregister timer
  async unregisterTimer() {
    if (!this.checkTimer) return;

    this.homey.clearInterval(this.checkTimer);

    this.checkTimer = null;

    this.log('Timer unregistered');
  }

}

module.exports = App;
