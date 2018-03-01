const request = require('request');
const Cookie = require('request-cookies').Cookie;

let cookie = request.jar();
const options = { method: 'GET', uri: 'https://dipbt.bundestag.de/dip21.web/bt', jar: cookie };

request(options, (err, response, body) => {
    var rawcookies = response.headers['set-cookie'];
    var JSESSIONID = null;
    for (var i in rawcookies) {
        var acookie = new Cookie(rawcookies[i]);
        //console.log(acookie.key, acookie.value, acookie.expires);
        if (acookie.key === 'JSESSIONID') {
            JSESSIONID = acookie.value;
        }
    }
    cookie.setCookie(options.uri, response.headers['set-cookie']);
    // console.log(cookie);
    const options2 = { method: 'GET', uri: 'https://dipbt.bundestag.de/dip21.web/searchProcedures.do', jar: cookie };
    request(options2, (err, response, body) => { console.log(body); });
});
