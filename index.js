/* eslint no-console: 0*/

'use strict';

const config = require('wild-config');
const Gelf = require('gelf');
const os = require('os');
const urllib = require('url');
const Tail = require('tail').Tail;

const component = config.log.gelf.component || 'wildduck';
const hostname = config.log.gelf.hostname || os.hostname();
const gelf =
    config.log.gelf && config.log.gelf.enabled
        ? new Gelf(config.log.gelf.options)
        : {
              // placeholder
              emit: (evt, message) => console.log(JSON.stringify(message))
          };

const loggelf = message => {
    if (typeof message === 'string') {
        message = {
            short_message: message
        };
    }
    message = message || {};

    if (!message.short_message || message.short_message.indexOf(component.toUpperCase()) !== 0) {
        message.short_message = component.toUpperCase() + ' ' + (message.short_message || '');
    }

    message.facility = component; // facility is deprecated but set by the driver if not provided
    message.host = hostname;
    if (!message.timestamp) {
        message.timestamp = Date.now() / 1000;
    }
    message._component = component;
    Object.keys(message).forEach(key => {
        if (!message[key]) {
            delete message[key];
        }
    });
    gelf.emit('gelf.log', message);
};

function parseLine(line) {
    let parts = line.split(/\s+/);

    if (!line || !parts || parts.length < 9) {
        return;
    }

    let message = {};

    message.timestamp =
        new Date(
            parts
                .slice(0, 2)
                .join('T')
                .replace(/,/g, '.') + 'Z'
        ).getTime() / 1000;

    message._ip = parts[5];
    message._user = parts[6];

    let remainder = [];

    let urlParts = [];
    for (let i = 9; i < parts.length; i++) {
        let part = parts[i];
        if (/"$/.test(part)) {
            urlParts.push(part.replace(/"$/, ''));
            remainder = parts.slice(i + 1);
            break;
        } else {
            urlParts.push(part);
        }
    }

    let url = urllib.parse(urlParts.join(' '), true, true);
    if (url.pathname === 'api/search/universal/relative' && url.query.query) {
        message._search = 'yes';
        Object.keys(url.query).forEach(key => {
            let value = url.query[key];
            if (key !== 'query' && !isNaN(value)) {
                value = Number(value);
            }
            message['_search_' + key] = value;
        });
    } else {
        return;
    }

    remainder.pop();
    message._response_code = Number(remainder.pop());
    message._ua = remainder.join(' ');

    message.short_message = '[' + message._user + '] ' + message._search_query;
    message.full_message = line;

    loggelf(message);
}

try {
    const tail = new Tail(config.source);

    tail.on('line', data => {
        parseLine(data);
    });

    tail.on('error', err => {
        console.error(err);
        process.exit(1);
    });
} catch (err) {
    console.error(err.message);
    process.exit(1);
}

console.log('Tailing for %s', config.source);
