'use strict';

const Joi = require('joi');
const SCHEMA_CONFIG = require('screwdriver-data-schema').config.base.config;

/**
 * Check if user teardown is at the end of the yaml
 * @method checkUserTeardown
 * @param  {Object}          data Screwdriver yaml
 * @return {Promise}              Error if there is an error
 */
function checkUserTeardown(data) {
    let steps = [];
    let error = null;

    Object.keys(data.jobs).forEach((job) => {
        let firstUserTeardownStep = -1;

        steps = data.jobs[job].steps;

        if (steps) { // if there are user-defined steps
            for (let i = 0; i < steps.length; i += 1) {
                const isUserTeardown = Object.keys(steps[i])[0].startsWith('teardown-');

                if (firstUserTeardownStep > -1 && !isUserTeardown) {
                    error = new Error('User teardown steps need to be at the end');
                }

                if (firstUserTeardownStep === -1 && isUserTeardown) {
                    firstUserTeardownStep = i;
                }
            }
        }
    });

    return error;
}
/**
 * Structural Phase
 *  - Validate basic structure of the parsed YAML
 * @method
 * @param   {Object}   doc      Direct document from YAML parsing
 * @returns {Promise}
 */
module.exports = doc => (
    new Promise((resolve, reject) => {
        Joi.validate(doc, SCHEMA_CONFIG, {
            abortEarly: false
        }, (err, data) => {
            if (err) {
                return reject(err);
            }

            const teardownError = checkUserTeardown(data);

            if (teardownError) {
                return reject(teardownError);
            }

            return resolve(data);
        });
    })
);
