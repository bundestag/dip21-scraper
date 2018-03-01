'use strict';

const request = require('request');
const Cookie = require('request-cookies').Cookie;

const options = { method: 'GET', uri: 'https://dipbt.bundestag.de/dip21.web/bt' };
// var j = req.jar();
// var cookie = req.cookie("" + mycookie);
// j.setCookie(cookie, url);
// , jar: j
request(options, (err, res, body) => {
    // console.log(err);
    // console.log(res);
    // console.log(body);
    var rawcookies = response.headers['set-cookie'];
    for (var i in rawcookies) {
        var cookie = new Cookie(rawcookies[i]);
        console.log(cookie.key, cookie.value, cookie.expires);
    }
});