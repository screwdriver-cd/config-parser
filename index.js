'use strict';

const Yaml = require('js-yaml');
const Joi = require('joi');
const Hoek = require('hoek');
const Async = require('async');

const REGEX_STEP_NAME = /^[\w-]+$/;
const REGEX_JOB_NAME = /^[\w-]+$/;
const SCHEMA_STEPS = Joi.object()
    // Steps can only be named with A-Z,a-z,0-9,-,_
    // Steps only contain strings (the command to execute)
    .pattern(REGEX_STEP_NAME, Joi.string())
    // All others are marked as invalid
    .unknown(false)
    // At least one command is required
    .min(1)
    // Add documentation
    .options({
        language: {
            object: {
                min: 'requires at least one step',
                allowUnknown: 'only supports the following characters A-Z,a-z,0-9,-,_'
            }
        }
    });
const SCHEMA_JOB = Joi.object({
    steps: SCHEMA_STEPS
});

/**
 * Generate a Joi configuration that requires the {jobName} job to exist
 * @method makeConfigSchema
 * @param  {String}   jobName Current Job (desired job)
 * @return {Joi}              Joi Schema for the config file
 */
function makeConfigSchema(jobName) {
    const requiredJobs = ['main', jobName];
    const jobSchema = {};

    requiredJobs.forEach((name) => {
        jobSchema[name] = SCHEMA_JOB.required();
    });

    const jobs = Joi.object().keys(jobSchema)
        // Jobs can only be named with A-Z,a-z,0-9,-,_
        .pattern(REGEX_JOB_NAME, SCHEMA_JOB)
        // All others are marked as invalid
        .unknown(false)
        .options({
            language: {
                object: {
                    allowUnknown: 'only supports the following characters A-Z,a-z,0-9,-,_'
                }
            }
        });

    return Joi.object().keys({ jobs })
        // Jobs is the only field in the screwdriver.yaml
        .requiredKeys('jobs')
        // No other fields are allowed
        .unknown(false);
}

/**
 * Parse the configuration from a screwdriver.yaml
 * @method configParser
 * @param  {Object}   config
 * @param  {String}   config.yaml           Contents of screwdriver.yaml
 * @param  {String}   [config.jobName=main] Job to parse for
 * @param  {Function} callback              Function to call when done (error, { execute })
 */
module.exports = function configParser(config, callback) {
    const paramSchema = Joi.object().keys({
        yaml: Joi.string()
            .required(),
        jobName: Joi.string()
            .regex(/^[\w-]+$/)
            .optional()
            .default('main')
    });
    const defaultOptions = {
        abortEarly: false
    };
    let globalConfig = {};

    Async.waterfall([
        Async.apply(Joi.validate, config, paramSchema, defaultOptions),
        (parsedConfig, next) => {
            globalConfig = Object.assign({}, parsedConfig);

            try {
                globalConfig.yaml = Yaml.safeLoad(parsedConfig.yaml);
            } catch (parseError) {
                return next(parseError);
            }

            const configSchema = makeConfigSchema(parsedConfig.jobName);

            return Joi.validate(globalConfig.yaml, configSchema, defaultOptions, next);
        },
        (parsedDoc, next) => {
            const execute = Hoek.reach(parsedDoc, `jobs.${globalConfig.jobName}.steps`);

            return next(null, {
                execute
            });
        }
    ], callback);
};
