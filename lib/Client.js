'use strict';

const { OAuth2Client } = require('homey-oauth2app');
const OAuth2Error = require('homey-oauth2app/lib/OAuth2Error');
const fetch = require('node-fetch');
const Token = require('./Token');
const { blank, filled } = require('./Utils');
const { TrackerNames, TrackerNamesBySku } = require('./Enums');

class Client extends OAuth2Client {

  static API_URL = 'https://graph.tractive.com/4';
  static TOKEN_URL = 'https://graph.tractive.com/4/auth/token';
  static TOKEN = Token;
  static AUTHORIZATION_URL = '';
  static SCOPES = [];

  /*
  | Device discovery functions
  */

  // Discover trackers
  async discoverTrackers() {
    // Retrieve all trackers
    const trackers = await this.getTrackers();
    if (blank(trackers)) return [];

    // Device list
    const devices = [];
    let device;

    for (const entry of trackers) {
      if (blank(entry) || blank(entry._id)) continue;

      // Discover tracker
      device = await this.discoverTracker(entry._id);

      // Ignore empty device
      if (blank(device)) continue;

      // Add device to list
      devices.push(device);
    }

    device = null;

    return devices;
  }

  // Discover single tracker
  async discoverTracker(id) {
    // Retrieve tracker
    const device = await this.getTracker(id);
    if (blank(device) || blank(device._id)) return null;

    // Set additional information
    device.pet = await this.searchPet('device_id', id);
    device.subscription = await this.searchSubscription('tracker_id', id);
    device.model_name = device.hw_edition ? `${device.model_number}_${device.hw_edition}` : device.model_number;
    device.product_name = (device.sku ? TrackerNamesBySku[device.sku] : TrackerNames[device.model_name]) || '-';
    device.name = (device.pet.details.name || device._id).trim();

    return device;
  }

  /*
  | GPS functions
  */

  // Return address by coordinates
  async getAddress(latitude, longitude) {
    const address = this._get(`/platform/geo/address/location?latitude=${latitude}&longitude=${longitude}`);

    return {
      house_number: (address.house_number || '').toLowerCase(),
      zip_code: (address.zip_code || '').toUpperCase(),
      country: (address.country || '').toUpperCase(),
      street: (address.street || '').toLowerCase(),
      city: (address.city || '').toLowerCase(),
    };
  }

  /*
  | Pet functions
  */

  // Return all pets
  async getPets() {
    const pets = [];

    // Retrieve pets
    const result = await this._get('/user/me/trackable_objects');
    if (blank(result)) return [];

    // Retrieve pets information
    for (const entry of result) {
      if (blank(entry._id)) continue;

      // Retrieve pet
      const pet = await this.getPet(entry._id);

      // Ignore empty pets
      if (blank(pet) || blank(pet._id)) continue;

      pets.push(pet);
    }

    return pets;
  }

  // Return single pet
  async getPet(id) {
    return this._get(`/trackable_object/${id}`);
  }

  // Return single pet that matches the given parameters
  async searchPet(key, value) {
    const pets = await this.getPets();
    if (blank(pets)) return null;

    return pets.find((pet) => pet[key] === value);
  }

  /*
  | Power Saving Zone functions
  */

  // Return Power Saving Zone
  async getPowerSavingZone(id) {
    return this._get(`/power_saving_zone/${id}`);
  }

  // Return Power Saving Zones for tracker
  async getPowerSavingZones(trackerId) {
    return this._get(`/tracker/${trackerId}/power_saving_zones`);
  }

  /*
  | Geofence functions
  */

  // Return geofence
  async getGeofence(id) {
    return this._get(`/geofence/${id}`);
  }

  // Return geofences for tracker
  async getGeofences(trackerId) {
    return this._get(`/tracker/${trackerId}/geofences`);
  }

  /*
  | Subscripion functions
  */

  // Return all subscriptions
  async getSubscriptions() {
    const subscriptions = [];

    // Retrieve subscriptions
    const result = await this._get('/user/me/subscriptions');
    if (blank(result)) return [];

    // Retrieve subscriptions information
    for (const entry of result) {
      if (blank(entry._id)) continue;

      // Retrieve subscription
      const sub = await this.getSubscription(entry._id);

      // Ignore empty subscription
      if (blank(sub) || blank(sub._id)) continue;

      subscriptions.push(sub);
    }

    return subscriptions;
  }

  // Return single subscription
  async getSubscription(id) {
    return this._get(`/subscription/${id}`);
  }

  // Return single subscription that matches the given parameters
  async searchSubscription(key, value) {
    const subs = await this.getSubscriptions();
    if (blank(subs)) return null;

    return subs.find((sub) => sub[key] === value);
  }

  /*
  | Tracker functions
  */

  // Return all trackers
  async getTrackers() {
    return this._get('/user/me/trackers');
  }

  // Return single tracker
  async getTracker(id) {
    const user = await this.getUser();
    const powerSavingZones = await this.getPowerSavingZones(id);
    const geofences = await this.getGeofences(id);

    const result = await this._post('/bulk', [
      { _type: 'tracker', _id: id },
      { _type: 'user_detail', _id: user.details._id },
      { _type: 'device_hw_report', _id: id },
      { _type: 'device_pos_report', _id: id },
      { _type: 'tracker_command_state', _id: `${id}_led_control` },
      { _type: 'tracker_command_state', _id: `${id}_buzzer_control` },
      { _type: 'tracker_command_state', _id: `${id}_live_tracking` },
      ...powerSavingZones,
      ...geofences,
    ]);

    if (blank(result)) return {};

    const tracker = result.find((entry) => entry._type === 'tracker') || {};

    if (blank(tracker)) return {};

    return {
      ...tracker,
      user: result.find((entry) => entry._type === 'user_detail') || {},
      hardware: result.find((entry) => entry._type === 'device_hw_report') || {},
      position: result.find((entry) => entry._type === 'device_pos_report') || {},
      geofences: result.filter((entry) => entry._type === 'geofence') || [],
      led_control: result.find((entry) => entry._id.endsWith('led_control')) || {},
      live_tracking: result.find((entry) => entry._id.endsWith('live_tracking')) || {},
      buzzer_control: result.find((entry) => entry._id.endsWith('buzzer_control')) || {},
      power_saving_zones: result.filter((entry) => entry._type === 'power_saving_zone') || [],
    };
  }

  /*
  | Command functions
  */

  // Send command
  async sendCommand(id, command, enable) {
    const state = enable ? 'on' : 'off';

    const response = await this._get(`/tracker/${id}/command/${command}/${state}`);

    if (!response.pending) {
      throw new Error(this.homey.__('errors.command'));
    }
  }

  // Control buzzer sound
  async setBuzzer(id, enable) {
    return this.sendCommand(id, 'buzzer_control', enable);
  }

  // Control LED light
  async setLight(id, enable) {
    return this.sendCommand(id, 'led_control', enable);
  }

  // Control LIVE Tracking
  async setLive(id, enable) {
    return this.sendCommand(id, 'live_tracking', enable);
  }

  /*
  | Support functions
  */

  // Return authenticated user
  async getUser() {
    return this._get('/user/me', false);
  }

  // Perform GET request
  async _get(path, log = true) {
    if (log) this.log('GET', path);

    if (!this._token) {
      throw new Error(this.homey.__('errors.401'));
    }

    return this.get({
      path,
      query: '',
      headers: {},
    });
  }

  // Perform POST request
  async _post(path, json = null) {
    const string = JSON.stringify(json);

    this.log('POST', path, string);

    if (!this._token) {
      throw new Error(this.homey.__('errors.401'));
    }

    return this.post({
      path,
      query: '',
      json,
      body: null,
      headers: {},
    });
  }

  /*
  | Client events
  */

  // Get token by credentials
  async onGetTokenByCredentials({ username, password }) {
    username = encodeURIComponent(username);
    password = encodeURIComponent(password);

    // Initiate token
    this._token = new Token({ username, password });

    try {
      // Create URL
      const url = `${this._tokenUrl}?grant_type=tractive&platform_email=${username}&platform_token=${password}`;

      // Request token from API
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'X-Tractive-Client': this._clientId },
      });

      if (!response.ok) {
        return this.onHandleGetTokenByCredentialsError({ response });
      }

      this._token = await this.onHandleGetTokenByCredentialsResponse({ response });

      // Return token
      return this.getToken();
    } catch (err) {
      this.error('Get token:', JSON.stringify(err));

      throw new Error(this.homey.__('errors.401'));
    }
  }

  // Request response is not OK
  async onHandleNotOK({
    body, status, statusText, headers,
  }) {
    this.error('Request not OK', JSON.stringify({
      body,
      status,
      statusText,
      headers,
    }));

    // Client errors
    if (status === 401 || status === 403 || status === 404) {
      return new Error(this.homey.__(`errors.${status}`));
    }

    // Internal server error
    if (status >= 500 && status < 600) {
      return new Error(this.homey.__('errors.50x'));
    }

    // Custom error message
    if (body.message || null) {
      return new Error(body.message);
    }

    // Unknown error
    return new Error(this.homey.__('errors.unknown'));
  }

  // Handle result
  async onHandleResult({
    result, status, statusText, headers,
  }) {
    if (filled(result)) {
      this.log('Response', JSON.stringify(result));
    }

    return result;
  }

  // Refresh token
  async onRefreshToken() {
    this.log('[Token] Refreshing');

    // Create URL
    const url = `${this._tokenUrl}?grant_type=tractive&platform_email=${this.username}&platform_token=${this.password}`;

    // Request token from API
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-Tractive-Client': this._clientId },
    });

    if (!response.ok) {
      return this.onHandleRefreshTokenError({ response });
    }

    this._token = await this.onHandleRefreshTokenResponse({ response });

    this.log('[Token] Refreshed:', this._token);
    this.save();

    return this.getToken();
  }

  // Request error
  async onRequestError({ err }) {
    this.error('Request error', err.message);

    throw new Error(this.homey.__('errors.network'));
  }

  // Request headers
  async onRequestHeaders({ headers }) {
    const token = await this.getToken();
    if (!token) throw new OAuth2Error('Missing Token');

    const { access_token: accessToken } = token;

    return {
      ...headers,
      'X-Tractive-Client': this._clientId,
      Authorization: `Bearer ${accessToken}`,
    };
  }

  /*
  | Getter functions
  */

  get password() {
    return this._token ? this._token.password : null;
  }

  get username() {
    return this._token ? this._token.username : null;
  }

}

module.exports = Client;
