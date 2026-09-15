'use strict';

const SCHEMA_CONFIG_PRE_TEMPLATE_MERGE = require('screwdriver-data-schema').config.base.configBeforeMergingTemplate;
const SCHEMA_CONFIG_POST_TEMPLATE_MERGE = require('screwdriver-data-schema').config.base.configAfterMergingTemplate;
const UserConfigError = require('../userConfigError');

/**
 * Check if a job has duplicate steps
 * Check if user teardown is at the end of the yaml
 * @method checkAdditionalRules
 * @param  {Object}          data Screwdriver yaml
 * @return {Array}                List of errors
 */
function checkAdditionalRules(data) {
    const { jobs } = data;

    const errors = [];

    Object.keys(jobs).forEach(job => {
        let firstUserTeardownStep = -1;
        const { steps } = jobs[job];

        if (steps) {
            // if there are user-defined steps
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

        if (data.cache && data.cache.job) {
            // make sure the job under job scope exists
            Object.keys(data.cache.job).forEach(jobname => {
                if (!(jobname in jobs)) {
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
async function structuralValidation(doc, premergeValidation) {
    // This phase has no I/O beyond Joi's own in-memory schema validation, so
    // anything it throws - a Joi ValidationError or the additional-rules array
    // below - is a statement about the user's YAML, not an infrastructure
    // failure. Wrapping the whole function keeps that true regardless of which
    // of the two branches raised it.
    try {
        let data;
        let errors;

        if (premergeValidation) {
            data = await SCHEMA_CONFIG_PRE_TEMPLATE_MERGE.validateAsync(doc, {
                abortEarly: false
            });
        } else {
            data = await SCHEMA_CONFIG_POST_TEMPLATE_MERGE.validateAsync(doc, {
                abortEarly: false
            });
            errors = checkAdditionalRules(data);
        }

        if (errors) {
            throw errors;
        }

        return data;
    } catch (err) {
        throw new UserConfigError(err.toString(), err);
    }
}

module.exports = structuralValidation;
