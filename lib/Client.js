'use strict';

const { OAuth2Client } = require('homey-oauth2app');
const OAuth2Error = require('homey-oauth2app/lib/OAuth2Error');
const fetch = require('node-fetch');
const Token = require('./Token');
const { blank } = require('./Utils');
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
    let device;
    const devices = [];

    for (const entry of trackers) {
      // Discover tracker
      device = await this.discoverTracker(entry._id);

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
    if (blank(device)) return null;

    // Set additional information
    device.user = await this.getUser();
    device.pet = await this.searchPet('device_id', id);
    device.hardware = await this.getHardwareReport(id);
    device.subscription = await this.searchSubscription('tracker_id', id);
    device.model_name = device.hw_edition ? `${device.model_number}_${device.hw_edition}` : device.model_number;
    device.product_name = (device.sku ? TrackerNamesBySku[device.sku] : TrackerNames[device.model_name]) || '-';
    device.name = (device.pet.details.name || device._id).trim();

    return device;
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
  | GPS functions
  */

  // Return address by coordinates
  async getAddress(latitude, longitude) {
    return this._get(`/platform/geo/address/location?latitude=${latitude}&longitude=${longitude}`);
  }

  /*
  | Pet functions
  */

  // Return all pets
  async getPets() {
    // Retrieve pets
    const pets = await this._get('/user/me/trackable_objects');
    if (blank(pets)) return null;

    // Retrieve pets information
    for (const [i, entry] of pets.entries()) {
      pets[i] = await this.getPet(entry._id);
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
  | Subscripion functions
  */

  // Return all subscriptions
  async getSubscriptions() {
    // Retrieve subscriptions
    const subscriptions = await this._get('/user/me/subscriptions');
    if (blank(subscriptions)) return null;

    // Retrieve subscriptions information
    for (const [i, entry] of subscriptions.entries()) {
      subscriptions[i] = await this.getSubscription(entry._id);
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

  // Return hardware report for tracker
  async getHardwareReport(id) {
    return this._get(`/device_hw_report/${id}`);
  }

  // Return all trackers
  async getTrackers() {
    return this._get('/user/me/trackers');
  }

  // Return single tracker
  async getTracker(id) {
    return this._get(`/tracker/${id}`);
  }

  /*
  | User functions
  */

  // Return authenticated user
  async getUser() {
    return this._get('/user/me');
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
    if (blank(result) || typeof result === 'object') {
      this.log('Response', JSON.stringify(result));

      return result;
    }

    this.error('Invalid response', result);

    throw new Error(this.homey.__('errors.50x'));
  }

  // Refresh token
  async onRefreshToken() {
    this.log('Refreshing token...');

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

    this.log('Refreshed token!', this._token);
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
  | Support functions
  */

  // Perform GET request
  async _get(path) {
    this.log('GET', path);

    if (!this._token) {
      throw new Error(this.homey.__('errors.401'));
    }

    return this.get({
      path,
      query: '',
      headers: {},
    });
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
