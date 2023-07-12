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

    // Last keep alive message
    this.keepAlive = 0;

    // Message stream
    this.stream = null;

    // Register flow cards
    this.registerFlowCards();

    this.homey.on('unload', () => this.onUninit());

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
  | Stream functions
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
      // Get client
      client = this.getFirstSavedOAuth2Client();
      if (blank(client)) return;

      // Get access token
      const token = client.getToken().access_token;
      if (blank(token)) return;

      // Register timer
      await this.registerTimer();

      // Set abort controller
      this.controller = new AbortController();

      // Initiate stream
      this.stream = await fetch(Homey.env.TRACTIVE_CHANNEL_URL, {
        method: 'POST',
        signal: this.controller.signal,
        headers: {
          'X-Tractive-Client': Homey.env.CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      });

      for await (const chunk of this.stream.body) {
        const body = chunk.toString();
        if (blank(body)) return;

        const data = JSON.parse(body);

        // Keep alive message
        if (data.message === 'keep-alive') {
          this.keepAlive = data.keepAlive;
          continue;
        }

        this.log('[Stream] Received', body);

        this.homey.emit(data.message, data);
      }

      this.log('[Stream] Registered');
    } catch (err) {
      this.error('[Stream]', err.toString());

      this.stream = null;
    } finally {
      client = null;
    }
  }

  // Unregister stream
  async unregisterStream() {
    if (!this.stream) return;

    this.log('[Stream] Unregistering...');

    if (this.controller && !this.controller.aborted) {
      this.controller.abort();
      this.controller = null;
    }

    this.stream = null;

    this.log('[Stream] Unregistered');
  }

  /*
  | Support functions
  */

  // Check stream
  async checkStream() {
    if (this.stream) return;

    this.log('[Stream] Reconnecting...');

    await this.registerStream();
  }

  /*
  | Flow card functions
  */

  // Register flow cards
  registerFlowCards() {
    this.log('Registering flow cards...');

    this.registerActionFlowCards();
    this.registerConditionFlowCards();
    this.registerDeviceTriggerFlowCards();

    this.log('Flow cards registered');
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
  }

  // Register device trigger flow cards
  registerDeviceTriggerFlowCards() {
    // ... When tracker state changed to ...
    this.homey.flow.getDeviceTriggerCard('tracker_state_changed').registerRunListener(async ({ device, state }) => {
      return device.getCapabilityValue('tracker_state') === state;
    });
  }

  /*
  | Timer functions
  */

  // Register timer
  async registerTimer() {
    if (this.checkTimer) return;

    this.checkTimer = this.homey.setInterval(this.checkStream.bind(this), (1000 * 10));

    this.log('Timer registered');
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
