'use strict';

const { OAuth2Client } = require('homey-oauth2app');
const OAuth2Error = require('homey-oauth2app/lib/OAuth2Error');
const fetch = require('node-fetch');
const { collect } = require('collect.js');
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
    return this.getBulkTrackers();
  }

  /*
  | GPS functions
  */

  // Return address by coordinates
  async getAddress(latitude, longitude) {
    const address = await this._get(`/platform/geo/address/location?latitude=${latitude}&longitude=${longitude}`);

    return {
      house_number: (address.house_number || '').toLowerCase(),
      zip_code: (address.zip_code || '').toUpperCase(),
      country: (address.country || '').toUpperCase(),
      street: (address.street || '').toLowerCase(),
      city: (address.city || '').toLowerCase(),
    };
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

  // Return geofences for tracker
  async getGeofences(trackerId) {
    return this._get(`/tracker/${trackerId}/geofences`);
  }

  /*
  | Tracker functions
  */

  // Return all trackers
  async getTrackers() {
    const result = await this._get('/user/me/trackers');

    return collect(result).keyBy('_id').all();
  }

  // Return all trackers in bulk
  async getBulkTrackers() {
    const raw = await this.getTrackers();
    if (blank(raw)) return [];

    const result = await this._bulk(collect(raw)
      .map((e, i) => this.getBulkTrackerEntries(i))
      .flatten(1).all());

    return collect(result)
      .filter((e) => e._type === 'tracker')
      .map((e) => this.enrichTrackerData(e, result))
      .all();
  }

  // Return single tracker
  async getTracker(id) {
    const powerSavingZones = await this.getPowerSavingZones(id);
    const geofences = await this.getGeofences(id);

    const result = await this._bulk([
      ...this.getBulkTrackerEntries(id),
      ...powerSavingZones,
      ...geofences,
    ]);

    if (blank(result)) return {};

    const tracker = result.find((e) => e._type === 'tracker') || {};
    if (blank(tracker)) return {};

    return this.enrichTrackerData(tracker, result);
  }

  enrichTrackerData(tracker, data) {
    const { _id } = tracker;

    return {
      ...tracker,
      model_name: tracker.hw_edition ? `${tracker.model_number}_${tracker.hw_edition}` : tracker.model_number,
      product_name: (tracker.sku ? TrackerNamesBySku[tracker.sku] : TrackerNames[tracker.model_name]) || '-',
      hardware: data.find((e) => e._id === _id && e._type === 'device_hw_report') || null,
      position: data.find((e) => e._id === _id && e._type === 'device_pos_report') || null,
      geofences: data.filter((e) => e.device && e.device._id === _id && e._type === 'geofence') || null,
      led_control: data.find((e) => e._id === `${_id}_led_control`) || null,
      live_tracking: data.find((e) => e._id === `${_id}_live_tracking`) || null,
      buzzer_control: data.find((e) => e._id === `${_id}_buzzer_control`) || null,
      power_saving_zones: data.filter((e) => e.device_id === _id && e._type === 'power_saving_zone') || null,
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
      throw new Error(this.homey.__('error.command'));
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

  // Perform bulk (POST) request
  async _bulk(data) {
    return this._post('/bulk', data);
  }

  // Perform GET request
  async _get(path, log = true) {
    if (log) this.log('GET', path);

    if (!this._token) {
      throw new Error(this.homey.__('error.401'));
    }

    return this.get({
      path,
      query: '',
      headers: {},
    });
  }

  // Perform POST request
  async _post(path, json = null) {
    this.log('POST', path, JSON.stringify(json));

    if (!this._token) {
      throw new Error(this.homey.__('error.401'));
    }

    return this.post({
      path,
      query: '',
      json,
      body: null,
      headers: {},
    });
  }

  // Return tracker bulk entries
  getBulkTrackerEntries(id) {
    return [
      { _type: 'tracker', _id: id },
      { _type: 'device_hw_report', _id: id },
      { _type: 'device_pos_report', _id: id },
      { _type: 'tracker_command_state', _id: `${id}_led_control` },
      { _type: 'tracker_command_state', _id: `${id}_buzzer_control` },
      { _type: 'tracker_command_state', _id: `${id}_live_tracking` },
    ];
  }

  /*
  | Client events
  */

  // Client initialized
  async onInit() {
    this.log('Initialized');
  }

  // Client destroyed
  async onUninit() {
    this.log('Destroyed');
  }

  // Get token by credentials
  async onGetTokenByCredentials({ username, password }) {
    this.log('[Token] Requesting');

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

      this.log('[Token] Result:', JSON.stringify(this._token));

      // Return token
      return this.getToken();
    } catch (err) {
      this.error('[Token] Error:', JSON.stringify(err));

      throw new Error(this.homey.__('error.401'));
    }
  }

  // Invalid token response
  async onHandleGetTokenByCredentialsError({ response }) {
    throw await this.onHandleNotOK(response);
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

    let error;

    // Client errors
    if (status === 401 || status === 403 || status === 404) {
      error = new Error(this.homey.__(`error.${status}`));
    }

    // Internal server error
    if (status >= 500 && status < 600) {
      error = new Error(this.homey.__('error.50x'));
    }

    // Custom error message
    if (filled(body.message)) {
      error = new Error(body.message);
    }

    // Unknown error
    if (blank(error)) {
      error = new Error(this.homey.__('error.unknown'));
    }

    error.status = status;
    error.statusText = statusText;

    return error;
  }

  // Handle result
  async onHandleResult({
    result, status, statusText, headers,
  }) {
    if (filled(result)) {
      this.log('[Response]', JSON.stringify(result));
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

    this.log('[Token] Result:', JSON.stringify(this._token));
    this.save();

    // Return token
    return this.getToken();
  }

  // Request error
  async onRequestError({ err }) {
    this.error('[Request]', err.toString());

    throw new Error(this.homey.__('error.network'));
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
