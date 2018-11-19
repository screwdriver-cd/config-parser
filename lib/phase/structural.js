'use strict';

const Joi = require('joi');
const SCHEMA_CONFIG = require('screwdriver-data-schema').config.base.config;

/**
 * Check if a job has duplicate steps
 * Check if user teardown is at the end of the yaml
 * @method checkAdditionalRules
 * @param  {Object}          data Screwdriver yaml
 * @return {Array}                List of errors
 */
function checkAdditionalRules(data) {
    let steps = [];
    const errors = [];

    Object.keys(data.jobs).forEach((job) => {
        let firstUserTeardownStep = -1;

        steps = data.jobs[job].steps;

        if (steps) { // if there are user-defined steps
            for (let i = 0; i < steps.length; i += 1) {
                const isUserTeardown = Object.keys(steps[i])[0].startsWith('teardown-');

                if (firstUserTeardownStep > -1 && !isUserTeardown) {
                    errors.push(new Error('User teardown steps need to be at the end'));
                }

                if (firstUserTeardownStep === -1 && isUserTeardown) {
                    firstUserTeardownStep = i;
                }
            }
        }

        if (data.cache && data.cache.job) { // make sure the job under job scope exists
            Object.keys(data.cache.job).forEach((jobname) => {
                if (!(jobname in data.jobs)) {
                    errors.push(new Error(`Cache is set for non-existing job: ${jobname}`));
                }
            });
        }
    });

    return errors.length === 0 ? null : errors;
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
        }, (schemaErr, data) => {
            if (schemaErr) {
                return reject(schemaErr);
            }

            const errors = checkAdditionalRules(data);

            if (errors) {
                return reject(errors);
            }

            return resolve(data);
        });
    })
);
