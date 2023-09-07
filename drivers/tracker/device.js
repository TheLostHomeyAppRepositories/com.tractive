'use strict';

const { TrackerCapabilities, TrackerNamesBySku, TrackerNames } = require('../../lib/Enums');
const Device = require('../../lib/Device');
const { filled, blank } = require('../../lib/Utils');

class TrackerDevice extends Device {

  /*
  | Device events
  */

  // Device initialized
  async onOAuth2Init() {
    // Synchronize
    await this.sync();

    // Initiate device
    await super.onOAuth2Init();
  }

  /*
  | Synchronization functions
  */

  // Return parsed data
  async parseData(raw) {
    const data = {};

    // Battery state
    if ('battery_state' in raw) {
      data.battery_state = raw.battery_state.toLowerCase();
    }

    // Buzzer control
    if ('buzzer_control' in raw) {
      data.buzzer_control = raw.buzzer_control.active;
    }

    // Charging state
    if ('charging_state' in raw) {
      data.charging_state = raw.charging_state === 'CHARGING';
    }

    // Hardware
    if ('hardware' in raw) {
      const { hardware } = raw;

      if ('battery_level' in hardware) {
        data.measure_battery = Number(hardware.battery_level);
      }
    }

    // LED control
    if ('led_control' in raw) {
      data.led_control = raw.led_control.active;
    }

    // LIVE Tracking
    if ('live_tracking' in raw) {
      data.live_tracking = raw.live_tracking.active;
    }

    // Model and product
    if ('model_number' in raw) {
      data.model_name = raw.hw_edition ? `${raw.model_number}_${raw.hw_edition}` : raw.model_number;
      data.product_name = (raw.sku ? TrackerNamesBySku[raw.sku] : TrackerNames[data.model_name]) || '-';
    }

    // Position
    if ('position' in raw) {
      const { position } = raw;

      // Altitude (m)
      if ('altitude' in position) {
        data.altitude = Number(position.altitude);
      }

      // Latitude / longitude
      if ('latlong' in position) {
        const lat = this.getCapabilityValue('latitude');
        const long = this.getCapabilityValue('longitude');

        data.latitude = Number(position.latlong[0]);
        data.longitude = Number(position.latlong[1]);

        if (lat !== data.latitude || long !== data.longitude) {
          const address = await this.oAuth2Client.getAddress(data.latitude, data.longitude);

          data.address = {
            house_number: (address.house_number || '').toLowerCase(),
            zip_code: (address.zip_code || '').toUpperCase(),
            country: (address.country || '').toUpperCase(),
            street: (address.street || '').toLowerCase(),
            city: (address.city || '').toLowerCase(),
          };
        }
      }

      // Speed (m/s)
      data.speed = Number(position.speed || 0);
    }

    // Power Saving Zone
    data.power_saving_zone = await this.getPowerSavingZoneName(raw.power_saving_zone_id || null);
    data.in_power_saving_zone = filled(raw.power_saving_zone_id || null);

    // Tracker state
    const state = raw.tracker_state || raw.state || null;

    if (filled(state)) {
      data.tracker_state = state.toLowerCase();
    }

    // Tracker state reason
    const stateReason = raw.tracker_state_reason || raw.state_reason || null;

    if (filled(stateReason)) {
      const reason = stateReason.toLowerCase();

      if (reason === 'power_saving') {
        data.tracker_state = 'power_saving';
      }

      data.tracker_state_reason = reason;
    }

    raw = null;

    return data;
  }

  // Stream message received
  async onMessage(data) {
    if (blank(data)) return;

    // Keep alive message
    if (data.message === 'keep-alive') {
      this.keepAlive = data.keepAlive;

      return;
    }

    // Tracker status message
    if (data.message === 'tracker_status') {
      if (data.tracker_id !== this.getData().id) return;

      this.log('[Stream] Received:', JSON.stringify(data));

      // Handle message
      this.handleSyncData(data).catch(this.error);
    }
  }

  // Synchronize
  async sync() {
    let data;

    try {
      const { id } = this.getData();

      // Get tracker data from API
      data = await this.oAuth2Client.getTracker(id);

      this.log('[Sync] Received:', JSON.stringify(data));

      // Handle data
      await this.handleSyncData(data);
    } catch (err) {
      this.error('[Sync]', err.message);
    } finally {
      data = null;
    }
  }

  // Synchronize capabilites
  async syncCapabilities(data) {
    if (blank(data.capabilities)) return;

    for (const [name, capabilities] of Object.entries(TrackerCapabilities)) {
      for (const capability of capabilities) {
        // Add missing capabilities
        if (data.capabilities.includes(name) && !this.hasCapability(capability)) {
          this.addCapability(capability).catch(this.error);
          this.log(`Added '${capability}' capability`);

          continue;
        }

        // Remove capabilities
        if (!data.capabilities.includes(name) && this.hasCapability(capability)) {
          this.removeCapability(capability).catch(this.error);
          this.log(`Removed '${capability}' capability`);
        }
      }
    }
  }

  // Set warning message
  async syncWarning(data) {
    // Tracker state reason
    if ('tracker_state_reason' in data) {
      const reasons = ['out_of_battery', 'shutdown_by_user'];

      if (reasons.includes(data.tracker_state_reason)) {
        return this.setWarning(this.homey.__(`state.${data.tracker_state_reason}`));
      }
    }

    // Remove warning
    return this.unsetWarning();
  }

  /*
  | Device actions
  */

  async getPowerSavingZoneName(id) {
    if (blank(id)) return '-';

    const zone = await this.oAuth2Client.getPowerSavingZone(id);

    return zone.name || '-';
  }

  async setBuzzer(enabled) {
    if (enabled && this.getCapabilityValue('tracker_state') === 'power_saving') {
      throw new Error(this.homey.__('errors.power_saving_sound'));
    }

    return this.oAuth2Client.setBuzzer(this.getData().id, enabled);
  }

  async setLight(enabled) {
    if (enabled && this.getCapabilityValue('tracker_state') === 'power_saving') {
      throw new Error(this.homey.__('errors.power_saving_light'));
    }

    return this.oAuth2Client.setLight(this.getData().id, enabled);
  }

  async setLive(enabled) {
    return this.oAuth2Client.setLive(this.getData().id, enabled);
  }

}

module.exports = TrackerDevice;
