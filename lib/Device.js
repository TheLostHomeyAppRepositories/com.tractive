'use strict';

const { OAuth2Device } = require('homey-oauth2app');
const { filled, blank } = require('./Utils');

class Device extends OAuth2Device {

  /*
  | Device events
  */

  // Device added
  async onOAuth2Added() {
    this.log('Added');
  }

  // Device deleted
  async onOAuth2Deleted() {
    this.log('Deleted');
  }

  // Device initialized
  async onOAuth2Init() {
    this.log('Initialized');

    // Register stream
    this.homey.app.registerStream().catch(this.error);
  }

  // Device destroyed
  async onOAuth2Uninit() {
    this.log('Destroyed');
  }

  /*
  | Synchronization functions
  */

  // Handle sync data
  async handleSyncData(raw) {
    this.log('[Sync]', JSON.stringify(raw));

    let data;

    try {
      data = await this.parseChannelData(raw);
      if (blank(data)) return;

      await this.syncSettings(data);
      await this.syncCapabilities(data);
      await this.syncWarning(data);
      await this.triggerFlows(data);

      this.setAvailable().catch(this.error);
    } catch (err) {
      this.error('[Sync]', err.message);
      this.setUnavailable(err.message).catch(this.error);
    } finally {
      data = null;
      raw = null;
    }
  }

  // Set capabilities
  async syncCapabilities(data) {
    for (const name of this.getCapabilities()) {
      if (this.hasCapability(name) && filled(data[name])) {
        this.setCapabilityValue(name, data[name]).catch(this.error);
      }
    }

    data = null;
  }

  // Set new settings
  async syncSettings(data) {
    let settings = {};

    for (const [name, value] of Object.entries(this.getSettings())) {
      if (filled(data[name]) && data[name] !== value) {
        this.log(`Setting '${name}' is now '${data[name]}'`);

        settings[name] = data[name];
      }
    }

    if (filled(settings)) {
      this.setSettings(settings).catch(this.error);
    }

    data = null;
    settings = null;
  }

  /*
  | Flow functions
  */

  // Trigger flows based on new data
  async triggerFlows(data) {
    if (!data.address) return;

    // Wait for driver
    await this.driver.ready();

    let device = this;

    // Location changed trigger
    this.driver.locationTrigger
      .trigger(device, data.address)
      .then()
      .catch(device.error);

    device = null;
  }

}

module.exports = Device;
