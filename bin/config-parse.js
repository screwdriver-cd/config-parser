#!/usr/bin/env node
'use strict';

const winston = require('winston');
const parser = require('../');
const fs = require('fs');
const path = require('path');

const yaml = fs.readFileSync(process.argv[2], 'utf-8');
const jobName = process.argv[3];
const destination = process.argv[4];

winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {
    showLevel: false
});

parser({ yaml, jobName }, (err, data) => {
    if (err) {
        winston.error(err);
        process.exit(err.code || 127);
    }

    // Commands to execute
    fs.writeFileSync(path.join(destination, 'execute.json'), JSON.stringify(data.execute));
});
