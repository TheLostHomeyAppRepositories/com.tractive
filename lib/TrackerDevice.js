'use strict';

const Device = require('./Device');
const { filled } = require('./Utils');

class TrackerDevice extends Device {

  /*
  | Device events
  */

  // Device deleted
  async onOAuth2Deleted() {
    // Unregister event listener
    this.log('Unregister event listener');
    this.homey.off('tracker_status', this.onMessage);

    await super.onOAuth2Deleted();
  }

  // Device initialized
  async onOAuth2Init() {
    // Register event listener
    this.log('Register event listener');
    this.homey.on('tracker_status', this.onMessage.bind(this));

    // Register stream
    await this.homey.app.registerStream();
  }

  /*
  | Synchronization functions
  */

  // Return parsed channel data
  async parseChannelData(msg) {
    const data = {};

    // Position
    if ('position' in msg) {
      const { position } = msg;

      // Altitude (m)
      if ('altitude' in position) {
        data.altitude = Number(position.altitude);
      }

      // Latitude / longitude
      if ('latlong' in position) {
        data.latitude = Number(position.latlong[0]);
        data.longitude = Number(position.latlong[1]);
      }

      // Speed (m/s)
      if ('speed' in position) {
        data.speed = Number(position.speed);
      }

      // Last updated position time
      if ('time_rcvd' in position) {
        data.position_time = Number(position.time_rcvd);
      }
    }

    // Buzzer control
    if ('buzzer_control' in msg) {
      data.buzzer_control = msg.buzzer_control.active;
    }

    // Charging state
    if ('charging_state' in msg) {
      data.charging_state = msg.charging_state === 'CHARGING';
    }

    // Hardware
    if ('hardware' in msg) {
      const { hardware } = msg;

      if ('battery_level' in hardware) {
        data.measure_battery = Number(hardware.battery_level);
      }
    }

    // LED control
    if ('led_control' in msg) {
      data.led_control = msg.led_control.active;
    }

    // LIVE Tracking
    if ('live_tracking' in msg) {
      data.live_tracking = msg.live_tracking.active;
    }

    // Tracker state
    if ('tracker_state' in msg) {
      data.tracker_state = msg.tracker_state.toLowerCase();
    }

    // Tracker state reason
    if ('tracker_state_reason' in msg) {
      const reason = msg.tracker_state_reason.toLowerCase();

      if (reason === 'power_saving') {
        data.tracker_state = 'power_saving';
      }

      data.tracker_state_reason = reason;
    }

    msg = null;

    return data;
  }

  // Stream message received
  async onMessage(data) {
    if (data.tracker_id !== this.getData().id) return;

    await this.handleSyncData(data);
  }

  // Set warning message
  async syncWarning(data) {
    // Tracker state reason
    if (filled(data.tracker_state_reason)) {
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
