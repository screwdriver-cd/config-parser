#!/usr/bin/env node
'use strict';

const program = require('commander');
const winston = require('winston');
const hoek = require('hoek');
const fs = require('fs');
const path = require('path');

const pkg = require('../package');
const parser = require('../');

// Explicit exit codes
const ERROR_BAD_YAML = 2;
const ERROR_CANNOT_LOAD_YAML = 3;
const ERROR_CANNOT_FIND_PERMUTATION = 4;
const ERRORS = {};

ERRORS[ERROR_BAD_YAML] = 'Specified screwdriver.yaml failed validation';
ERRORS[ERROR_CANNOT_LOAD_YAML] = 'Unable to read specified screwdriver.yaml';
ERRORS[ERROR_CANNOT_FIND_PERMUTATION] = 'Specified job/build not found in the screwdriver.yaml';

winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {
    showLevel: false
});

let yaml;
let jobName;
let buildNumber;

program
    .version(pkg.version)
    .option(
        '-a, --artifactdir <directory>',
        'Specify an alternative artifact directory',
        path.join(process.cwd(), 'artifacts'))
    .arguments('<screwdriver.yaml> <job> <build>')
    .action((yamlFile, job, build) => {
        jobName = job;
        buildNumber = build;

        try {
            yaml = fs.readFileSync(yamlFile, 'utf-8');
        } catch (err) {
            winston.error(ERRORS[ERROR_CANNOT_LOAD_YAML]);
            winston.error(err);
            process.exit(ERROR_CANNOT_LOAD_YAML);
        }
    });

program.parse(process.argv);

if (typeof yaml === 'undefined') {
    program.help();
}

parser(yaml, (err, data) => {
    if (err) {
        winston.error(ERRORS[ERROR_BAD_YAML]);
        winston.error(err);
        process.exit(ERROR_BAD_YAML);
    }

    const index = buildNumber.split('.')[1] || 0;
    const job = hoek.reach(data, `jobs.${jobName}.${index - 1}`);

    if (!job) {
        winston.error(ERRORS[ERROR_CANNOT_FIND_PERMUTATION]);
        Object.keys(data.jobs).forEach((name) => {
            winston.error(`\tJob: ${name}\tBuild Numbers: N.1 - N.${data.jobs[name].length}`);
        });
        process.exit(ERROR_CANNOT_FIND_PERMUTATION);
    }

    // Commands to execute
    fs.writeFileSync(path.join(program.artifactdir, 'execute.json'),
        JSON.stringify(job.steps));
    // Environment variables to set
    fs.writeFileSync(path.join(program.artifactdir, 'environment.json'),
        JSON.stringify(job.environment));
});
