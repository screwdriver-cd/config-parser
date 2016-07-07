'use strict';

const Joi = require('joi');
const Regex = require('../regex');

const SCHEMA_MATRIX = Joi.object()
    // IEEE Std 1003.1-2001
    // Environment names contain uppercase letters, digits, and underscore
    // They cannot start with digits
    .pattern(Regex.ENV_NAME, Joi.array().items())
    // All others are marked as invalid
    .unknown(false)
    // Add documentation
    .options({
        language: {
            object: {
                allowUnknown: 'only supports uppercase letters, digits, and underscore (cannot '
                + 'start with digit)'
            }
        }
    });
const SCHEMA_ENVIRONMENT = Joi.object()
    // IEEE Std 1003.1-2001
    // Environment names contain uppercase letters, digits, and underscore
    // They cannot start with digits
    .pattern(Regex.ENV_NAME, Joi.any())
    // All others are marked as invalid
    .unknown(false)
    // Add documentation
    .options({
        language: {
            object: {
                allowUnknown: 'only supports uppercase letters, digits, and underscore (cannot '
                + 'start with digit)'
            }
        }
    });
const SCHEMA_STEPS = Joi.object()
    // Steps can only be named with A-Z,a-z,0-9,-,_
    // Steps only contain strings (the command to execute)
    .pattern(Regex.STEP_NAME, Joi.string())
    // All others are marked as invalid
    .unknown(false)
    // Add documentation
    .options({
        language: {
            object: {
                allowUnknown: 'only supports the following characters A-Z,a-z,0-9,-,_'
            }
        }
    });
const SCHEMA_JOB = Joi.object()
    .keys({
        steps: SCHEMA_STEPS,
        environment: SCHEMA_ENVIRONMENT,
        matrix: SCHEMA_MATRIX,
        image: Joi.string()
    })
    .default({});
const SCHEMA_JOBS = Joi.object()
    .keys({
        main: SCHEMA_JOB.required()
    })
    // Jobs can only be named with A-Z,a-z,0-9,-,_
    .pattern(Regex.JOB_NAME, SCHEMA_JOB)
    // All others are marked as invalid
    .unknown(false);
const SCHEMA_SHARED = SCHEMA_JOB;
const SCHEMA_WORKFLOW = Joi.array()
    // List of jobs
    .items(Joi.string().regex(Regex.JOB_NAME))
    // You cannot trigger the same job twice
    .unique();
const SCHEMA_CONFIG = Joi.object()
    .keys({
        jobs: SCHEMA_JOBS,
        workflow: SCHEMA_WORKFLOW,
        shared: SCHEMA_SHARED
    })
    .requiredKeys('jobs')
    .unknown(false);

/**
 * Structural Phase
 *  - Validate basic structure of the parsed YAML
 * @method
 * @param  {Object}   doc      Direct document from YAML parsing
 * @param  {Function} callback Function to call when done (err, doc)
 */
module.exports = (doc, callback) => {
    Joi.validate(doc, SCHEMA_CONFIG, {
        abortEarly: false
    }, callback);
};
