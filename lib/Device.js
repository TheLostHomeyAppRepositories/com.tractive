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
    // Unregister event listener
    this.homey.off('update', this.onMessage);

    // Unregister timers
    await this.unregisterTimers();

    this.log('Deleted');
  }

  // Device initialized
  async onOAuth2Init() {
    this.keepAlive = Math.floor(Date.now() / 1000);

    // Register event listener
    this.homey.on('update', this.onMessage.bind(this));

    // Register stream
    await this.homey.app.registerStream();

    // Register timers
    await this.registerTimers();

    this.log('Initialized');
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
    if (blank(raw)) return;

    let parsed;
    let data;

    try {
      parsed = await this.parseData(raw);
      data = await this.processData(parsed);

      await this.syncCapabilities(data);
      await this.triggerFlows(data);
      await this.syncSettings(data);
      await this.syncCapabilityValues(data);
      await this.syncWarning(data);

      this.setAvailable().catch(this.error);
    } catch (err) {
      this.error(err);
      this.error('[Sync]', err.message);
      this.setUnavailable(err.message).catch(this.error);
    } finally {
      parsed = null;
      data = null;
    }
  }

  // Set capability values
  async syncCapabilityValues(data) {
    for (const [name, value] of Object.entries(data)) {
      if (this.hasCapability(name)) {
        this.setCapabilityValue(name, value).catch(this.error);
      }
    }

    data = null;
  }

  // Set settings
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
    // Wait for driver
    await this.driver.ready();

    let device = this;

    // Location changed trigger
    if ('address' in data) {
      this.driver.locationChangedTrigger.trigger(device, data.address).then().catch(device.error);
    }

    // In geofence trigger
    if (this.hasCapability('in_geofence') && 'in_geofence' in data) {
      const currentlyInFence = this.getCapabilityValue('in_geofence');

      // Entered geofence
      if (data.in_geofence && !currentlyInFence) {
        this.driver.inGeofenceTrueTrigger.trigger(device, { geofence: data.geofence }).then().catch(device.error);

        // Safe zone
        if (data.geofence_type === 'safe') {
          this.driver.inSafeZoneTrueTrigger.trigger(device, { geofence: data.geofence }).then().catch(device.error);
        }

        // Danger zone
        if (data.geofence_type === 'danger') {
          this.driver.inDangerZoneTrueTrigger.trigger(device, { geofence: data.geofence }).then().catch(device.error);
        }
      }

      // Left geofence
      if (!data.in_geofence && currentlyInFence) {
        const currentFence = this.getCapabilityValue('geofence');

        this.driver.inGeofenceFalseTrigger.trigger(device, { geofence: currentFence }).then().catch(device.error);
      }
    }

    // In Power Saving Zone trigger
    if (this.hasCapability('in_power_saving_zone')) {
      if (data.in_power_saving_zone && !this.getCapabilityValue('in_power_saving_zone')) {
        this.driver.inPowerSavingZoneTrueTrigger.trigger(device, { power_saving_zone: data.power_saving_zone }).then().catch(device.error);
      }
    }

    device = null;
  }

  /*
  | Timer functions
  */

  // Register timers
  async registerTimers() {
    if (!this.keepAliveTimer) {
      this.keepAliveTimer = this.homey.setInterval(this.checkKeepAlive.bind(this), (1000 * 15));
    }

    if (!this.syncTimer) {
      this.syncTimer = this.homey.setInterval(this.sync.bind(this), (1000 * 60 * 30));
    }

    this.log('[Timers] Registered');
  }

  // Unregister timers
  async unregisterTimers() {
    if (this.keepAliveTimer) {
      this.homey.clearInterval(this.keepAliveTimer);
    }

    if (this.syncTimer) {
      this.homey.clearInterval(this.syncTimer);
    }

    this.keepAliveTimer = null;
    this.syncTimer = null;

    this.log('[Timers] Unregistered');
  }

  /*
  | Support functions
  */

  // Check keep alive
  checkKeepAlive() {
    const current = Math.floor(Date.now() / 1000);
    const difference = current - this.keepAlive;

    // <= 10 seconds ago
    if (difference <= 10) {
      if (!this.getAvailable()) {
        this.setAvailable().catch(this.error);
      }

      return;
    }

    if (!this.getAvailable()) return;

    // +- 1 minute ago
    if (difference >= 60 && difference <= 75) {
      this.error(`Last message received ${difference} seconds ago`);

      this.homey.app.unregisterStream().catch(this.error);

      return;
    }

    // > 1 minute
    this.setUnavailable(this.homey.__('errors.restart_app')).catch(this.error);
  }

}

module.exports = Device;
