/**
 * UserController
 *
 * @description :: Server-side logic for managing users
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

var qs = require('querystring');
var request = require('request');
var jwt = require('jwt-simple');
var moment = require('moment');

function createJWT(user) {
    var payload = {
        sub: user.id,
        iat: moment().unix(),
        exp: moment().add(14, 'days').unix()
    };
    return jwt.encode(payload, config.TOKEN_SECRET);
}

module.exports = {
    login: function(req, res) {
        var requestTokenUrl = 'https://api.twitter.com/oauth/request_token';
        var accessTokenUrl = 'https://api.twitter.com/oauth/access_token';
        var profileUrl = 'https://api.twitter.com/1.1/account/verify_credentials.json';

        // Part 1 of 2: Initial request from Satellizer.
        if (!req.body.oauth_token || !req.body.oauth_verifier) {
            var requestTokenOauth = {
                consumer_key: sails.config.TWITTER_KEY,
                consumer_secret: sails.config.TWITTER_SECRET,
                // callback: req.body.redirectUri
                callback: sails.config.TWITTER_CALLBACK
            };

            // Step 1. Obtain request token for the authorization popup.
            request.post({
                url: requestTokenUrl,
                oauth: requestTokenOauth
            }, function(err, response, body) {
                var oauthToken = qs.parse(body);

                // Step 2. Send OAuth token back to open the authorization screen.
                res.send(oauthToken);
            });
        } else {
            // Part 2 of 2: Second request after Authorize app is clicked.
            var accessTokenOauth = {
                consumer_key: sails.config.TWITTER_KEY,
                consumer_secret: sails.config.TWITTER_SECRET,
                token: req.body.oauth_token,
                verifier: req.body.oauth_verifier
            };

            // Step 3. Exchange oauth token and oauth verifier for access token.
            request.post({
                url: accessTokenUrl,
                oauth: accessTokenOauth
            }, function(err, response, accessToken) {

                accessToken = qs.parse(accessToken);

                var profileOauth = {
                    consumer_key: sails.config.TWITTER_KEY,
                    consumer_secret: sails.config.TWITTER_SECRET,
                    token: accessToken.oauth_token,
                    token_secret: accessToken.oauth_token_secret,
                };

                // Step 4. Retrieve user's profile information and email address.
                request.get({
                    url: profileUrl,
                    qs: {
                        include_email: true
                    },
                    oauth: profileOauth,
                    json: true
                }, function(err, response, profile) {

                    // Step 5a. Link user accounts.
                    if (req.header('Authorization')) {
                        User.findOne({
                            twitter: profile.id
                        }, function(err, existingUser) {
                            if (existingUser) {
                                return res.status(409).send({
                                    message: 'There is already a Twitter account that belongs to you'
                                });
                            }

                            var token = req.header('Authorization').split(' ')[1];
                            var payload = jwt.decode(token, sails.config.TOKEN_SECRET);

                            User.findById(payload.sub, function(err, user) {
                                if (!user) {
                                    return res.status(400).send({
                                        message: 'User not found'
                                    });
                                }

                                user.twitter = profile.id;
                                user.email = profile.email;
                                user.displayName = user.displayName || profile.name;
                                user.picture = user.picture || profile.profile_image_url_https.replace('_normal', '');
                                user.save(function(err) {
                                    res.send({
                                        token: createJWT(user)
                                    });
                                });
                            });
                        });
                    } else {
                        // Step 5b. Create a new user account or return an existing one.
                        User.findOne({
                            twitter: profile.id
                        }, function(err, existingUser) {
                            if (existingUser) {
                                return res.send({
                                    token: createJWT(existingUser)
                                });
                            }

                            User.create({
                                twitter: profile.id,
                                email: profile.email,
                                displayName: profile.name,
                                picture: profile.profile_image_url_https.replace('_normal', '')
                            }).exec(function(err, user) {
                                if (err) {
                                    return res.send(err);
                                }
                                res.send({
                                    token: createJWT(user)
                                });
                            });
                        });
                    }
                });
            });
        }
    }
};
