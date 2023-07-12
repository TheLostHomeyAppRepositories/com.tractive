'use strict';

const { OAuth2Token } = require('homey-oauth2app');

class Token extends OAuth2Token {

  constructor({
    username, password, expires_at, ...props
  }) {
    super({ ...props });

    this.username = username || null;
    this.password = password || null;
    this.expires_at = expires_at || null;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      username: this.username,
      password: this.password,
      expires_at: this.expires_at,
    };
  }

}

module.exports = Token;
