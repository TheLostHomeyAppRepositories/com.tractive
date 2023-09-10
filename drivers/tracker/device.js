'use strict';

const geo = require('geolib');
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
    this.log('Parse data');

    const data = {};

    // Battery state
    if ('battery_state' in raw) {
      data.battery_state = raw.battery_state.toLowerCase();
    }

    // Capabilities
    if ('capabilities' in raw) {
      data.capabilities = raw.capabilities;
    }

    // Buzzer control
    if ('buzzer_control' in raw) {
      data.buzzer_control = raw.buzzer_control.active;
    }

    // Charging state
    if ('charging_state' in raw) {
      data.charging_state = raw.charging_state === 'CHARGING';
    }

    // Geofences
    if ('geofences' in raw) {
      data.geofences = raw.geofences;
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

      // Sensor used
      if ('sensor_used' in position) {
        data.location_source = position.sensor_used.toLowerCase();
      }

      // Latitude / longitude
      if ('latlong' in position) {
        data.latlong = position.latlong;
      }

      // Speed (m/s)
      data.speed = Number(position.speed || 0);
    }

    // Power Saving Zones
    if ('power_saving_zones' in raw) {
      data.power_saving_zones = raw.power_saving_zones;
    }

    // Power Saving Zone ID
    data.power_saving_zone_id = raw.power_saving_zone_id || null;

    // Tracker state
    let state = raw.tracker_state || raw.state || null;

    if (filled(state)) {
      data.tracker_state = state.toLowerCase();
    }

    // Tracker state reason
    let stateReason = raw.tracker_state_reason || raw.state_reason || null;

    if (filled(stateReason)) {
      const reason = stateReason.toLowerCase();

      if (reason === 'power_saving') {
        data.tracker_state = 'power_saving';
      }

      data.tracker_state_reason = reason;
    }

    stateReason = null;
    state = null;
    raw = null;

    return data;
  }

  // Return processed data
  async processData(data) {
    this.log('Process data');

    // Save geofences
    if ('geofences' in data) {
      await this.saveGeofences(data.geofences);
    }

    // Save Power Saving Zones
    if ('power_saving_zones' in data) {
      await this.savePowerSavingZones(data.power_saving_zones);
    }

    // Power Saving Zone
    data.power_saving_zone = await this.getPowerSavingZoneName(data.power_saving_zone_id);
    data.in_power_saving_zone = filled(data.power_saving_zone_id);

    // Latitude / longitude
    if ('latlong' in data) {
      const lat = this.getCapabilityValue('latitude');
      const long = this.getCapabilityValue('longitude');

      const latitude = Number(data.latlong[0]);
      const longitude = Number(data.latlong[1]);

      if (lat !== latitude || long !== longitude) {
        // Address
        data.address = await this.oAuth2Client.getAddress(latitude, longitude);

        // Geofence
        let geofence = await this.getGeofence({ latitude, longitude });

        data.geofence = geofence.name;
        data.in_geofence = filled(geofence.name);
        data.geofence_type = geofence.fence_type;

        // Coordinates
        data.latitude = latitude;
        data.longitude = longitude;

        geofence = null;
      }

      delete data.latlong;
    }

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
    // Geofence
    if (!this.hasCapability('geofence')) {
      this.addCapability('geofence').catch(this.error);
      this.log('Added \'geofence\' capability');
    }

    // In geofence
    if (!this.hasCapability('in_geofence')) {
      this.addCapability('in_geofence').catch(this.error);
      this.log('Added \'in_geofence\' capability');
    }

    // Location source
    if (!this.hasCapability('location_source')) {
      this.addCapability('location_source').catch(this.error);
      this.log('Added \'location_source\' capability');
    }

    if (blank(data.capabilities)) return;

    // Sync via capabilities
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
      const reasons = ['not_reporting', 'out_of_battery', 'shutdown_by_user'];

      if (reasons.includes(data.tracker_state_reason)) {
        return this.setWarning(this.homey.__(`state.${data.tracker_state_reason}`));
      }
    }

    // Remove warning
    return this.unsetWarning();
  }

  /*
  | Geofence functions
  */

  async getGeofence(coordinates) {
    let fences = this.getStoreValue('geofences') || [];

    for (const fence of fences) {
      // Circle
      if (fence.shape === 'circle') {
        const latlong = {
          latitude: fence.coords[0][0],
          longitude: fence.coords[0][1],
        };

        if (geo.isPointWithinRadius(coordinates, latlong, fence.radius)) {
          return fence;
        }
      }

      // Rectangle and polygon
      if (fence.shape === 'rectangle' || fence.shape === 'polygon') {
        const coords = [];

        for (const coord of fence.coords) {
          coords.push({ latitude: coord[0], longitude: coord[1] });
        }

        if (geo.isPointInPolygon(coordinates, coords)) {
          return fence;
        }
      }
    }

    fences = null;

    return {
      name: '',
      fence_type: null,
    };
  }

  // Save geofences in store
  async saveGeofences(raw) {
    this.log('Saving geofences');

    if (blank(raw)) {
      await this.setStoreValue('geofences', []);

      return;
    }

    let fences = [];
    let active = raw.filter((entry) => entry.active && filled(entry.name));

    raw = null;

    for (const fence of active) {
      delete fence.created_at;
      delete fence.updated_at;
      delete fence._version;
      delete fence.trigger;
      delete fence.deleted_at;
      delete fence.icon;
      delete fence.source_geofence_id;
      delete fence.device;
      delete fence._type;

      fence.shape = fence.shape.toLowerCase();
      fence.name = fence.name.trim();
      fence.fence_type = fence.fence_type.toLowerCase();

      fences.push(fence);
    }

    await this.setStoreValue('geofences', fences);

    fences = null;
    active = null;
  }

  /*
  | Power Saving Zone functions
  */

  // Return Power Saving Zone name
  async getPowerSavingZoneName(id) {
    if (blank(id)) return '';

    // Check store first
    const zones = this.getStoreValue('power_saving_zones') || {};

    if (filled(zones[id])) {
      return zones[id];
    }

    // Get Power Saving Zone from API
    const zone = await this.oAuth2Client.getPowerSavingZone(id);

    return (zone.name || '').trim();
  }

  // Save Power Saving Zones in store
  async savePowerSavingZones(raw) {
    this.log('Saving Power Saving Zones');

    if (blank(raw)) {
      await this.setStoreValue('power_saving_zones', {});

      return;
    }

    let zones = {};

    for (const zone of raw) {
      if (blank(zone.name)) continue;

      zones[zone._id] = zone.name.trim();
    }

    await this.setStoreValue('power_saving_zones', zones);

    zones = null;
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
